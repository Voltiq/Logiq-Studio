# Logiq Studio — Roadmap

A professional IDE for Java, HTML, CSS and JavaScript on Windows, built with Tauri 2, Rust and React in the
Graphiq design language. *Logiq* as in logic: the code you write and the structure it has, side by side — the
UML class diagram draws itself from your Java code while you type, like in the Röhner Java-Editor.

`[x]` = done, `[ ]` = to do. Work top to bottom: each milestone builds on the one before it.

---

## v0.1 — Foundation (2026-11-13)

### Native side (Rust)
- [x] Tauri 2 app `com.voltiq.logiq-studio`; window starts hidden and shows once themed (no white flash),
      custom title bar, single instance (a second start hands its folder to the open window)
- [x] Folders and files given on the command line open on start
- [x] File system: list folders (folders first, natural order), read text (UTF-8, falls back to Windows-1252,
      keeps CRLF or LF per file), safe save (written next to the file, then swapped in), create, rename,
      delete to the Recycle Bin, binary detection, binary write for exports
- [x] Folder watcher (`notify`): explorer, open editors and the UML diagram follow changes made outside the app
- [x] Find in files: plain text or regex, match case, whole word, UTF-16 columns for the editor, skips build
      output and binaries
- [x] JDK detection: `JAVA_HOME`, `PATH` (incl. Oracle's `javapath` links), Program Files vendors (Oracle,
      Temurin, Microsoft, Zulu, Corretto, Liberica, Semeru), `~/.jdks`; versions read from `release`
- [x] Node.js detection
- [x] `javac` build of every `.java` file into `out/` (argument file for long projects, `lib/*.jar` on the class
      path, English diagnostics in UTF-8), parsed into problems with line, column and detail lines
- [x] Run Java and Node programs without a console window; stdout/stderr streamed as they are written (UTF-8
      safe across reads), keyboard input to the running program, stop
- [x] Live web preview served from the open folder on its own origin (`logiq-preview://`), so relative CSS,
      script and image links work; nothing outside the folder is served
- [x] `cargo test`: 9 tests (natural order, line endings and encodings, walking, search, javac diagnostics,
      UTF-8 streaming, Java versions, preview path safety, a real compile with the installed JDK)

### Editor and workspace (React + Graphiq)
- [x] Graphite (dark) / Porcelain (light) / System themes from the shared Graphiq tokens, Geist + Geist Mono;
      shared Button, Menu, Modal, Select, Field, Tooltip and Feedback components
- [x] App icon: a UML class card with a code badge
- [x] Welcome screen: new project, open folder, templates, recent folders, JDK status
- [x] Project templates: Java classes (interface, abstract class, inheritance, collection), Java console app
      (Scanner input), Web page (HTML, CSS, JS)
- [x] CodeMirror 6 editor with one state per file (own undo history and selection): Java, HTML, CSS,
      JavaScript, TypeScript, JSON, Markdown; line numbers, folding, bracket matching and closing, multiple
      cursors, find and replace, go to line, toggle comment, format (re-indent), live syntax errors
- [x] Java completion: keywords, snippets (`sout`, `main`, `fori`, `foreach`, `getter`, `setter`, `try`…), the
      project's classes, members after a dot (own, inherited, `this.`, declared variables) and common library
      classes (String, Math, Scanner, List, Map, StringBuilder…)
- [x] Explorer: lazy tree, keyboard navigation, context menu (new file / Java class / folder, rename, delete,
      copy path, reveal in File Explorer, open in preview), dirty and error markers
