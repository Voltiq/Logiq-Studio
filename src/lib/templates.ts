/* Starting points for a new project. */

export type TemplateId = "java-console" | "java-classes" | "web" | "maven" | "gradle";

export interface Template {
  id: TemplateId;
  title: string;
  description: string;
  /** The file opened once the project is created. */
  open: string;
  files: Record<string, string>;
}

const consoleMain = `import java.util.Scanner;

public class Main {

    public static void main(String[] args) {
        Scanner in = new Scanner(System.in);
        System.out.print("What's your name? ");
        String name = in.nextLine();
        System.out.println("Hello, " + name + "!");
    }
}
`;

const shapes: Record<string, string> = {
  "Drawable.java": `/** Anything that can be drawn on a canvas. */
public interface Drawable {

    void draw();
}
`,
  "Shape.java": `/** A shape with a position; subclasses know their own area. */
public abstract class Shape implements Drawable {

    protected double x;
    protected double y;
    private String name;

    public Shape(String name, double x, double y) {
        this.name = name;
        this.x = x;
        this.y = y;
    }

    public abstract double area();

    public String getName() {
        return name;
    }

    public void moveBy(double dx, double dy) {
        x += dx;
        y += dy;
    }

    @Override
    public void draw() {
        System.out.printf("%s at (%.1f, %.1f), area %.2f%n", name, x, y, area());
    }
}
`,
  "Circle.java": `public class Circle extends Shape {

    private double radius;

    public Circle(double x, double y, double radius) {
        super("Circle", x, y);
        this.radius = radius;
    }

    @Override
    public double area() {
        return Math.PI * radius * radius;
    }
}
`,
  "Rectangle.java": `public class Rectangle extends Shape {

    protected double width;
    protected double height;

    public Rectangle(double x, double y, double width, double height) {
        this("Rectangle", x, y, width, height);
    }

    protected Rectangle(String name, double x, double y, double width, double height) {
        super(name, x, y);
        this.width = width;
        this.height = height;
    }

    @Override
    public double area() {
        return width * height;
    }
}
`,
  "Square.java": `public class Square extends Rectangle {

    public Square(double x, double y, double side) {
        super("Square", x, y, side, side);
    }
}
`,
  "Drawing.java": `import java.util.ArrayList;
import java.util.List;

/** A drawing holds any number of shapes. */
public class Drawing {

    private final List<Shape> shapes = new ArrayList<>();
    private String title;

    public Drawing(String title) {
        this.title = title;
    }

    public void add(Shape shape) {
        shapes.add(shape);
    }

    public double totalArea() {
        double sum = 0;
        for (Shape s : shapes) {
            sum += s.area();
        }
        return sum;
    }

    public void drawAll() {
        System.out.println("== " + title + " ==");
        for (Shape s : shapes) {
            s.draw();
        }
    }
}
`,
  "Main.java": `public class Main {

    public static void main(String[] args) {
        Drawing drawing = new Drawing("My first drawing");
        drawing.add(new Circle(0, 0, 2));
        drawing.add(new Rectangle(4, 1, 3, 2));
        drawing.add(new Square(-3, 2, 1.5));
        drawing.drawAll();
        System.out.printf("Total area: %.2f%n", drawing.totalArea());
    }
}
`,
};

const web: Record<string, string> = {
  "index.html": `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>My page</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <main>
    <h1>Hello, web!</h1>
    <p>Edit <code>index.html</code>, <code>style.css</code> or <code>script.js</code> and save to see the change.</p>
    <button id="counter" type="button">Clicked 0 times</button>
  </main>
  <script src="script.js"></script>
</body>
</html>
`,
  "style.css": `:root {
  --accent: #6457f0;
  font-family: system-ui, sans-serif;
}

body {
  margin: 0;
  min-height: 100vh;
  display: grid;
  place-items: center;
  background: #f5f6f8;
  color: #111318;
}

main {
  max-width: 32rem;
  padding: 2rem;
  text-align: center;
}

button {
  padding: 0.6rem 1.2rem;
  border: 0;
  border-radius: 10px;
  background: var(--accent);
  color: white;
  font: inherit;
  cursor: pointer;
}
`,
  "script.js": `const button = document.getElementById("counter");
let clicks = 0;

button.addEventListener("click", () => {
  clicks++;
  button.textContent = \`Clicked \${clicks} time\${clicks === 1 ? "" : "s"}\`;
});
`,
};

const app = `package app;

/** Starts the program. */
public class App {
    public static void main(String[] args) {
        System.out.println(greeting("World"));
    }

    static String greeting(String name) {
        return "Hello, " + name + "!";
    }
}
`;

