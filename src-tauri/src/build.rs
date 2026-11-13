//! Maven and Gradle projects. A folder with a `pom.xml` or a Gradle build is
//! compiled by its build tool (the project's wrapper when it has one), and
//! the class path the tool works out, dependencies included, is saved in
//! `.logiq/build-classpath.txt`. Running, debugging, the object bench, JUnit
//! and JShell then use that class path instead of `out/`.

use crate::runner::{java_bin, no_window, parse_javac, CompileResult, Diagnostic};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Instant;

#[derive(Serialize, Clone, Copy, PartialEq, Debug)]
#[serde(rename_all = "lowercase")]
pub enum Tool {
    Maven,
    Gradle,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct BuildInfo {
    tool: Tool,
    /// The project's own wrapper (mvnw / gradlew).
    wrapper: bool,
    /// The program that runs the tool, when there is one.
    program: Option<String>,
}

const SEP: &str = if cfg!(windows) { ";" } else { ":" };

fn on_path(names: &[&str]) -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    std::env::split_paths(&path).find_map(|d| names.iter().map(|n| d.join(n)).find(|f| f.is_file()))
}

fn in_home(var: &str, name: &str) -> Option<PathBuf> {
    let p = PathBuf::from(std::env::var_os(var)?).join("bin").join(name);
    p.is_file().then_some(p)
}

/// Which build tool a folder uses, if any.
pub fn tool_of(root: &Path) -> Option<Tool> {
    if root.join("pom.xml").is_file() {
        Some(Tool::Maven)
    } else if ["build.gradle", "build.gradle.kts", "settings.gradle", "settings.gradle.kts"].iter().any(|f| root.join(f).is_file()) {
        Some(Tool::Gradle)
    } else {
        None
    }
}

pub fn detect(root: &Path) -> Option<BuildInfo> {
    let tool = tool_of(root)?;
    let (wrapper, program) = match tool {
        Tool::Maven => {
            let w = root.join(if cfg!(windows) { "mvnw.cmd" } else { "mvnw" });
            if w.is_file() {
                (true, Some(w))
            } else {
                (false, on_path(if cfg!(windows) { &["mvn.cmd", "mvn.bat"] } else { &["mvn"] }).or_else(|| in_home("MAVEN_HOME", if cfg!(windows) { "mvn.cmd" } else { "mvn" })).or_else(|| in_home("M2_HOME", if cfg!(windows) { "mvn.cmd" } else { "mvn" })))
            }
        }
        Tool::Gradle => {
            let w = root.join(if cfg!(windows) { "gradlew.bat" } else { "gradlew" });
            if w.is_file() {
                (true, Some(w))
            } else {
                (false, on_path(if cfg!(windows) { &["gradle.bat", "gradle.cmd"] } else { &["gradle"] }).or_else(|| in_home("GRADLE_HOME", if cfg!(windows) { "gradle.bat" } else { "gradle" })))
            }
        }
    };
    Some(BuildInfo { tool, wrapper, program: program.map(|p| p.to_string_lossy().into_owned()) })
}

#[tauri::command]
pub fn build_info(root: String) -> Option<BuildInfo> {
    detect(Path::new(&root))
}

fn saved_path(root: &Path) -> PathBuf {
    root.join(".logiq").join("build-classpath.txt")
}

/// The class path of the last build, for a Maven or Gradle project.
pub fn saved_class_path(root: &Path) -> Option<String> {
    tool_of(root)?;
    let cp = std::fs::read_to_string(saved_path(root)).ok()?;
    let cp = cp.trim();
    (!cp.is_empty()).then(|| cp.to_string())
}

/// Maven's compiler report: `[ERROR] /C:/p/src/main/java/A.java:[12,5] cannot find symbol`,
/// with detail lines (`[ERROR]   symbol: …`) after it.
pub fn parse_maven(output: &str) -> Vec<Diagnostic> {
    let header = regex::Regex::new(r"^\[(ERROR|WARNING)\] (.+?\.java):\[(\d+),(\d+)\] (.*)$").unwrap();
    let detail = regex::Regex::new(r"^\[(?:ERROR|WARNING)\]\s{2,}(\S.*)$").unwrap();
    let mut out: Vec<Diagnostic> = Vec::new();
    for line in output.lines() {
        if let Some(c) = header.captures(line) {
            let mut path = c[2].to_string();
            // Maven writes Windows paths as /C:/…
            if path.len() > 3 && path.starts_with('/') && path.as_bytes()[2] == b':' {
                path.remove(0);
            }
            if cfg!(windows) {
                path = path.replace('/', "\\");
            }
            out.push(Diagnostic::new(path, c[3].parse().unwrap_or(1), c[4].parse().unwrap_or(0), if &c[1] == "ERROR" { "error" } else { "warning" }, c[5].trim()));
        } else if let (Some(c), Some(last)) = (detail.captures(line), out.last_mut()) {
            last.add_detail(c[1].trim());
        }
    }
    // Maven lists each problem twice (while compiling and in the summary).
    let mut seen = std::collections::HashSet::new();
    out.retain(|d| seen.insert(d.key()));
    out
}

