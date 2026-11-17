# Changelog

What changed in each version of Logiq Studio. The release workflow publishes a version's section as its release notes, and installed copies show it when they offer the update.

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
