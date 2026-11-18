# Logiq Studio manual

Logiq Studio is an editor for programs and web pages that also shows you the structure of your code: the classes you write appear as a UML class diagram that redraws itself while you type. This manual goes through the window from left to right, then through the things you do most.

## The window

- **The bar at the top** has the menus, a search field for files and commands, and the **Run** button.
- **The rail on the left** switches the sidebar: Explorer, Search, Outline, Source control, Debugger. Below them are the class diagram and the terminal, and at the bottom the settings.
- **The middle** holds your open files as tabs. Drag a file from the explorer, or a tab, onto the right part of the editor to see two files next to each other; the editor shows where it will land before you let go.
- **The panel at the bottom** shows a program's output, problems, tests, results of SQL, JShell and the terminal. `Ctrl+J` shows and hides it.
- **The status bar** shows errors and warnings, the Git branch, the cursor position and the tool the file runs with. Most of its items can be clicked.

## Projects and files

A project is a folder. Open one with **File → Open folder** (`Ctrl+O`), or start a new one from a template with **File → New project** (`Ctrl+Shift+N`): Java classes, a console program, a Swing window, a web page, Python, C, C++, Kotlin, PHP, SQL, Maven or Gradle.

In the Explorer, right-click a folder to create files, classes and folders; drag files to move them; `F2` renames and `Del` moves to the Recycle Bin. `Ctrl+P` opens a file by typing part of its name, and `Ctrl+Shift+P` finds any command.

Unsaved changes and open tabs come back the next time you start, unless you switch that off in Settings.

## Writing code

The editor colours the code, closes brackets, indents, and underlines mistakes as you type. Useful keys:

| Key | What it does |
| --- | --- |
| `Ctrl+Space` | Suggestions for what can be written here |
| `F12` or `Ctrl`+click | Go to the definition of a name |
| `Shift+F12` | Find where a name is used |
| `F2` | Rename a name everywhere |
| `Ctrl+.` | Quick fixes for the problem at the cursor |
| `Ctrl+Shift+R` | Refactor: extract a variable, a method and more |
| `Shift+Alt+F` | Format the file |
| `Ctrl+/` | Turn lines into a comment and back |
| `Ctrl+F` | Find and replace in the file |
| `Ctrl+Shift+F` | Find in all files |

For Java, **Settings → Java** can install the Java language server once; then completion knows every type, and errors appear without compiling. C and C++ use clangd, Python uses Pyright or pylsp, when they are installed.

**Snippets** write whole pieces of code from a short word: type `sysout` and press `Ctrl+Space` or `Tab` for `System.out.println();`, `fori` for a counting loop, `main` for the main method, or `!` in an HTML file for the page skeleton (there `Tab` belongs to Emmet, so use `Ctrl+Space`). `Tab` then moves on to the next field to fill in. Every language has its own; **Edit → Insert snippet…** lists those of the file. Write your own in **Settings → Snippets**, or select code and use **Edit → Save selection as snippet…**; a word you give one of yours calls it instead of the built-in snippet.

## Running programs

`F5` runs what is open. What that means depends on the file:

- **Java**: every class is compiled, then the class with `main` runs. Output appears in the panel; type there when the program reads from the keyboard.
- **Python, C, C++, Kotlin, PHP, JavaScript**: the file runs with its interpreter or is compiled first. The status bar shows which tool is used; click it to choose another.
- **HTML and PHP pages** open in the live preview beside the editor, which reloads when you save.
- **SQL** runs against the SQLite database named in the file's first comment (`-- database: shop.db`), or a fresh one in memory. `Ctrl+Enter` runs only the statement at the cursor. Rows appear as a table in the Results panel.

`Ctrl+F9` compiles or checks without running, `Shift+F5` stops a program. Errors are listed under **Problems**; click one to go to its line. **Run → Run configuration** sets program arguments.

To find a mistake, set a breakpoint with `F9` and start the debugger with `F6`: the program stops there, and you can step through it line by line and look at the variables.

## The class diagram

