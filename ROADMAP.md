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
- [ ] Stylelint: the CSS language service's validation covers the common mistakes; a full Stylelint needs Node → v0.6
- [ ] Java refactorings beyond rename (extract method / variable) through the language server → v0.6

### Known limits of v0.5
- JDT LS needs Java 21 or newer to run itself (projects can target older versions); its first start in a project
  indexes the JDK and takes a little while
- Bend points stay where they are when a box moves; *Arrange automatically* resets them
- The language servers were tested in the browser stand-in (TypeScript, HTML, CSS, ESLint) and natively (JDT LS
  framing, install and a whole session); the Java server inside the installed app isn't checked yet

## v0.6 — Terminal, Git and build tools
- [ ] Maven and Gradle projects: open, build, run, dependencies on the class path
- [ ] Integrated terminal (PTY + xterm.js) with several tabs
- [ ] Git: status colours in the explorer and gutter, diff view, stage / commit / push / pull, branches,
      history
- [ ] Clone a repository from the welcome screen

## v0.7 — More languages
- [ ] Python (run, virtual environments, class diagrams from Python classes)
- [ ] C and C++ (gcc / clang, run with input)
- [ ] Kotlin, SQL (with Atomiq Studio's grid), PHP
- [ ] Language support as plug-ins: grammar, runner, outline and diagram extractor per language

## v0.8 — GUI designer
- [ ] Design Swing (and later JavaFX) windows by dragging components; the code is generated and stays editable

## v1.0 — Release
- [ ] Windows installer (NSIS, current user), signed updates from GitHub Releases like the other Studio apps
- [ ] Interface in Spanish and French (German is done)
- [ ] Manual (`F1`) and a short tour on first start
- [ ] Accessibility pass (screen readers in the diagram, keyboard everywhere, contrast)
- [ ] Performance: very large files and folders, diagrams with hundreds of classes
- [ ] Logs and crash reports to a file; settings import / export
- [ ] File associations (`.java`, `.html`, `.css`, `.js`) and "Open folder with Logiq Studio" in Explorer
