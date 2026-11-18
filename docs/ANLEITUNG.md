# Handbuch zu Logiq Studio

Logiq Studio ist ein Editor für Programme und Webseiten, der dir auch die Struktur deines Codes zeigt: Die Klassen, die du schreibst, erscheinen als UML-Klassendiagramm, das sich beim Tippen neu zeichnet. Dieses Handbuch geht das Fenster von links nach rechts durch und danach die Dinge, die du am häufigsten tust.

## Das Fenster

- **Die Leiste oben** enthält die Menüs, ein Suchfeld für Dateien und Befehle und den Button **Ausführen**.
- **Die Leiste links** schaltet die Seitenleiste um: Explorer, Suchen, Gliederung, Quellcodeverwaltung, Debugger. Darunter liegen das Klassendiagramm und das Terminal, ganz unten die Einstellungen.
- **Die Mitte** zeigt deine offenen Dateien als Tabs. Zieh eine Datei aus dem Explorer oder einen Tab auf den rechten Teil des Editors, um zwei Dateien nebeneinander zu sehen; der Editor zeigt vor dem Loslassen, wo sie landet.
- **Das Panel unten** zeigt die Ausgabe eines Programms, Probleme, Tests, SQL-Ergebnisse, JShell und das Terminal. `Strg+J` blendet es ein und aus.
- **Die Statusleiste** zeigt Fehler und Warnungen, den Git-Branch, die Cursorposition und das Werkzeug, mit dem die Datei läuft. Die meisten Einträge lassen sich anklicken.

## Projekte und Dateien

Ein Projekt ist ein Ordner. Öffne einen mit **Datei → Ordner öffnen…** (`Strg+O`) oder beginne ein neues aus einer Vorlage mit **Datei → Neues Projekt…** (`Strg+Umschalt+N`): Java-Klassen, ein Konsolenprogramm, ein Swing-Fenster, eine Webseite, Python, C, C++, Kotlin, PHP, SQL, Maven oder Gradle.

Im Explorer legst du per Rechtsklick auf einen Ordner Dateien, Klassen und Ordner an; Dateien verschiebst du durch Ziehen; `F2` benennt um und `Entf` verschiebt in den Papierkorb. `Strg+P` öffnet eine Datei, wenn du einen Teil ihres Namens tippst, und `Strg+Umschalt+P` findet jeden Befehl.

Ungespeicherte Änderungen und offene Tabs sind beim nächsten Start wieder da, sofern du das in den Einstellungen nicht abschaltest.

## Code schreiben

Der Editor färbt den Code ein, schließt Klammern, rückt ein und unterstreicht Fehler beim Tippen. Nützliche Tasten:

| Taste | Was sie tut |
| --- | --- |
| `Strg+Leertaste` | Vorschläge, was hier stehen kann |
| `F12` oder `Strg`+Klick | Zur Definition eines Namens springen |
| `Umschalt+F12` | Finden, wo ein Name benutzt wird |
| `F2` | Einen Namen überall umbenennen |
| `Strg+.` | Schnellkorrekturen für das Problem am Cursor |
| `Strg+Umschalt+R` | Refactoring: Variable, Methode und mehr herausziehen |
| `Umschalt+Alt+F` | Die Datei formatieren |
| `Strg+/` | Zeilen auskommentieren und zurück |
| `Strg+F` | Suchen und Ersetzen in der Datei |
| `Strg+Umschalt+F` | In allen Dateien suchen |

Für Java kann **Einstellungen → Java** einmalig den Java Language Server installieren; dann kennt die Vervollständigung jeden Typ, und Fehler erscheinen ohne Übersetzen. C und C++ nutzen clangd, Python nutzt Pyright oder pylsp, wenn sie installiert sind.

**Snippets** schreiben ganze Code-Stücke aus einem kurzen Wort: Tippe `sysout` und drücke `Strg+Leertaste` oder `Tab` für `System.out.println();`, `fori` für eine Zählschleife, `main` für die main-Methode oder `!` in einer HTML-Datei für das Seitengerüst (dort gehört `Tab` zu Emmet, nimm also `Strg+Leertaste`). `Tab` springt danach zum nächsten Feld zum Ausfüllen. Jede Sprache hat ihre eigenen; **Bearbeiten → Snippet einfügen…** listet die der Datei auf. Eigene schreibst du unter **Einstellungen → Snippets**, oder du markierst Code und nimmst **Bearbeiten → Auswahl als Snippet speichern…**; ein Wort, das du einem eigenen gibst, ruft deins statt des eingebauten auf.

## Programme ausführen

