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

## v0.3 — UML like the Röhner editor
- [ ] Create a class from the diagram: a class wizard with attributes (name, type, visibility), constructor,
      getters and setters, `toString`, generating the Java file
- [ ] Edit from the diagram: add or change an attribute or method in a dialog and have the code updated
- [ ] Draw relations in the diagram (inheritance, implements, association) and generate the code for them
- [ ] Object bench: create objects from a class box, call their methods with arguments, inspect fields
      (interactive testing as in the Röhner editor and BlueJ)
- [ ] Orthogonal line routing around boxes; manual bend points; label dragging
- [ ] Several diagrams per project (`.uml` files) and notes / comments on the canvas
- [ ] Package frames; optional library classes (`ArrayList`, `String`) as grey boxes
- [ ] Print the diagram; export to PlantUML and Mermaid
- [ ] Object and sequence diagrams generated from a run

## v0.4 — Java toolchain
- [ ] Debugger over JDWP: breakpoints, step over / into / out, variables, watches, call stack
- [ ] JUnit 5 tests: run all / one, results tree, jump to failures
- [ ] JShell console for trying expressions
- [ ] Program arguments and run configurations; several main classes to choose from
- [ ] Export a runnable JAR; generate Javadoc
- [ ] Maven and Gradle projects (open, build, dependencies); library management UI for `lib/`
- [ ] GUI designer for Swing / JavaFX forms (as in the Röhner editor)
- [ ] Help install a JDK when none is found

## v0.5 — Language intelligence
- [ ] Java language server (Eclipse JDT LS): type-aware completion, errors as you type, quick fixes, imports,
      refactorings
- [ ] TypeScript language service for JavaScript and TypeScript (types, errors, go to definition)
- [ ] HTML and CSS language services (validation, attribute and property completion everywhere)
- [ ] ESLint and Stylelint integration

## v0.6 — Terminal and Git
- [ ] Integrated terminal (PTY + xterm.js) with several tabs
- [ ] Git: status colours in the explorer and gutter, diff view, stage / commit / push / pull, branches,
      history
- [ ] Clone a repository from the welcome screen

## v0.7 — More languages
- [ ] Python (run, virtual environments, class diagrams from Python classes)
- [ ] C and C++ (gcc / clang, run with input)
- [ ] Kotlin, SQL (with Atomiq Studio's grid), PHP
- [ ] Language support as plug-ins: grammar, runner, outline and diagram extractor per language

## v1.0 — Release
- [ ] Windows installer (NSIS, current user), signed updates from GitHub Releases like the other Studio apps
- [ ] Interface in Spanish and French (German is done)
- [ ] Manual (`F1`) and a short tour on first start
- [ ] Accessibility pass (screen readers in the diagram, keyboard everywhere, contrast)
- [ ] Performance: very large files and folders, diagrams with hundreds of classes
- [ ] Logs and crash reports to a file; settings import / export
- [ ] File associations (`.java`, `.html`, `.css`, `.js`) and "Open folder with Logiq Studio" in Explorer