- [x] Tabs: dirty dot, middle-click close, context menu (close others / to the right / saved / all)
- [x] Unsaved-changes guard on closing tabs, folders and the window (Save / Don't save / Cancel)
- [x] Find in files panel, outline of the active Java file (follows the cursor)
- [x] Quick open (`Ctrl+P`), command palette (`>`), go to line (`:`), menus and shortcuts from one command list
- [x] Output panel with coloured streams and an input line (history with ↑/↓); Problems panel; compiler errors
      underlined in the editor and the first error opened
- [x] Web preview with full / tablet / phone widths, reload on save, open in the browser
- [x] Status bar: problems, cursor, indentation, encoding, line endings, language, Java and Node versions
- [x] Settings: theme, text size, tab size, spaces, wrap, line numbers, auto-close, auto save, save before run,
      live preview, JDK
- [x] Resizable side bar, panel and preview; sizes remembered
- [x] Browser stand-in for the native side (`npm run dev`) with a sample project

### UML class diagram
- [x] Tolerant Java declaration parser (packages, imports, nested classes, interfaces, enums with bodies,
      records, annotation types, generics with bounds, varargs, old-style array dimensions, field declarator
      lists, initialisers with generic commas, `new X()` in bodies, umlauts); never throws on half-typed code
- [x] Live: the diagram follows the editor as you type, before saving
- [x] UML notation: «interface», «abstract», «enumeration», «record»; `+ - # ~`; static underlined, abstract
      in italics; attributes `name: Type`, operations `name(p: Type): Return`; enum constants
- [x] Relations: generalisation (hollow triangle, shared tree lines), realisation (dashed), association with
      role name and multiplicity (`1`, `0..1`, `0..*` for arrays and collections), bidirectional pairs offset,
      self-associations, optional dependency (parameters, return types, `new`) and nesting
- [x] Automatic layered layout (supertypes above, children centred under parents, long rows wrapped); drag
      boxes, arrow keys to nudge, layout saved per folder in `.logiq/uml.json`; new classes placed beside
- [x] Pan, wheel and `Ctrl`+wheel zoom, fit, 100 %; hover highlights a class's relations
- [x] Filter by folder, hide classes, view options (compartments, constructors, private members, parameters,
      types, visibility symbols, relation kinds)
- [x] Double-click a class or member to jump to its line; context menu (go to source, hide, copy name)
- [x] Export as SVG or PNG (print colours, fonts embedded) and copy as image
- [x] `vitest`: 11 tests for the parser, relations, multiplicities, layout and routing

### Known limits of v0.1
- Completion and error checking are syntax-level; type errors appear when compiling (`F5` / `Ctrl+F9`)
- No debugger, integrated terminal or Git yet
- Lines between classes are straight or simple trees and can cross boxes in crowded diagrams
- ~~The interface is in English only~~ (German in v0.2)
- Not yet run as an installed app end to end; the interface was checked in the browser stand-in and the
  native side with `cargo test` and a debug build

---

## v0.2 — Editor depth (2026-11-13)

### Editor
- [x] **Format document** (`Shift+Alt+F`) with Prettier: Java through prettier-plugin-java, HTML, CSS,
      JavaScript, TypeScript, JSON and Markdown; loaded on first use, one undoable change, cursor kept;
      re-indent for other files; optional **format on save**
- [x] **Emmet** in HTML and CSS: abbreviations are tracked while typing and expand with `Tab`, or any time with
      `Ctrl+E`
- [x] **Colour swatches** beside CSS colours (`#hex`, `rgb()`, `hsl()`); clicking one opens the colour picker and
      writes the new colour back, keeping its alpha
- [x] **Go to definition** (`F12` or `Ctrl`+click) for the project's classes, fields, methods (inherited ones
      too), enum constants, nested classes, parameters and local variables; `Alt`+click now adds a cursor
- [x] **Find usages** (`Shift+F12`): whole-word, case-sensitive search over the Java files in the search panel
- [x] **Rename symbol** (`F2` in a Java editor): a local variable or parameter within its method, anything else
      in every Java file (skipping comments and strings); open files change without saving, closed ones are
      rewritten; renaming a top-level class renames its file; the class keeps its place in the UML diagram