`F5` führt aus, was offen ist. Was das bedeutet, hängt von der Datei ab:

- **Java**: Alle Klassen werden übersetzt, dann läuft die Klasse mit `main`. Die Ausgabe erscheint im Panel; tippe dort, wenn das Programm von der Tastatur liest.
- **Python, C, C++, Kotlin, PHP, JavaScript**: Die Datei läuft mit ihrem Interpreter oder wird vorher übersetzt. Die Statusleiste zeigt, welches Werkzeug benutzt wird; ein Klick darauf wählt ein anderes.
- **HTML- und PHP-Seiten** öffnen sich in der Live-Vorschau neben dem Editor, die beim Speichern neu lädt.
- **SQL** läuft gegen die SQLite-Datenbank, die im ersten Kommentar der Datei steht (`-- database: shop.db`), oder gegen eine frische im Speicher. `Strg+Enter` führt nur die Anweisung am Cursor aus. Die Zeilen erscheinen als Tabelle im Panel Ergebnisse.

`Strg+F9` übersetzt oder prüft ohne Ausführen, `Umschalt+F5` hält ein Programm an. Fehler stehen unter **Probleme**; ein Klick führt zur Zeile. **Ausführen → Startkonfiguration…** legt Programmargumente fest.

Um einen Fehler zu finden, setze mit `F9` einen Haltepunkt und starte den Debugger mit `F6`: Das Programm hält dort an, und du kannst es Zeile für Zeile durchgehen und die Variablen ansehen.

## Das Klassendiagramm

**Ansicht → UML-Klassendiagramm zeigen** (`Strg+Umschalt+U`) zeichnet die Klassen deines Java- und Python-Codes: Attribute und Methoden mit ihrer Sichtbarkeit (`+` öffentlich, `-` privat, `#` geschützt), Vererbung und die Verbindungen zwischen Klassen.

- Zieh die Kästen, um sie anzuordnen; das Layout wird mit dem Projekt gespeichert. **Automatisch anordnen** legt alles neu aus.
- Ein Doppelklick auf eine Klasse oder ein Element springt zum Code.
- Ein Rechtsklick auf eine Java-Klasse fügt Attribute, Methoden und Konstruktoren hinzu oder erzeugt ein Objekt davon auf der **Objektbank** unter dem Diagramm, dessen Methoden du aufrufen kannst.
- **Neue Klasse** legt eine Klasse mit einem Assistenten an; die Werkzeuge für Vererbung und Assoziation zeichnen Verbindungen, die in den Code geschrieben werden.
- **Aggregation und Komposition**: Klicke mit der rechten Maustaste auf eine Assoziation und wähle, ob sie eine Aggregation (ein Teil, das auch allein bestehen kann, leere Raute) oder eine Komposition (ein Teil, das seinem Ganzen gehört, gefüllte Raute) ist. Die Wahl gilt für das ganze Projekt und erscheint in jedem Diagramm und im Export als PlantUML und Mermaid.
- **Exportieren** speichert das Diagramm als SVG, PNG, PlantUML oder Mermaid.
- **Rückgängig**: `Strg+Z` nimmt zurück, was du im Diagramm getan hast (Kästen verschieben, Notizen, Linien, Klassen ausblenden, und den Code, den es geschrieben hat: Elemente, Beziehungen, neue Klassen, Aggregationen); `Strg+Y` stellt es wieder her.

Mit der Tastatur: `Tab` führt ins Diagramm, die Pfeiltasten gehen von Klasse zu Klasse, `Enter` öffnet den Code, und die Menütaste öffnet das Menü der Klasse.

## Fenster entwerfen

**Datei → Neues Swing-Fenster…** legt eine Fensterklasse an und öffnet sie im GUI-Designer. Zieh Buttons, Labels und Textfelder von links ins Fenster, verschiebe sie und ändere ihre Größe (sie rasten aneinander ein) und stelle rechts ihre Eigenschaften ein. Komponenten, die du auf ein **Panel** ziehst, liegen darin und wandern mit ihm; zieh eine heraus oder wähle rechts **Liegt in**, um sie woanders hinzulegen. Ein Panel oder das Fenster selbst kann auch ein **Layout** haben (rechts, für das Fenster mit nichts ausgewählt): **Flow** setzt seine Komponenten in Reihen, **Grid** in gleich große Zellen, **Border** oben, unten, an die Seiten und in die Mitte; der Designer zeichnet sie dort, wo Swing sie hinsetzt, und Ziehen ändert ihren Platz in der Reihenfolge oder ihren Bereich.

