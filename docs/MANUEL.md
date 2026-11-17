# Manuel de Logiq Studio

Logiq Studio est un éditeur de programmes et de pages web qui vous montre aussi la structure de votre code : les classes que vous écrivez apparaissent sous forme de diagramme de classes UML qui se redessine pendant la saisie. Ce manuel parcourt la fenêtre de gauche à droite, puis les actions les plus courantes.

## La fenêtre

- **La barre du haut** contient les menus, un champ de recherche de fichiers et de commandes, et le bouton **Exécuter**.
- **La barre de gauche** change la barre latérale : Explorateur, Rechercher, Plan, Contrôle de code source, Débogueur. En dessous se trouvent le diagramme de classes et le terminal, et tout en bas les paramètres.
- **Le centre** contient vos fichiers ouverts sous forme d'onglets. Un onglet peut être glissé sur le côté pour voir deux fichiers côte à côte.
- **Le panneau du bas** affiche la sortie d'un programme, les problèmes, les tests, les résultats SQL, JShell et le terminal. `Ctrl+J` l'affiche et le masque.
- **La barre d'état** affiche les erreurs et les avertissements, la branche Git, la position du curseur et l'outil avec lequel le fichier s'exécute. La plupart de ses éléments sont cliquables.

## Projets et fichiers

Un projet est un dossier. Ouvrez-en un avec **Fichier → Ouvrir un dossier…** (`Ctrl+O`), ou créez-en un à partir d'un modèle avec **Fichier → Nouveau projet…** (`Ctrl+Maj+N`) : classes Java, programme console, fenêtre Swing, page web, Python, C, C++, Kotlin, PHP, SQL, Maven ou Gradle.

Dans l'Explorateur, un clic droit sur un dossier crée des fichiers, des classes et des dossiers ; faites glisser les fichiers pour les déplacer ; `F2` renomme et `Suppr` place dans la Corbeille. `Ctrl+P` ouvre un fichier en saisissant une partie de son nom, et `Ctrl+Maj+P` trouve n'importe quelle commande.

Les modifications non enregistrées et les onglets ouverts reviennent au prochain démarrage, sauf si vous le désactivez dans les Paramètres.

## Écrire du code

L'éditeur colore le code, ferme les parenthèses, indente et souligne les erreurs pendant la saisie. Touches utiles :

| Touche | Ce qu'elle fait |
| --- | --- |
| `Ctrl+Espace` | Suggestions de ce qui peut être écrit ici |
| `F12` ou `Ctrl`+clic | Aller à la définition d'un nom |
| `Maj+F12` | Rechercher où un nom est utilisé |
| `F2` | Renommer un nom partout |
| `Ctrl+.` | Corrections rapides pour le problème sous le curseur |
| `Ctrl+Maj+R` | Refactoriser : extraire une variable, une méthode, etc. |
| `Maj+Alt+F` | Mettre en forme le fichier |
| `Ctrl+/` | Mettre des lignes en commentaire et inversement |
| `Ctrl+F` | Rechercher et remplacer dans le fichier |
| `Ctrl+Maj+F` | Rechercher dans tous les fichiers |

Pour Java, **Paramètres → Java** peut installer une fois le serveur de langage Java ; la complétion connaît alors tous les types et les erreurs apparaissent sans compiler. C et C++ utilisent clangd, Python utilise Pyright ou pylsp, lorsqu'ils sont installés.

## Exécuter des programmes

`F5` exécute ce qui est ouvert. Ce que cela signifie dépend du fichier :

- **Java** : toutes les classes sont compilées, puis la classe contenant `main` s'exécute. La sortie apparaît dans le panneau ; saisissez-y du texte quand le programme lit au clavier.
- **Python, C, C++, Kotlin, PHP, JavaScript** : le fichier s'exécute avec son interpréteur ou est d'abord compilé. La barre d'état indique l'outil utilisé ; cliquez dessus pour en choisir un autre.
- **Les pages HTML et PHP** s'ouvrent dans l'aperçu en direct à côté de l'éditeur, qui se recharge à l'enregistrement.
- **SQL** s'exécute sur la base de données SQLite nommée dans le premier commentaire du fichier (`-- database: shop.db`), ou sur une nouvelle base en mémoire. `Ctrl+Entrée` n'exécute que l'instruction sous le curseur. Les lignes apparaissent sous forme de tableau dans le panneau Résultats.

