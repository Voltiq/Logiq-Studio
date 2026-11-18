# Changelog

What changed in each version of Logiq Studio. The release workflow publishes a version's section as its release notes, and installed copies show it when they offer the update.

## 1.6.0

- **Snippets for every language**: type a short word and press `Ctrl+Space` or `Tab` to write out the whole piece of code: `sysout` becomes `System.out.println();`, `fori` a counting loop, `main` the main method, and `!` in an HTML file the page skeleton. `Tab` then moves through the fields to fill in. About 330 of them for Java, Kotlin, Python, JavaScript and TypeScript, HTML, CSS, C, C++, PHP, SQL and Markdown; they also show in the suggestion list with a preview, and Edit → Insert snippet lists them all.
- **Java suggestions** without the language server show again: keywords, your classes and their methods were left out of the list.

## 1.5.0

- **Undo and redo in the class diagram**: `Ctrl+Z` takes back what you did in the diagram and `Ctrl+Y` (or `Ctrl+Shift+Z`) does it again, also from the Edit menu and the diagram's toolbar. It covers moving boxes, notes and lines, hiding and choosing classes, arranging, and the code the diagram wrote: attributes and methods, inheritance, associations, new classes, aggregations and compositions. Code you changed by hand in the meantime is left alone.

## 1.4.0

- **Nassi–Shneiderman diagrams (structograms)**: View → Nassi–Shneiderman diagram of this method (`Ctrl+Alt+N`) draws the Java method at the cursor beside its code and follows it as you type: decisions, multiple choices, loops, exits, try/catch and calls. File → New Nassi–Shneiderman diagram lets you draw one without code, block by block. Both can be exported as PNG or SVG or copied as an image.
- **Aggregation and composition** in the class diagram: right-click an association to give it a hollow or a filled diamond; the choice holds for the whole project and appears in the PlantUML and Mermaid export.
- **Settings, reorganised**: sections on the left, a search for any setting, the theme chosen from small pictures, and no more long scrolling.
- **The file tree**: files no longer look as if they were inside the folder above them.

## 1.3.0

- **Set up languages from the app** (Help → Set up languages): for Java, JavaScript and TypeScript, Python, C and C++, PHP, Kotlin and Git it shows what each needs and whether it is installed. **Install** sets it up with winget in a terminal (where you answer its questions), and Logiq Studio notices when it is ready, without a restart. Every language also has its download page.
- "No compiler was found" messages and the tool menus in the status bar lead straight there.
- **Terminal cursor** (Settings → Terminal): a block, a vertical line or an underscore, blinking or not.
- **Fixed**: when debugging started, a breakpoint near the beginning of a program could be passed over.

## 1.2.0

- **Java problems while you write**: a moment after you stop typing (and after saving), your Java code is checked in the background with what is in the editors, saved or not. A mistake you fix is no longer marked, and a new one shows up, without pressing Run. Opening a folder shows its problems right away. (Maven and Gradle projects are still checked when you build.)
- **The message next to the line**: a line with a problem says what is wrong after its code, so you don't have to point at the underline; "cannot find symbol" says which name it is.
- **No false syntax errors**: once the compiler has accepted the code, the quick syntax check no longer marks newer Java that it doesn't know.
- **New classes appear in the diagram**: classes you add while writing are brought into view in the class diagram, without opening it again.

## 1.1.1

A visual polish release.

- **Corners that fit**: every panel has the same rounded corners, and what sits in a corner (tabs, the panel's tab switcher, the drop preview, the class diagram, the web preview) follows its curve.
- **Nothing cut off**: menus taller than the window scroll; search results keep the match in view; when the tabs don't fit, the active one is scrolled into view and the edges fade; long variable names and values in the debugger end in an ellipsis; the warning marker next to a line is whole again.
- **Top bar**: the menus and buttons no longer slide under the search field in a small window.
- **Debugger**: the call stack shows each method with its file name.
- **Contrast**: red badges and buttons, and in the light theme hint text, success messages and error counts, are easier to read.

## 1.1.0

- **Drag files into a split view**: drag a file from the explorer, or a tab, onto the editor. A preview shows where it will land before you let go: in this editor, or (over the right part) in a new editor at the side. Files dropped on the tab bar open at that place among the tabs. Dropping a file on the code now opens it instead of typing its path in.
- **Smooth panels**: the side bar, the bottom panel and the web preview slide in and out, and a new view or panel tab fades in. Reduced motion turns this off.
- **Several class diagrams at once**: each `.uml` file opens in its own tab next to the project's diagram instead of replacing it.
- **Fixed**: the UML button on the left closed the open diagram instead of showing it.
- **Fixed**: the heading of the source control view had lost its style.

## 1.0.0

The first release with an installer.

- **Installer and updates**: a Windows installer for your user account (no administrator needed). Logiq Studio looks for a newer version at start and installs it when you agree; updates are signed.
- **Opens your files**: Java, HTML, CSS, JavaScript, Python, C, C++, Kotlin, PHP, SQL and class diagram files can be opened with Logiq Studio from Explorer, and folders have *Open with Logiq Studio* in their menu.
- **Spanish and French**: the interface and the manual, next to English and German.
- **Manual and tour**: `F1` opens the manual; a short tour shows the window the first time (again from Help).
- **Accessibility**: the class diagram can be read with a screen reader and used with the keyboard; focus is visible everywhere; reduced motion is respected; contrast was raised where it was low.
- **Faster with large projects**: very large files, folders with many files and diagrams with hundreds of classes stay responsive.
- **Log and crash reports**: errors are written to a log file on your computer (never the text of your files); after a crash the report is shown at the next start.
- **Settings as a file**: export your settings and import them on another computer.

## 0.8.0

- GUI designer for Swing windows: drag components into a window, set properties and events; the code is written into the class and stays editable.

## 0.7.0

- Python, C, C++, PHP, Kotlin and SQL as language plug-ins; class diagrams from Python classes; SQL results in a grid.
- Git: merge and rebase with conflict resolution in the editor, stashes, tags and blame.

## 0.6.0

- Integrated terminal, Git (source control view, diffs, history, clone), Maven and Gradle projects, Java refactorings, Stylelint.

## 0.5.0

- Language servers for Java, JavaScript, TypeScript, HTML and CSS; right-angled lines and several diagrams per project.

## 0.4.0

- Debugger, sequence diagrams, JUnit, JShell, JAR export and Javadoc.

## 0.3.0

- Editing code from the UML diagram; the object bench.

## 0.2.0

- Editor depth: completion, navigation, formatting, search in files, split view.

## 0.1.0

- The foundation: editor, explorer, compile and run for Java, the live UML class diagram, web preview.