Um festzulegen, was ein Button tut, klick ihn doppelt an: Eine Methode wie `okButton_ActionPerformed` wird für dich geschrieben, die du ausfüllst. Der Designer schreibt nur den Code zwischen den Kommentaren `// GUI-BEGIN` und `// GUI-END`; der Rest der Klasse gehört dir, und was du im Code änderst, zeigt sich im Designer.

**Datei → Neues JavaFX-Fenster** legt stattdessen ein JavaFX-Fenster an: eine `.fxml`-Datei, die der Designer im Aussehen von JavaFX zeichnet, und ihre Controller-Klasse. Der Designer schreibt das FXML und die `@FXML`-Felder des Controllers; ein Event-Handler wie `okButton_Action` kommt in den Controller, damit du ihn ausfüllst. Das Fenster und seine Panes können eine **VBox**, **HBox**, ein **FlowPane**, **GridPane**, **BorderPane** oder **StackPane** sein (rechts unter **Pane**), gezeichnet so, wie JavaFX sie anordnet. Eine `.fxml`-Datei öffnet sich als Text mit **Design** darüber.

## Struktogramme

Ein Struktogramm (Nassi-Shneiderman-Diagramm) zeigt, wie eine Methode arbeitet: Folgen, Verzweigungen, Schleifen und Mehrfachauswahlen als ineinander liegende Kästen.

- **Aus Code**: Setze den Cursor in eine Java-Methode und wähle **Ansicht → Struktogramm dieser Methode** (`Strg+Alt+N`). Es öffnet sich neben dem Code und folgt ihm beim Schreiben.
- **Ohne Code**: **Datei → Neues Struktogramm** legt eine `.nsd`-Datei an. Wähle einen Block und füge danach Anweisungen, Verzweigungen, Schleifen, Mehrfachauswahlen, Aufrufe und Aussprünge ein; doppelklicke einen Block, um seinen Text zu ändern, klicke auf ∅, um einen leeren Zweig zu füllen. **Kopie bearbeiten** macht aus einem Struktogramm aus Code eines, das du ändern kannst.
- **Exportieren** als PNG oder SVG, oder als Bild kopieren.

## Git

Die Ansicht Quellcodeverwaltung (`Strg+Umschalt+G`) listet geänderte Dateien. Stage die, die zusammengehören, schreib eine Nachricht und wähle **Committen** (`Strg+Enter`). Der Button mit den Pfeilen holt und sendet (Pull und Push).

Geänderte Zeilen sind am linken Rand des Editors markiert; ein Klick auf eine Markierung zeigt alten und neuen Text nebeneinander. Der Branchname in der Statusleiste wechselt Branches, mergt und rebased. Trifft ein Merge auf einen Konflikt, öffne die Datei und wähle über jedem Konflikt, welche Seite bleibt. Stashes, Tags und die Historie stehen in derselben Ansicht; `Strg+Alt+B` zeigt, wer jede Zeile zuletzt geändert hat.

## Terminal

``Strg+` `` öffnet ein Terminal im Projektordner, in dem das JDK und die Python-Umgebung des Projekts bereitstehen. Mehrere Terminals können gleichzeitig offen sein.

## Einstellungen

`Strg+,` öffnet die Einstellungen: Design (Graphit ist dunkel, Porzellan hell), Sprache, Textgröße, Speichern und Formatieren, die Shell des Terminals, die Werkzeuge jeder Sprache, das JDK und Updates. **Einstellungen exportieren…** schreibt sie in eine Datei, die du auf einem anderen Computer importieren kannst. Wähle links einen Bereich oder suche eine Einstellung nach ihrem Namen.

## Wenn etwas schiefgeht

- **„Kein JDK gefunden“** oder kein Compiler für C, C++, Python oder PHP: Öffne Hilfe → Sprachen einrichten. Dort steht, was jede Sprache braucht und was installiert ist; „Installieren“ richtet sie mit winget in einem Terminal ein, und Logiq Studio übernimmt sie, sobald sie bereit ist.
- **Ein Werkzeug für eine Sprache fehlt**: Die Statusleiste sagt es; ihr Tooltip erklärt, wie man es installiert.
- **Das Programm wartet und nichts passiert**: Wahrscheinlich wartet es auf eine Eingabe. Tippe in das Feld unter der Ausgabe und drück Enter.
- **Logiq Studio wurde unerwartet beendet**: Ein Absturzbericht wird auf deinem Computer gespeichert. **Hilfe → Protokolldatei anzeigen** öffnet den Ordner; den Bericht einer Fehlermeldung beizulegen hilft, die Ursache zu beheben.

Alle Tastenkürzel stehen unter **Hilfe → Tastenkürzel** (`Strg+K`).