- [x] **Split editor** (`Ctrl+\`): a second editor group beside the first, each with its own tabs; move tabs
      between groups from the context menu or by dragging; *Show UML class diagram to the side* puts code
      and diagram next to each other (new Java class projects open that way)
- [x] **Breadcrumbs** under the tabs: the file's folders, then the class and method at the cursor
- [x] **Sticky scroll**: the class and method the top line belongs to stay pinned above the code
- [x] Opening or switching to a file puts the keyboard focus in its editor

### Workspace
- [x] Explorer: multi-select (`Ctrl`/`Shift`+click, `Shift`+arrows, `Ctrl+A`), **drag and drop to move** (folders
      open while hovering), **cut / copy / paste** (`Ctrl+X/C/V`, copies get “copy” names), **duplicate**, delete
      several at once, **filter by name** (fuzzy, over the whole folder), *Open to the side*
- [x] **Hot exit**: closing the window keeps unsaved text instead of asking; the last folder, its tabs, both
      groups, pinned tabs and the unsaved text come back on the next start (can be switched off in Settings)
- [x] Tabs: **reorder by dragging**, **pin** (pinned tabs stay first and survive *Close all / others*)
- [x] **Markdown preview**: rendered live as you type, relative images resolved from the folder, no scripts
- [x] `Ctrl+G` goes to a line through the palette (it was CodeMirror's “find next”)
- [x] Native: recursive copy (`fs_copy`), with a test

### Interface
- [x] **German** interface (`de.ts`, 300+ strings), chosen from Windows or in Settings › Language; a test checks
      that every interface string is translated and keeps its placeholders
- [x] The side group, preview and side bar shrink instead of pushing the window wider
- [x] Opaque line-number gutter, so code scrolled sideways no longer shows through

### Known limits of v0.2
- Find usages and rename work on names, not types: two unrelated members with the same name in different
  classes are renamed together (a message afterwards counts the places; the language server in v0.5 fixes this)
- Emmet's `Tab` expansion needs the abbreviation to be typed; pasted text expands with `Ctrl+E`
- Drag and drop, hot exit and the split editor were checked in the browser stand-in, not yet in the installed app

---

## v0.3 — UML like the Röhner editor (2026-11-13)

### Editing the code from the diagram
- [x] **Class wizard** (*New class* in the diagram, `File › New Java class…`, explorer): name, kind (class,
      abstract class, interface, enum with constants, record), superclass and interfaces (project classes
      suggested), an attribute table (visibility, name, type, static, final), and a constructor with all
      attributes, getters, setters, `toString()` and `main` on request, with a live preview of the code;
      imports for `List`, `ArrayList`, `Map`, `Scanner`… are added
- [x] **Add, edit and delete members** from a class's or member's context menu: attributes (with getter and
      setter), methods (abstract where allowed) and constructors; a changed name is renamed wherever it is used,
      type, visibility, modifiers and parameters are rewritten in place, bodies and initial values are kept;
      deleting takes the member's Javadoc and annotations along
- [x] **Edit class**: rename (class, file and uses), superclass, interfaces
- [x] **Draw relations**: the inheritance tool (subclass → superclass or interface: `extends` or `implements`
      as fits, replacing a previous superclass with a note) and the association tool (asks for role name,
      multiplicity 1 or 0..* and visibility; adds `private Target role;` or `List<Target> roles = new ArrayList<>()`)
- [x] **Delete relations** from a line's context menu: removes the `extends` / `implements` entry or the fields
- [x] **Delete classes**: the file goes to the Recycle Bin, or a nested class's declaration is removed
- [x] Changes go into open editors as one undoable step, closed files are rewritten; the diagram follows
- [x] `codegen.ts` with 9 tests (whole classes, fields after fields, an enum's `;`, constructors before methods,
      interface methods without bodies, removing shared declarations, signatures, supertypes, imports)

### Object bench
- [x] **Create objects** from a class's context menu, one entry per constructor (`new Circle(double, double,
      double)`), with named argument fields; arguments are numbers, `true`/`false`, text, `char`, enum
      constants, arrays (`{1, 2, 3}`), `null` or the name of another object on the bench
- [x] **Call methods** on an object by clicking its card (its own and inherited ones), and **static methods**
      (including `main`) from the class's menu; the result shows above the bench, objects returned by a method
      can be **put on the bench**, `System.out` output goes to the Output panel, exceptions show their message
      and the program's own stack lines
- [x] Objects drawn in UML object notation (`circle1 : Circle`, `radius = 3.5`); references to other bench
      objects are links that highlight the referenced object; collections and arrays are summarised
- [x] The bench compiles the project first; when the code changes it offers a restart; reset and stop buttons;
      a call still running after 15 s can be stopped
- [x] Native: a helper JVM (`bench/LogiqBench.java`, compiled once per JDK into the app cache) answering by
      reflection, one JSON line per request; a test drives it with a real JDK

### Diagram
- [x] **Notes** on the canvas (note tool, drag, double-click to edit, saved with the layout)
- [x] **Package frames** around the classes of each package when there is more than one
- [x] **Library classes** as grey boxes (option): `Scanner`, `Random`… that the project's fields and methods use
- [x] **Export as PlantUML or Mermaid** (file or clipboard) and **print** (print colours, fitted to the page)
- [x] A renamed class keeps its box's place (also for renames done in code)

### Still open, moved on
- [x] Orthogonal line routing around boxes, manual bend points, label dragging (done in v0.5)
- [x] Several diagrams per project (`.uml` files) (done in v0.5)
- [x] Sequence diagrams generated from a run: needs the debugger's tracing (done in v0.4)

### Known limits of v0.3
- The bench creates objects through constructors and calls methods with simple arguments; expressions like
  `new Point(1, 2)` as an argument are not evaluated (create the object first, then pass its name)
- A method that reads from the keyboard gets no input on the bench
- The diagram editing and the bench were checked with unit tests, a real-JDK test of the helper and the
  browser stand-in; not yet in the installed app

---

## v0.4 — Java toolchain (2026-11-13)

### Debugger
- [x] **Breakpoints**: a click left of the line numbers or `F9`; red dots that follow their lines as code is
      edited; kept per project; listed in the debugger with jump and remove; set and removed while running
- [x] **Debugging** (`F6`): the program runs under JDI (a helper JVM, `bench/LogiqDebug.java`); it stops at
      breakpoints and at uncaught exceptions (with the message), the current line is highlighted
- [x] **Stepping**: continue (`F8`), step over (`F10`), into (`F11`), out (`Shift+F11`), pause, stop; library code
      (`java.*`) is stepped over; controls in the top bar and in the debugger panel
- [x] **Call stack** with frame selection (variables of any frame), **variables** as a tree (fields of objects,
      array elements, `ArrayList` elements, boxed values and enums shown as values), **watches** (paths like
      `shapes[0].x`, `this.name`, `array.length`), program output and keyboard input while debugging
- [x] Native test against a real JDK: breakpoint, variables, step into / out / over, watch, expand, output with
      umlauts, exit code

### Sequence diagrams
- [x] **Record a run** (Run menu or the sequence tab): every call between the project's classes is traced
      (method entry and exit, arguments and return values, up to 2000 calls), objects are named `circle1 : Circle`
- [x] Drawn as a UML sequence diagram: participants, lifelines, activation bars (nested calls too), calls with
      arguments, `«create»`, dashed returns with values; export as SVG, copy as PlantUML

### Running and building
- [x] **Run configuration**: the main class (the active file's, the only one, or a chosen one), program
      arguments (quoted like a shell) and JVM options, for Run and Debug
- [x] **JShell** tab: a JShell session with the project's compiled classes, history with ↑/↓, UTF-8 throughout
- [x] **JUnit 5**: *Run all tests* (`Ctrl+Shift+T`), a class or a test class from the diagram; results as a tree with
      times, failures with their message, a click opens the test; the console launcher is downloaded from Maven
      Central into `lib/` after asking; *Create JUnit test* in a class's menu writes a test class to fill in
- [x] **Export runnable JAR** (`java -jar` ready, libraries copied beside it and listed in the manifest) and
      **Javadoc** (private members included, opened in the browser); both tested against a real JDK
- [x] **Libraries** dialog for the JARs in `lib/` (add, remove); they are on the class path everywhere
- [x] **Install a JDK** help when none is found (Temurin download, `winget` command, search again without restart)

### Still open, moved on
- [ ] Maven and Gradle projects (no Maven or Gradle on this machine to test with) → v0.6
- [ ] GUI designer for Swing / JavaFX forms → its own milestone, v0.8

### Known limits of v0.4
- Watches follow variables, fields and indexes; method calls and arithmetic in watches aren't evaluated yet
- No conditional breakpoints or hit counts yet; the debugger shows the thread that stopped (or `main` when paused)
- JUnit's download from Maven Central and the whole debugger UI were checked with the browser stand-in; the
  native parts were tested against the JDK, but not yet in the installed app

---

## v0.5 — Language intelligence (2026-11-13)

### Language servers
- [x] **LSP client** in the editor (CodeMirror's LSP client): completion, hover documentation, signature help,
      go to definition (`F12`, `Ctrl`+click), find references (`Shift+F12`), rename (`F2`), problems as you type
      in the editor and the Problems panel; servers' edits to files that aren't open are written to disk
- [x] **Java language server** (Eclipse JDT LS): downloaded once on request (Settings → Java, about 50 MB from
      eclipse.org) into the app's data folder, started per project with `lib/*.jar` on the class path; errors as
      you type, completion that knows types, **quick fixes** (`Ctrl+.`, e.g. *Import 'List' (java.util)*),
      **organize imports** (`Shift+Alt+O`); the JDK's internal packages are left out of completion and fixes; a
      status item shows when it starts; it can be switched off, and Java then uses Logiq Studio's own completion
- [x] **TypeScript language service** in a web worker for JavaScript and TypeScript: types and documentation
      of the DOM and the standard library on hover, completion, syntax errors (and type errors in TypeScript),
      definition, references, rename, signature help
- [x] **HTML and CSS language services** (the ones VS Code uses) in a web worker: completion of tags,
      attributes, properties and values; hover documentation; CSS validation (unknown properties, empty rules,
      duplicate properties); definition, references and rename of CSS variables and selectors; renaming an HTML
      tag renames its closing tag
- [x] **ESLint** for JavaScript files, with rules that find real mistakes (unused variables, `==`, unreachable
      code, duplicate keys and cases, assignments in conditions, `NaN` comparisons…)
- [x] Native test against the real JDT LS: install, start, errors, completion and quick fixes

### UML class diagram
- [x] **Right-angled lines that go around boxes** (A* over the lines just outside the boxes, as few bends as
      possible); straight lines are still an option (View → *Right-angled lines*)
- [x] **Bend points**: click a line, drag a handle on it to add a bend, drag a bend to move it (it snaps into
      line with its neighbours; `Alt` turns that off), double-click a bend to remove it; *Reset the line*
- [x] **Labels can be dragged**: role names and multiplicities; *Reset the labels*
- [x] **Several diagrams per project**: `.uml` files that show a choice of classes (*New class diagram…* starts
      from the selected class and the classes it is related to); *Classes…* picks them, *Add related classes*
      and *Remove from diagram* in a class's menu; the project diagram still shows every class; a `.uml` file
      opens from the explorer

### Still open, moved on
- [x] Stylelint: the CSS language service's validation covers the common mistakes; a full Stylelint needs Node (done in v0.6)
- [x] Java refactorings beyond rename (extract method / variable) through the language server (done in v0.6)

### Known limits of v0.5
- JDT LS needs Java 21 or newer to run itself (projects can target older versions); its first start in a project
  indexes the JDK and takes a little while
- Bend points stay where they are when a box moves; *Arrange automatically* resets them
- The language servers were tested in the browser stand-in (TypeScript, HTML, CSS, ESLint) and natively (JDT LS
  framing, install and a whole session); the Java server inside the installed app isn't checked yet

## v0.6 — Terminal, Git and build tools (2026-11-13)

### Terminal
- [x] **Integrated terminal** in the bottom panel: real shells in a pseudo console (ConPTY), drawn with xterm.js;
      several terminals with a list beside them; PowerShell, Windows PowerShell, the Command Prompt or Git Bash
      (Settings → Terminal, or *New terminal with…*); opens in the project folder with the IDE's JDK first on the
      `PATH` and as `JAVA_HOME`
- [x] ``Ctrl+` `` shows and hides it, ``Ctrl+Shift+` `` opens another; keys like `Ctrl+R`, `Ctrl+B` or `Ctrl+W` go to
      the shell, `Ctrl+C` copies when text is selected, `Ctrl+V` pastes; links open in the browser; colours follow
      Graphite and Porcelain; a shell that ends starts again with Enter
- [x] Native test against a real PowerShell: output comes back (umlauts too, split between reads), the exit is seen

### Git
- [x] **Source control** view (`Ctrl+Shift+G`): branch, ahead and behind, staged changes and changes (stage,
      unstage, discard with Recycle Bin for new files, all at once), commit message with `Ctrl+Enter`, commit
      everything when nothing is staged (after asking), amend; asks for name and e-mail when git doesn't know them
- [x] **Explorer colours** and letters (M, U, A, D, !) for changed, new, deleted and conflicting files, a dot on
      folders that hold changes, ignored files dimmed
- [x] **Change bar** in the editor: added, changed and deleted lines since the last commit; a click opens the diff
- [x] **Diff view**: side by side, unchanged stretches folded, previous and next change; the working copy's diff
      follows edits
- [x] **Branches**: switch (remote branches become tracking branches), new branch; in the status bar too
- [x] **Push, pull, fetch, sync** with progress; publishing a branch sets its upstream; *Add a remote…* when there
      is none; git never waits for a password in the background (the Windows credential manager asks)
- [x] **History**: the last 200 commits with refs and dates; a commit's files and what changed in each
- [x] **Clone a repository** from the welcome screen or the File menu, with git's progress, then open it
- [x] Native tests against real repositories: status with umlaut paths, staging, commit, log, branches, clone
      through the streaming runner and push back

### Maven and Gradle
- [x] A folder with `pom.xml` or a Gradle build compiles with its build tool (the project's wrapper when it has
      one, else Maven or Gradle from the `PATH`); Run, Debug, the object bench, JUnit and JShell use the class
      path the tool works out, dependencies included (`.logiq/build-classpath.txt`)
- [x] Maven's compiler errors and Gradle's are listed under Problems and underlined like javac's
- [x] **Build tool tasks** in the Run menu and the status bar (compile, test, package, install, clean,
      dependencies; any goal or task) run in the terminal; *Run all tests* runs the tool's test task
- [x] New project templates: **Maven project** and **Gradle project** (Kotlin DSL) with a JUnit 5 test
- [x] Native test with a real Maven 3.9: build with JUnit on the class path, run, a compile error at the right line

### Language intelligence
- [x] **Refactor…** (`Ctrl+Shift+R`) through JDT LS: extract to local variable, constant, field or method, surround
      with try/catch and the rest JDT LS offers for the selection (checked against the real JDT LS)
- [x] **Stylelint** for CSS, SCSS and Less with the project's own Stylelint (from `node_modules`, its configuration
      applies), run with Node.js

### Still open, moved on
- [x] Merge conflicts: a view to pick ours / theirs per conflict (conflicting files are marked and block a commit) (done in v0.7)
- [x] Stash, tags, rebase and blame in the interface (they work in the terminal) (done in v0.7)

### Known limits of v0.6
- Gradle was tested with unit tests only (no Gradle on this machine); its class path comes from an init script
  that reads `sourceSets.test.runtimeClasspath`
- Stylelint was tested with unit tests (the report format) only, not with a real Stylelint install
- The terminal, Git and the build tools were tried in the browser stand-in and tested natively in parts; not
  yet in the installed app

## v0.7 — More languages (2026-11-13)

### Language plug-ins
- [x] **Language support as plug-ins** (`src/languages`): each language has its grammar (`editor/languages.ts`),
      and a plug-in with its runner, compile or check step (`Ctrl+F9`), tests, language server, check after
      saving, outside formatter, status bar item, commands, terminal environment and editor keys; a structure
      parser (`uml/javaIndex.ts`) gives the outline and the class diagram
- [x] Tools found where their installers put them (PATH, LLVM, MSYS2, MinGW, python.org, C:\php, XAMPP, Scoop,
      npm), never Windows' Store aliases; chosen in the status bar or **Settings → Languages** (Python per project)
- [x] Language servers start with a language's first file when installed, and stop with the folder: clangd,
      Pyright / basedpyright / pylsp / jedi, Intelephense / phpactor, kotlin-language-server
- [x] File icons, templates and German texts for every new language

### Python
- [x] **Run** with the project's interpreter (a `.venv`, `venv` or any folder with `pyvenv.cfg` comes first),
      unbuffered UTF-8 output as it is printed, input from the panel, program arguments from the run configuration
- [x] An **exception becomes a problem** at the line in your own code where it happened (the last frame inside
      the project), opened and underlined; `Ctrl+F9` checks the syntax with `py_compile`
- [x] **Virtual environments**: create `.venv` (and install `requirements.txt` into it), install packages; new
      terminals start with the environment active
- [x] **Class diagrams from Python classes**: base classes, class attributes, annotated fields, every
      `self.x = …` in a method (its type from the annotation, the value or the parameter), methods with
      `@staticmethod` / `@classmethod` / `@abstractmethod` / `@property`, `_protected` and `__private`, enums,
      protocols, nested classes, `list[X]` as 0..*, `X | None` as 0..1; shown, not edited, in the diagram
- [x] Outline with classes and module-level functions; **tests** with pytest when installed, else unittest
- [x] Tested: the parser and the traceback reader (with Python 3.14's own output), the run in the browser stand-in

### C and C++
- [x] Compiled with **clang or gcc** (`-std=c17` / `-std=c++20 -Wall -Wextra -g`, more flags in Settings): the
      file's folder makes one program, leaving out other files with a `main`; output in `build/`
- [x] Errors and warnings from gcc, clang (and MSVC's form) as problems with their column; `note:` lines added
- [x] **Run with input** from the panel; clangd for completion, hover and errors as you type; **clang-format**
      (the project's `.clang-format`, else the editor's indent)
- [x] Tested natively: clang 23 compiles and runs a program with umlauts and keyboard input, a compile error at
      the right line and column; clangd with the app's flags reports errors and completes struct members

### PHP, Kotlin, SQL
- [x] **PHP**: scripts run with the command line; pages (HTML, `$_GET`…) open in the preview, served by
      `php -S` from the project folder and reloaded on save; every save is checked with `php -l`
- [x] **Kotlin**: the project's `.kt` files compile with kotlinc into a jar (with the runtime) and the file's
      `main` runs on the IDE's JDK; `.kts` scripts run with `kotlinc -script`; kotlinc's errors are problems
- [x] **SQL with SQLite** (compiled in): the database is named in the file (`-- database: shop.db`) or a fresh
      one is used in memory; F5 runs the file or the selection, `Ctrl+Enter` the statement at the cursor;
      statements split where SQLite says a statement ends (triggers stay whole); stops at the first error, which
      becomes a problem; **Results** panel with each statement and **Atomiq Studio's grid** (virtual rows,
      sorting, column widths, copy as TSV); tables and columns complete as you type
- [x] Tested natively: PHP's web server serves a page; SQL scripts, offsets, triggers, errors, file databases,
      schema and row limits

### Git
- [x] **Merge** a branch and **rebase** onto one; a stopped merge, rebase, cherry-pick or revert shows a banner
      with Continue (no editor opens), Skip (rebase) and Abort
- [x] **Merge conflicts in the editor**: blocks coloured, and above each: accept current, incoming or both, or
      compare; per file: take one side, compare the two sides, mark as resolved (warns when markers are left)
- [x] **Stashes** (with new files): stash with a message, apply, pop, drop, see their files and diffs
- [x] **Tags**: annotated or light, on HEAD or a commit from the history; delete (here, or on origin too); push
- [x] **Blame** (`Ctrl+Alt+B`): commit, author and age beside each run of lines, for the text as it is in the
      editor; a click opens what that commit changed in the file
- [x] Tested against real git: merge with a conflict resolved and committed, rebase continued without an editor,
      stash with new files, tags and blame of unsaved text (umlaut file names included)

### Known limits of v0.7
- Kotlin was tested with unit tests only (no kotlinc on this machine); Python, PHP and Kotlin language servers
  weren't tried (none installed here) — clangd was
- C and C++ build the file's folder as one program; projects with CMake or make run in the terminal
- The PHP preview needs PHP's web server; pages that need a database server or Apache's rewrite rules don't run
- Not yet tried in the installed app; checked in the browser stand-in and with native tests

## v0.8 — GUI designer (2026-11-13)

### Designing a window
- [x] **GUI designer** for Swing windows: a palette (button, label, text field, password field, text area, check
      box, radio button, combo box, list, spinner, slider, progress bar, panel), the window as it will look (Swing's
      Windows look, which the generated `main` sets), and an inspector
- [x] Drag a component in from the palette, or pick it and draw it; move and resize with handles, snapping to the
      8-pixel grid and to the other components' and the window's edges and centres with guide lines (Alt: free);
      rubber-band and Shift/Ctrl selection; arrows nudge (Shift: 8 px); Ctrl+C / X / V / D, Delete; bring to front
      and send to back; align edges and centres, same width or height, spread evenly; zoom 75–200 %
- [x] **Inspector**: the window's title, size, resizable and background; per component its variable name
      (checked; renaming renames it in all the code, handlers included), text, items, position and size, value,
      minimum, maximum, step and ticks, text alignment, font size, bold, italic, text and background colour,
      image, tooltip, enabled, editable, selected, line wrap, button group, border title
- [x] **Events**: actionPerformed, stateChanged, valueChanged, mouseClicked, keyReleased; ticking one writes the
      listener and a handler method (`okButton_ActionPerformed`) to fill in; a double-click (or Enter) on a
      component goes to its main handler, writing it first if needed

### The code stays yours
- [x] The window is the class's code: the designer writes two regions (the fields, and the components in the
      constructor) between `// GUI-BEGIN …` and `// GUI-END …` comments; everything else, handlers included, is
      left as you write it; removing a component keeps its handler
- [x] Each change goes into the code at once, as a change of the editor's text: undo and redo (in the designer
      too) are the editor's, and the designer follows edits made in the code, also inside the regions (formatted
      code reads too; statements it doesn't know, such as `okButton.setMnemonic(…)`, are kept with their
      component)
- [x] **File → New Swing window**, the explorer's *New Swing window…*, a **Swing window** project template with a
      working greeting form; *Design* in the code's breadcrumb bar and *Open in the GUI designer* go back
- [x] The code view opens beside the designer for handlers; Run starts the window; the class appears in the UML
      diagram like any other
- [x] Tested: writing and reading back every component, property and event, formatted code and kept statements,
      renaming, snapping and alignment; the generated code (every component, property and event) and the template
      compile with the real javac without a warning; the designer tried in the browser stand-in

### Still open, moved on
- [ ] JavaFX windows (FXML) → later
- [ ] Containers with their own layout (components inside a panel, layout managers) → 1.8

## v1.0 — Release (2026-11-17)

### Installing and updating
- [x] **Windows installer** (NSIS) for the current user, no administrator needed, in English, German, Spanish and
      French; 7.7 MB, the WebView2 runtime fetched only when missing
- [x] **Signed updates from GitHub Releases** like the other Studio apps: the app asks for `latest.json` at start
      (Settings → Updates switches that off), shows what is new, and installs in the background and restarts;
      a version can be skipped; Help → Look for updates. Updates install only with a valid signature (minisign
      key; the public half is in `tauri.conf.json`, the private one in `~/.tauri/logiq-studio.key`, never in
      the repository)
- [x] GitHub workflows: **CI** (type-check, build, interface and Rust tests, release build) and **Release** (a
      `v*` tag builds the installer and the signed update files and publishes them with the version's section of
      `CHANGELOG.md` as notes)
- [x] **File associations**: `.java` and `.uml` open in Logiq Studio; HTML, CSS, JavaScript, TypeScript, JSON,
      Markdown, Python, C, C++, Kotlin, PHP and SQL files get Logiq Studio in their *Open with* list without
      taking over their default program (a `.py` still runs, a `.html` still opens the browser)
- [x] **"Open with Logiq Studio"** on folders in Explorer, on the folder and on the empty space inside it; both
      are removed again on uninstall
- [x] A test keeps the version the same in `package.json`, `Cargo.toml`, `tauri.conf.json` and the changelog

### Help
- [x] **Manual** (`F1`, Help → Manual) in English, German, Spanish and French, with chapters on the left; the
      same Markdown files are in `docs/`, and a test keeps the translations' chapters, lists, tables and keys in
      step with the English one
- [x] **Tour** of the window on the first start (seven steps, each pointing at its part; Esc leaves; again from
      Help → Tour of the window)

### Languages
- [x] **Spanish and French**: all 1,200 interface texts, beside English and German; Settings → Language; the
      language follows Windows' when none is chosen; the page's `lang` is set, so screen readers pronounce it
      right
- [x] Tests: every text the interface shows is translated in all three, placeholders and the ellipsis of
      commands that ask for more kept

### Accessibility
- [x] **The class diagram with a screen reader**: the selected class is read out in words (kind, name, what it
      extends and implements, attributes and methods with their visibility spoken, what it has, uses and is
      used by); the diagram is an application landmark that says how to use it
- [x] **The class diagram with the keyboard**: arrow keys go from class to class in that direction (the class
      is brought into view), Home and End, Enter opens the code, the menu key (or Shift+F10) opens the class's
      menu, Alt with the arrows moves the box
- [x] **The GUI designer with the keyboard**: an arrow key selects the first component, Tab goes on to the
      next, arrows move, Enter opens the event handler; components are named for screen readers
- [x] Rows that only reacted to a click (changed files, stashes, debugger variables, result columns) take the
      focus and act on Enter or Space; focus is visible on all of them, and their buttons show with the focus
- [x] **Contrast**: every text colour checked against every surface in both themes; red text and the Git colours
      of the light theme darkened to reach 4.5:1
- [x] Reduced motion is respected (the tour's spotlight too)

### Performance
- [x] **Large diagrams**: a line is routed among the boxes near it only, and long ones that would cross dozens
      of boxes as a plain right-angled path: 400 classes with 1,100 lines route in about 0.1 s instead of 8 s;
      routes are kept and worked out again only when a box they depend on moves; a diagram of more than 80
      classes draws only what is in view (exporting and printing still draw it all)
- [x] **Large folders**: the explorer draws only the rows in view of a long list (thousands of files)
- [x] **Large files**: above 1.5 million characters the checks that read the whole text on every pause (ESLint,
      Stylelint, the conflict scan, the full syntax check) are left out; parsing a 20,000-line Java file takes
      about 10 ms, the change bar for it a few
- [x] Unsaved text too large for the session store is asked about when closing instead of being lost
- [x] Measured in tests with generous limits: parse, build, layout and routing of 400 classes, 20,000-line Java
      and 7,000-line Python files, quick open among 50,000 file names

### Logs and settings
- [x] **Log file** (`logiq-studio.log` in the app's log folder, one earlier file kept): start, errors in the
      window, errors shown to the user; never the text of your files; Help → Show the log file
- [x] **Crash reports**: a panic writes a report with the message, the place and a stack trace; the next start
      says so and shows it in its folder; the ten newest are kept
- [x] **Settings export and import** (Settings → Settings file and log): a JSON file without what belongs to this
      computer (recent folders, the JDK's place, panel sizes); on import only known settings with valid values
      are taken, and what was left out is named

### Known limits of 1.0
- The installer is not code-signed yet: SmartScreen warns the first time (the release notes say how to go on)
- The update check needs the GitHub repository `Voltiq/Logiq-Studio` and its `TAURI_SIGNING_PRIVATE_KEY`
  secret; until the first release is published, the check finds nothing
- Tried in the browser stand-in and with native tests, and the installer was built; not yet installed and run

## 1.8 — Containers in the GUI designer (in progress)

### Components inside panels
- [x] A component dropped or drawn onto a **panel** goes inside it (`panel1.add(…)`, the panel without a layout
      manager, `setBounds` relative to it); panels inside panels too; Swing's clipping and painting order shown
- [x] Moving a panel takes what is inside it along; dragging a component onto another panel (highlighted while
      dragging) or out into the window moves it there, keeping its place; **Placed in** in the inspector does the
      same, pulling it inside the panel's area
- [x] Deleting, copying and duplicating a panel include what is inside it; aligning and nudging work across panels;
      Tab goes through the components in the code's order
- [x] Read back from the code, also by hand (a loop of panels is cut); tested with the real javac
- [ ] Layout managers for panels and the window (FlowLayout, GridLayout, BorderLayout), drawn as Swing lays out