const appTest = `package app;

import static org.junit.jupiter.api.Assertions.assertEquals;

import org.junit.jupiter.api.Test;

class AppTest {
    @Test
    void greets() {
        assertEquals("Hello, Ada!", App.greeting("Ada"));
    }
}
`;

const buildIgnore = `# Build output
target/
build/
.gradle/
out/
# Worked out by Logiq Studio on each build
.logiq/build-classpath.txt
`;

const maven: Record<string, string> = {
  "pom.xml": `<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 https://maven.apache.org/xsd/maven-4.0.0.xsd">
  <modelVersion>4.0.0</modelVersion>

  <groupId>app</groupId>
  <artifactId>{{artifact}}</artifactId>
  <version>1.0-SNAPSHOT</version>

  <properties>
    <maven.compiler.release>21</maven.compiler.release>
    <project.build.sourceEncoding>UTF-8</project.build.sourceEncoding>
  </properties>

  <dependencies>
    <dependency>
      <groupId>org.junit.jupiter</groupId>
      <artifactId>junit-jupiter</artifactId>
      <version>5.12.2</version>
      <scope>test</scope>
    </dependency>
  </dependencies>

  <build>
    <plugins>
      <plugin>
        <groupId>org.apache.maven.plugins</groupId>
        <artifactId>maven-surefire-plugin</artifactId>
        <version>3.5.3</version>
      </plugin>
    </plugins>
  </build>
</project>
`,
  "src/main/java/app/App.java": app,
  "src/test/java/app/AppTest.java": appTest,
  ".gitignore": buildIgnore,
};

const gradle: Record<string, string> = {
  "settings.gradle.kts": `rootProject.name = "{{artifact}}"
`,
  "build.gradle.kts": `plugins {
    application
}

repositories {
    mavenCentral()
}

dependencies {
    testImplementation(platform("org.junit:junit-bom:5.12.2"))
    testImplementation("org.junit.jupiter:junit-jupiter")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}

tasks.withType<JavaCompile> {
    options.release = 21
    options.encoding = "UTF-8"
}

application {
    mainClass = "app.App"
}

tasks.test {
    useJUnitPlatform()
}
`,
  "src/main/java/app/App.java": app,
  "src/test/java/app/AppTest.java": appTest,
  ".gitignore": buildIgnore,
};

export const TEMPLATES: Template[] = [
  {
    id: "java-classes",
    title: "Java classes",
    description: "A small object-oriented example with an interface, inheritance and a collection. Open the UML diagram to see it drawn.",
    open: "Main.java",
    files: shapes,
  },
  {
    id: "java-console",
    title: "Java console app",
    description: "A main class that reads from the keyboard and prints an answer.",
    open: "Main.java",
    files: { "Main.java": consoleMain },
  },
  {
    id: "maven",
    title: "Maven project",
    description: "Java with Maven: src/main/java, a JUnit 5 test and a pom.xml for dependencies. Needs Maven or a Maven Wrapper.",
    open: "src/main/java/app/App.java",
    files: maven,
  },
  {
    id: "gradle",
    title: "Gradle project",
    description: "Java with Gradle (Kotlin DSL): the application plugin, a JUnit 5 test and build.gradle.kts. Needs Gradle or a Gradle Wrapper.",
    open: "src/main/java/app/App.java",
    files: gradle,
  },
  {
    id: "web",
    title: "Web page",
    description: "HTML, CSS and JavaScript with a live preview beside the editor.",
    open: "index.html",
    files: web,
  },
];

/** A new Java file's starting text, by what it should declare. */
export function javaSkeleton(kind: "class" | "interface" | "enum" | "abstract" | "record" | "main", name: string, pkg: string): string {
  const head = pkg ? `package ${pkg};\n\n` : "";
  switch (kind) {
    case "interface":
      return `${head}public interface ${name} {\n\n}\n`;
    case "enum":
      return `${head}public enum ${name} {\n\n}\n`;
    case "abstract":
      return `${head}public abstract class ${name} {\n\n}\n`;
    case "record":
      return `${head}public record ${name}() {\n\n}\n`;
    case "main":
      return `${head}public class ${name} {\n\n    public static void main(String[] args) {\n        \n    }\n}\n`;
    default:
      return `${head}public class ${name} {\n\n    public ${name}() {\n\n    }\n}\n`;
  }
}

export const HTML_SKELETON = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Page</title>
</head>
<body>

</body>
</html>
`;
