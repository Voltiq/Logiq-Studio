/* Starting points for a new project. */

export type TemplateId = "java-console" | "java-classes" | "web" | "maven" | "gradle" | "python" | "c" | "cpp" | "php" | "kotlin" | "sql";

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

const python: Record<string, string> = {
  "main.py": `"""A small shop: run it with F5, then open the class diagram."""

from shop import Customer, Order, Product


def main() -> None:
    name = input("What's your name? ")
    customer = Customer(name)
    order = Order(customer)
    order.add(Product("Notebook", 3.50), 2)
    order.add(Product("Pen", 1.20), 3)
    print(f"Hello, {customer.name}! Your order:")
    for line in order.lines:
        print(f"  {line.quantity} x {line.product.title:<10} {line.total():6.2f}")
    print(f"  Total: {order.total():.2f}")


if __name__ == "__main__":
    main()
`,
  "shop.py": `from dataclasses import dataclass


@dataclass
class Product:
    title: str
    price: float


class Customer:
    def __init__(self, name: str):
        self.name = name
        self._orders: list["Order"] = []


class OrderLine:
    def __init__(self, product: Product, quantity: int):
        self.product = product
        self.quantity = quantity

    def total(self) -> float:
        return self.product.price * self.quantity


class Order:
    def __init__(self, customer: Customer):
        self.customer = customer
        self.lines: list[OrderLine] = []

    def add(self, product: Product, quantity: int = 1) -> None:
        self.lines.append(OrderLine(product, quantity))

    def total(self) -> float:
        return sum(line.total() for line in self.lines)
`,
  "test_shop.py": `import unittest

from shop import Customer, Order, Product


class OrderTest(unittest.TestCase):
    def test_total(self):
        order = Order(Customer("Ada"))
        order.add(Product("Pen", 1.5), 2)
        self.assertAlmostEqual(order.total(), 3.0)


if __name__ == "__main__":
    unittest.main()
`,
  "requirements.txt": `# One package per line, for example:
# requests
`,
  ".gitignore": `.venv/
__pycache__/
*.pyc
`,
};

const cMain = `#include <stdio.h>

/* Reads two numbers and prints their sum. Run it with F5 and type in the panel. */
int main(void) {
    int a = 0, b = 0;
    printf("First number: ");
    fflush(stdout);
    if (scanf("%d", &a) != 1) return 1;
    printf("Second number: ");
    fflush(stdout);
    if (scanf("%d", &b) != 1) return 1;
    printf("%d + %d = %d\\n", a, b, a + b);
    return 0;
}
`;

const cpp: Record<string, string> = {
  "main.cpp": `#include <iostream>
#include <string>
#include "counter.h"

int main() {
    std::string name;
    std::cout << "What's your name? " << std::flush;
    std::getline(std::cin, name);
    Counter letters;
    for (char c : name) {
        if (c != ' ') letters.increment();
    }
    std::cout << "Hello, " << name << "! Your name has " << letters.value() << " letters.\\n";
    return 0;
}
`,
  "counter.h": `#pragma once

class Counter {
public:
    void increment();
    int value() const;

private:
    int count_ = 0;
};
`,
  "counter.cpp": `#include "counter.h"

void Counter::increment() { ++count_; }

int Counter::value() const { return count_; }
`,
  ".gitignore": `build/
`,
};

const php: Record<string, string> = {
  "index.php": `<?php
$name = trim($_GET["name"] ?? "");
$hour = (int) date("G");
$greeting = $hour < 12 ? "Good morning" : ($hour < 18 ? "Good afternoon" : "Good evening");
?>
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Hello from PHP</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <main>
    <h1><?= htmlspecialchars($greeting . ($name !== "" ? ", $name" : "")) ?>!</h1>
    <form>
      <label>Your name <input name="name" value="<?= htmlspecialchars($name) ?>"></label>
      <button>Greet me</button>
    </form>
    <p>PHP <?= PHP_VERSION ?> served this page at <?= date("H:i:s") ?>.</p>
  </main>
</body>
</html>
`,
  "style.css": `body {
  margin: 0;
  font: 16px/1.6 system-ui, sans-serif;
  background: #f6f5fb;
  color: #1c1b22;
}

main {
  max-width: 34rem;
  margin: 4rem auto;
  padding: 2rem;
  background: #fff;
  border-radius: 14px;
  box-shadow: 0 8px 28px -12px rgb(40 30 90 / 0.3);
}

input {
  margin: 0 0.5rem;
  padding: 0.35rem 0.5rem;
}
`,
  "cli.php": `<?php
// A script for the command line: run it with F5 and type in the panel.
echo "What's your name? ";
$name = trim(fgets(STDIN));
echo "Hello, $name!\\n";
`,
};