`Ctrl+F9` compile ou vérifie sans exécuter, `Maj+F5` arrête un programme. Les erreurs sont listées sous **Problèmes** ; cliquez sur l'une d'elles pour aller à sa ligne. **Exécuter → Configuration d'exécution…** définit les arguments du programme.

Pour trouver une erreur, placez un point d'arrêt avec `F9` et lancez le débogueur avec `F6` : le programme s'y arrête, et vous pouvez le parcourir ligne par ligne et examiner les variables.

## Le diagramme de classes

**Affichage → Afficher le diagramme de classes UML** (`Ctrl+Maj+U`) dessine les classes de votre code Java et Python : attributs et méthodes avec leur visibilité (`+` public, `-` privé, `#` protégé), l'héritage et les liens entre classes.

- Faites glisser les boîtes pour les disposer ; la disposition est enregistrée avec le projet. **Disposer automatiquement** réorganise tout.
- Double-cliquez sur une classe ou un membre pour aller à son code.
- Un clic droit sur une classe Java ajoute des attributs, des méthodes et des constructeurs, ou crée un objet de cette classe sur l'**établi d'objets**, sous le diagramme, pour appeler ses méthodes.
- **Nouvelle classe** crée une classe à l'aide d'un assistant ; les outils d'héritage et d'association dessinent des liens qui sont écrits dans le code.
- **Exporter** enregistre le diagramme en SVG, PNG, PlantUML ou Mermaid.

Au clavier : `Tab` entre dans le diagramme, les flèches vont de classe en classe, `Entrée` ouvre le code et la touche Menu ouvre le menu de la classe.

## Concevoir des fenêtres

**Fichier → Nouvelle fenêtre Swing…** crée une classe de fenêtre et l'ouvre dans le concepteur d'interfaces. Faites glisser des boutons, des étiquettes et des champs de texte depuis la gauche dans la fenêtre, déplacez-les et redimensionnez-les (ils s'alignent les uns sur les autres), et réglez leurs propriétés à droite.

Pour indiquer ce que fait un bouton, double-cliquez dessus : une méthode comme `okButton_ActionPerformed` est écrite pour que vous la complétiez. Le concepteur n'écrit que le code situé entre les commentaires `// GUI-BEGIN` et `// GUI-END` ; le reste de la classe vous appartient, et ce que vous modifiez dans le code se voit dans le concepteur.

## Git

La vue Contrôle de code source (`Ctrl+Maj+G`) liste les fichiers modifiés. Indexez ceux qui vont ensemble, écrivez un message et choisissez **Valider** (`Ctrl+Entrée`). Le bouton aux flèches tire et pousse (pull et push).

Les lignes modifiées sont marquées sur le bord gauche de l'éditeur ; cliquez sur une marque pour voir l'ancien et le nouveau texte face à face. Le nom de la branche dans la barre d'état change de branche, fusionne et rebase. Quand une fusion rencontre un conflit, ouvrez le fichier et choisissez au-dessus de chaque conflit le côté à garder. Les remises, les étiquettes et l'historique se trouvent dans la même vue ; `Ctrl+Alt+B` montre qui a modifié chaque ligne en dernier.

## Terminal

``Ctrl+` `` ouvre un terminal dans le dossier du projet, avec le JDK et l'environnement Python du projet prêts à l'emploi. Plusieurs terminaux peuvent être ouverts en même temps.

## Paramètres

`Ctrl+,` ouvre les paramètres : thème (Graphite est sombre, Porcelaine clair), langue, taille du texte, enregistrement et mise en forme, l'interpréteur du terminal, les outils de chaque langage, le JDK et les mises à jour. **Exporter les paramètres…** les écrit dans un fichier que vous pouvez importer sur un autre ordinateur.

## En cas de problème

- **« Aucun JDK trouvé »** : installez un JDK (par exemple Temurin depuis adoptium.net), puis choisissez-le dans Paramètres → Java.
- **L'outil d'un langage manque** : la barre d'état l'indique ; son info-bulle explique comment l'installer.
- **Le programme attend et rien ne se passe** : il attend probablement une saisie. Saisissez du texte dans le champ sous la sortie et appuyez sur Entrée.
- **Logiq Studio s'est fermé de façon inattendue** : un rapport de plantage est enregistré sur votre ordinateur. **Aide → Afficher le fichier journal** ouvre le dossier ; joindre le rapport à un rapport de bogue aide à en corriger la cause.

Tous les raccourcis clavier sont listés sous **Aide → Raccourcis clavier** (`Ctrl+K`).