/// Gradle: add a task that writes the test runtime class path of every Java project.
const GRADLE_INIT: &str = r#"
gradle.projectsEvaluated { g ->
  g.rootProject.tasks.register('logiqClasspath') {
    doLast {
      def parts = [] as LinkedHashSet
      g.rootProject.allprojects.each { p ->
        if (p.plugins.hasPlugin('java')) {
          parts.addAll(p.sourceSets.test.runtimeClasspath.files.findAll { it.exists() }.collect { it.absolutePath })
        }
      }
      def out = new File(g.rootProject.projectDir, '.logiq/build-classpath.txt')
      out.parentFile.mkdirs()
      out.text = parts.join(File.pathSeparator)
    }
  }
}
"#;

fn java_home(jdk_home: &Option<String>) -> Option<PathBuf> {
    java_bin(jdk_home, "java").parent()?.parent().map(Path::to_path_buf).filter(|h| h.join("bin").is_dir())
}

fn count_sources(root: &Path) -> usize {
    let mut n = 0;
    crate::fs::walk(&root.join("src"), 20_000, &mut |p| {
        if p.extension().is_some_and(|e| e.eq_ignore_ascii_case("java")) {
            n += 1;
        }
    });
    n
}

/// Compiles main and test code with the project's build tool and saves its class path.
pub fn compile(root: &Path, jdk_home: &Option<String>) -> Result<CompileResult, String> {
    let started = Instant::now();
    let info = detect(root).ok_or("This folder isn't a Maven or Gradle project.")?;
    let Some(program) = info.program.clone() else {
        return Err(match info.tool {
            Tool::Maven => "This is a Maven project, but Maven wasn't found. Install Maven (maven.apache.org) and add its bin folder to the PATH, or add the Maven Wrapper (mvnw.cmd) to the project.",
            Tool::Gradle => "This is a Gradle project, but Gradle wasn't found. Install Gradle (gradle.org) and add its bin folder to the PATH, or add the Gradle Wrapper (gradlew.bat) to the project.",
        }
        .into());
    };
    let cp_file = saved_path(root);
    let _ = std::fs::create_dir_all(cp_file.parent().unwrap());
    let _ = std::fs::remove_file(&cp_file);
    let mut cmd = Command::new(&program);
    cmd.current_dir(root);
    if let Some(home) = java_home(jdk_home) {
        cmd.env("JAVA_HOME", home);
    }
    let init;
    match info.tool {
        Tool::Maven => {
            cmd.args(["-B", "-q", "-Dstyle.color=never", "test-compile", "dependency:build-classpath", "-Dmdep.includeScope=test"]).arg(format!("-Dmdep.outputFile={}", root.join("target").join("logiq-deps.txt").to_string_lossy()));
        }
        Tool::Gradle => {
            init = std::env::temp_dir().join("logiq-classpath.init.gradle");
            std::fs::write(&init, GRADLE_INIT).map_err(|e| e.to_string())?;
            cmd.args(["-q", "--console=plain", "--no-configuration-cache", "-I"]).arg(&init).args(["testClasses", "logiqClasspath"]);
        }
    }
    let output = no_window(&mut cmd).output().map_err(|e| format!("{} couldn't be started: {e}", if info.tool == Tool::Maven { "Maven" } else { "Gradle" }))?;
    let text = format!("{}{}", crate::fs::decode(&output.stdout), crate::fs::decode(&output.stderr)).replace("\r\n", "\n");
    let ok = output.status.success();
    if ok && info.tool == Tool::Maven {
        let deps = std::fs::read_to_string(root.join("target").join("logiq-deps.txt")).unwrap_or_default();
        let mut parts = vec![root.join("target").join("classes").to_string_lossy().into_owned(), root.join("target").join("test-classes").to_string_lossy().into_owned()];
        parts.extend(deps.trim().split(SEP).filter(|s| !s.is_empty()).map(str::to_string));
        std::fs::write(&cp_file, parts.join(SEP)).map_err(|e| e.to_string())?;
    }
    let diagnostics = match info.tool {
        Tool::Maven => parse_maven(&text),
        Tool::Gradle => parse_javac(&text),
    };
    Ok(CompileResult::new(ok, diagnostics, text, count_sources(root), started.elapsed().as_millis() as u64))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_maven_errors() {
        let out = "[ERROR] COMPILATION ERROR : \n[ERROR] /C:/Users/Ada/p/src/main/java/a/Main.java:[5,9] cannot find symbol\n[ERROR]   symbol:   class Scaner\n[ERROR]   location: class a.Main\n[WARNING] /C:/Users/Ada/p/src/main/java/a/Old.java:[3,1] [deprecation] Date in java.util has been deprecated\n[ERROR] /C:/Users/Ada/p/src/main/java/a/Main.java:[5,9] cannot find symbol\n[ERROR]   symbol:   class Scaner\n";
        let d = parse_maven(out);
        assert_eq!(d.len(), 2);
        let json = serde_json::to_value(&d).unwrap();
        assert_eq!(json[0]["line"], 5);
        assert_eq!(json[0]["column"], 9);
        assert_eq!(json[0]["message"], "cannot find symbol\nsymbol:   class Scaner\nlocation: class a.Main");
        assert_eq!(json[1]["severity"], "warning");
        if cfg!(windows) {
            assert_eq!(json[0]["path"], r"C:\Users\Ada\p\src\main\java\a\Main.java");
        }
    }

    /// A Maven project built for real: the class path with JUnit on it, running the program,
    /// and a compile error read from Maven's report. Needs `mvn` on the PATH (and the network
    /// the first time): `cargo test maven_end_to_end -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn maven_end_to_end() {
        let dir = std::env::temp_dir().join("logiq-maven-test");
        let _ = std::fs::remove_dir_all(&dir);
        let src = dir.join("src").join("main").join("java").join("app");
        let test = dir.join("src").join("test").join("java").join("app");
        std::fs::create_dir_all(&src).unwrap();
        std::fs::create_dir_all(&test).unwrap();
        let tpl = include_str!("../../src/lib/templates.ts");
        // The template's pom.xml, between its backticks.
        let pom = tpl.split("\"pom.xml\": `").nth(1).unwrap().split('`').next().unwrap().replace("{{artifact}}", "logiq-test");
        std::fs::write(dir.join("pom.xml"), pom).unwrap();
        std::fs::write(src.join("App.java"), "package app;\npublic class App {\n    public static void main(String[] a) { System.out.println(\"Grüße \" + greeting()); }\n    static String greeting() { return \"aus Maven\"; }\n}\n").unwrap();
        std::fs::write(test.join("AppTest.java"), "package app;\nimport org.junit.jupiter.api.Test;\nimport static org.junit.jupiter.api.Assertions.assertEquals;\nclass AppTest { @Test void works() { assertEquals(\"aus Maven\", App.greeting()); } }\n").unwrap();

        let info = detect(&dir).unwrap();
        assert!(info.program.is_some(), "mvn isn't on the PATH");
        let t = Instant::now();
        let r = compile(&dir, &None).unwrap();
        let json = serde_json::to_value(&r).unwrap();
        assert_eq!(json["ok"], true, "{}", json["output"]);
        eprintln!("built in {:?}", t.elapsed());
        let cp = saved_class_path(&dir).unwrap();
        assert!(cp.contains("junit-jupiter-api"), "{cp}");
        assert!(cp.starts_with(&dir.join("target").join("classes").to_string_lossy().into_owned()));
        // The runner's class path is the build's now.
        let runner_cp = crate::runner::class_path(&dir, &dir.join("out"));
        let out = no_window(Command::new(java_bin(&None, "java")).args(["-Dstdout.encoding=UTF-8", "-cp"]).arg(&runner_cp).arg("app.App")).output().unwrap();
        assert_eq!(String::from_utf8_lossy(&out.stdout).trim(), "Grüße aus Maven");

        // A mistake: Maven's report becomes a problem at the right line and column.
        std::fs::write(src.join("App.java"), "package app;\npublic class App {\n    public static void main(String[] a) {\n        Strin s = \"x\";\n    }\n    static String greeting() { return \"aus Maven\"; }\n}\n").unwrap();
        let r = compile(&dir, &None).unwrap();
        let json = serde_json::to_value(&r).unwrap();
        assert_eq!(json["ok"], false);
        let d = &json["diagnostics"][0];
        assert_eq!(d["line"], 4, "{json}");
        assert_eq!(d["column"], 9);
        assert!(d["message"].as_str().unwrap().contains("cannot find symbol"), "{d}");
        assert!(d["path"].as_str().unwrap().ends_with("App.java"));
        assert_eq!(json["diagnostics"].as_array().unwrap().len(), 1, "{json}");
    }

    #[test]
    fn knows_the_build_tool() {
        let dir = std::env::temp_dir().join("logiq-build-detect");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        assert!(detect(&dir).is_none());
        std::fs::write(dir.join("build.gradle.kts"), "plugins { java }\n").unwrap();
        assert_eq!(detect(&dir).unwrap().tool, Tool::Gradle);
        std::fs::write(dir.join("pom.xml"), "<project/>").unwrap();
        std::fs::write(dir.join(if cfg!(windows) { "mvnw.cmd" } else { "mvnw" }), "").unwrap();
        let info = detect(&dir).unwrap();
        assert_eq!(info.tool, Tool::Maven);
        assert!(info.wrapper);
        // No saved class path until a build wrote one.
        assert!(saved_class_path(&dir).is_none());
        std::fs::create_dir_all(dir.join(".logiq")).unwrap();
        std::fs::write(saved_path(&dir), "a;b\n").unwrap();
        assert_eq!(saved_class_path(&dir).as_deref(), Some("a;b"));
    }
}