const kotlin: Record<string, string> = {
  "Main.kt": `data class Item(val title: String, val price: Double)

fun main() {
    print("What's your name? ")
    val name = readln()
    val basket = listOf(Item("Notebook", 3.5), Item("Pen", 1.2))
    println("Hello, $name! Your basket costs %.2f.".format(basket.sumOf { it.price }))
}
`,
  ".gitignore": `build/
`,
};

const sqlFiles: Record<string, string> = {
  "schema.sql": `-- database: shop.db
-- Run with F5: creates the tables and some rows. Then open queries.sql.

DROP TABLE IF EXISTS order_line;
DROP TABLE IF EXISTS product;
DROP TABLE IF EXISTS customer;

CREATE TABLE customer (
  id    INTEGER PRIMARY KEY,
  name  TEXT NOT NULL,
  city  TEXT
);

CREATE TABLE product (
  id     INTEGER PRIMARY KEY,
  title  TEXT NOT NULL,
  price  REAL NOT NULL
);

CREATE TABLE order_line (
  customer_id  INTEGER REFERENCES customer(id),
  product_id   INTEGER REFERENCES product(id),
  quantity     INTEGER NOT NULL DEFAULT 1
);

INSERT INTO customer (name, city) VALUES ('Ada', 'London'), ('Jürgen', 'Köln'), ('Mei', 'Taipei');
INSERT INTO product (title, price) VALUES ('Notebook', 3.50), ('Pen', 1.20), ('Ruler', 0.90);
INSERT INTO order_line VALUES (1, 1, 2), (1, 2, 3), (2, 3, 1), (3, 1, 5);
`,
  "queries.sql": `-- database: shop.db
-- Ctrl+Enter runs the statement at the cursor, F5 the whole file.

SELECT * FROM customer;

SELECT c.name, p.title, l.quantity, p.price * l.quantity AS total
FROM order_line l
JOIN customer c ON c.id = l.customer_id
JOIN product p ON p.id = l.product_id
ORDER BY total DESC;

SELECT c.city, count(*) AS orders, round(sum(p.price * l.quantity), 2) AS revenue
FROM order_line l
JOIN customer c ON c.id = l.customer_id
JOIN product p ON p.id = l.product_id
GROUP BY c.city;
`,
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
    id: "python",
    title: "Python project",
    description: "Classes in a module, a script that reads from the keyboard, a unittest test and requirements.txt. The class diagram draws the classes.",
    open: "main.py",
    files: python,
  },
  {
    id: "web",
    title: "Web page",
    description: "HTML, CSS and JavaScript with a live preview beside the editor.",
    open: "index.html",
    files: web,
  },
  {
    id: "php",
    title: "PHP site",
    description: "A PHP page with a form in the preview, served by PHP's web server, and a script for the command line.",
    open: "index.php",
    files: php,
  },
  {
    id: "c",
    title: "C program",
    description: "A main.c that reads numbers from the keyboard. Compiled with clang or gcc.",
    open: "main.c",
    files: { "main.c": cMain, ".gitignore": "build/\n" },
  },
  {
    id: "cpp",
    title: "C++ program",
    description: "main.cpp with a class in its own header and source file. Compiled with clang++ or g++.",
    open: "main.cpp",
    files: cpp,
  },
  {
    id: "kotlin",
    title: "Kotlin program",
    description: "A main function with a data class. Needs the Kotlin compiler (kotlinc).",
    open: "Main.kt",
    files: kotlin,
  },
  {
    id: "sql",
    title: "SQL database",
    description: "SQLite scripts: one creates a small shop's tables, one queries them. Results appear in a grid.",
    open: "queries.sql",
    files: sqlFiles,
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