**View → Show UML class diagram** (`Ctrl+Shift+U`) draws the classes of your Java and Python code: attributes and methods with their visibility (`+` public, `-` private, `#` protected), inheritance, and the links between classes.

- Drag boxes to arrange them; the layout is saved with the project. **Arrange automatically** lays everything out again.
- Double-click a class or a member to jump to its code.
- Right-click a Java class to add attributes, methods and constructors, or to create an object of it on the **object bench** below the diagram and call its methods.
- **New class** creates a class with a wizard; the inheritance and association tools draw links that are written into the code.
- **Aggregation and composition**: right-click an association and choose whether it is an aggregation (a part that can exist on its own, hollow diamond) or a composition (a part owned by its whole, filled diamond). The choice is kept for the project and shows in every diagram and in the PlantUML and Mermaid export.
- **Export** saves the diagram as SVG, PNG, PlantUML or Mermaid.
- **Undo**: `Ctrl+Z` takes back what you did in the diagram (moving boxes, notes, lines, hiding classes, and the code it wrote: members, links, new classes, aggregations); `Ctrl+Y` does it again.

With the keyboard: `Tab` moves into the diagram, the arrow keys go from class to class, `Enter` opens the code, and the menu key opens the class's menu.

## Designing windows

**File → New Swing window** creates a window class and opens it in the GUI designer. Drag buttons, labels and text fields from the left into the window, move and resize them (they snap to each other), and set their properties on the right.

To say what a button does, double-click it: a method like `okButton_ActionPerformed` is written for you to fill in. The designer writes only the code between the `// GUI-BEGIN` and `// GUI-END` comments; the rest of the class is yours, and what you change in the code shows in the designer.

## Nassi–Shneiderman diagrams

A Nassi–Shneiderman diagram (structogram) shows how a method works: sequences, decisions, loops and choices as nested boxes.

- **From code**: put the cursor in a Java method and choose **View → Nassi–Shneiderman diagram of this method** (`Ctrl+Alt+N`). It opens beside the code and follows it as you type.
- **Without code**: **File → New Nassi–Shneiderman diagram** creates a `.nsd` file. Select a block and add statements, decisions, loops, choices, calls and exits after it; double-click a block to change its text, click ∅ to fill an empty branch. **Edit a copy** turns a diagram made from code into one you can change.
- **Export** as PNG or SVG, or copy it as an image.

## Git

The Source control view (`Ctrl+Shift+G`) lists changed files. Stage the ones that belong together, write a message, and **Commit** (`Ctrl+Enter`). The button with the arrows pulls and pushes.

Changed lines are marked at the left edge of the editor; click a mark to see the old and the new text side by side. The branch name in the status bar switches branches, merges and rebases. When a merge meets a conflict, open the file and choose above each conflict which side to keep. Stashes, tags and the history are in the same view; `Ctrl+Alt+B` shows who last changed each line.

## Terminal

``Ctrl+` `` opens a terminal in the project folder, with the project's JDK and Python environment ready. Several terminals can be open at once.

## Settings

`Ctrl+,` opens the settings: theme (Graphite is dark, Porcelain light), language, text size, saving and formatting, the terminal's shell, the tools for each language, the JDK, and updates. **Export settings** writes them to a file you can import on another computer. Choose a section on the left, or search for a setting by name.

## When something goes wrong

- **“No JDK found”**, or no compiler for C, C++, Python or PHP: open Help → Set up languages. It shows what each language needs and what is installed; Install sets it up with winget in a terminal, and Logiq Studio picks it up when it is ready.
- **A tool for a language is missing**: the status bar says so; its tooltip tells how to install it.
- **The program waits and nothing happens**: it is probably waiting for input. Type into the field under the output and press Enter.
- **Logiq Studio closed unexpectedly**: a crash report is saved on your computer. **Help → Show the log file** opens the folder; attaching the report to a bug report helps to fix the cause.

All keyboard shortcuts are listed under **Help → Keyboard shortcuts** (`Ctrl+K`).
