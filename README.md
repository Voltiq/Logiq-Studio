# Logiq Studio

An IDE for Java, Python, C, C++, Kotlin, PHP, SQL, HTML, CSS and JavaScript for Windows, built with Tauri 2, Rust and React in the Graphiq design
language shared with Graphiq, Inq, Magiq, Disq and Uplinq Studio. *Logiq* as in logic: write the code, and see
its structure as a UML class diagram that redraws itself while you type, as the Röhner Java-Editor does.

![Logiq Studio icon](public/app-icon.svg)

## What it does

- **Editor**: CodeMirror 6 with syntax colouring for Java, Python, C, C++, Kotlin, PHP, SQL, HTML, CSS,
  JavaScript, TypeScript, JSON and Markdown,
  bracket matching, folding, multiple cursors, find and replace, go to line, comment toggling, re-indenting,
  live syntax errors, Java completion (keywords, snippets such as `sout`/`main`/`fori`, your own classes and
  their members, common library classes), go to definition (`F12`), find usages, rename symbol (`F2`),
  formatting with Prettier (Java too), Emmet, colour swatches, breadcrumbs, sticky scroll and a split view.
- **Language servers**: Eclipse JDT LS for Java (installed once from Settings: errors as you type, completion
  that knows types, quick fixes with `Ctrl+.`, organize imports), the TypeScript language service for JavaScript
  and TypeScript, VS Code's HTML and CSS language services, ESLint for JavaScript and the project's Stylelint for
  style sheets. Java refactorings (extract variable, constant, field or method) with `Ctrl+Shift+R`.
- **UML class diagram** from the Java code in the folder: classes, abstract classes, interfaces, enums and
  records with attributes and methods in UML notation (visibility `+ - # ~`, static underlined, abstract in
  italics); generalisation, realisation, association with role names and multiplicities, dependency and nesting.
  Lines are right-angled and go around boxes; they can be bent by hand, and their labels moved. Several
  diagrams per project: `.uml` files that show a choice of classes.
  Boxes can be dragged (the layout is saved in `.logiq/uml.json`), the diagram can be arranged automatically,
  filtered by folder, zoomed, printed, and exported as SVG, PNG, PlantUML or Mermaid. Double-click a class or member
  to jump to its code. **Edit the code from the diagram**: create classes with a wizard, add, change and delete
  attributes, methods and constructors, draw inheritance and associations, add notes.
- **GUI designer**: design Swing windows by dragging buttons, labels, text fields, lists, sliders and more into
  the window, with snapping, guide lines and alignment; set their properties and events in an inspector. The code is
  written into the class as you go, between `// GUI-BEGIN` and `// GUI-END` comments, and stays editable: edits in
  the code show in the designer, undo works in both, and event handlers are ordinary methods you fill in.
- **Object bench**: create objects from the diagram's classes, call their methods with arguments, and watch their
  fields change, drawn as UML objects.
- **Run**: `F5` compiles every `.java` file with `javac` into `out/` and runs the main class; output streams into
  the panel, and keyboard input (for `Scanner`) can be typed while the program runs. Compiler errors are listed
  under Problems and underlined in the editor. JavaScript files run with Node.js; HTML pages show in the live
  preview, which reloads on save.
- **Debugger**: breakpoints, stepping, call stack, variables and watches; record a run as a UML sequence diagram.
- **Java tools**: run configurations (main class, arguments, JVM options), JShell, JUnit 5 tests with a results
  tree, runnable JAR export, Javadoc, a library manager for `lib/`.
- **Workspace**: explorer with create, rename, delete (to the Recycle Bin), find in files (text, whole word,
  case, regex), outline of the active Java or Python file, quick open (`Ctrl+P`), command palette (`Ctrl+Shift+P`), and the
  folder is watched so changes made elsewhere show up at once. Drag files to move them, cut, copy, paste and
  duplicate them; unsaved changes and open tabs survive a restart. Live Markdown preview.
- **Terminal**: PowerShell, the Command Prompt or Git Bash in the bottom panel, several at once, with the
  project's JDK on the path.
- **More languages** (plug-ins: grammar, runner, outline, diagram, language server):
  - **Python**: runs with the project's interpreter (its `.venv` first) with input from the panel; an exception
    becomes a problem at its line; virtual environments, `requirements.txt` and packages; pytest or unittest;
    classes in the outline and the **class diagram**; Pyright, basedpyright, pylsp or jedi when installed.
  - **C and C++**: compiled with clang or gcc (found where LLVM, MSYS2 or MinGW put them), errors as problems,
    run with input; clangd (comes with LLVM) for completion and errors as you type; clang-format.
  - **PHP**: scripts run with the PHP command line; pages show in the preview, served by PHP's web server;
    every save is checked with `php -l`.
  - **Kotlin**: compiled with kotlinc into a jar and run on the IDE's JDK; `.kts` scripts.
  - **SQL**: scripts run against SQLite (compiled in) — the database is named in the file
    (`-- database: shop.db`) or a fresh one in memory; `Ctrl+Enter` runs the statement at the cursor; results in
    Atomiq Studio's grid; tables and columns complete as you type.
  - Templates for each, and Settings → Languages to choose the interpreter or compiler.
- **Git**: a source control view (stage, commit, branches, push, pull, history), changed files coloured in the
  explorer, a change bar in the editor, side-by-side diffs, and cloning from the welcome screen. Merging and
  rebasing with **conflict resolution** in the editor (accept current, incoming or both), stashes, tags, and
  blame (`Ctrl+Alt+B`).
- **Maven and Gradle**: projects compile with their build tool (wrapper or installed), and Run, Debug, the
  object bench and tests use its class path; build tasks run in the terminal; templates for both.
- **Languages**: English and German.

## Develop

```bash
npm install
npm run tauri dev
```

Work on the interface in a browser against an in-memory stand-in for the native side (http://localhost:1430):

```bash
npm run dev
```

Tests:

```bash
npm test
```

```bash
cd src-tauri && cargo test
```

A JDK (Java 17 or newer recommended) must be installed for compiling and running Java. Logiq Studio finds it
through `JAVA_HOME`, `PATH` and the usual install folders, or it can be chosen in Settings.

See [ROADMAP.md](ROADMAP.md) for what is done and what comes next.
