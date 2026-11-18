/*
 * Starting a JavaFX window: the launcher class that loads the .fxml and shows it, and the "JavaFX window" project
 * (a greeting form like the Swing one, its button already answering).
 */
import { t } from "../lib/i18n";
import { newControllerSource, syncController } from "./fxController";
import { newFxmlSource, parseFxml, writeFxml } from "./fxml";
import type { GuiComponent } from "./model";

/** A class that opens the window: an Application that loads the FXML beside it. */
export function newFxAppSource(className: string, pkg: string, fxmlFile: string, title: string): string {
  const head = pkg ? `package ${pkg};\n\n` : "";
  return `${head}import javafx.application.Application;
import javafx.fxml.FXMLLoader;
import javafx.scene.Parent;
import javafx.scene.Scene;
import javafx.stage.Stage;

public class ${className} extends Application {

    @Override
    public void start(Stage stage) throws Exception {
        // ${t("The window drawn in the GUI designer, with its controller.")}
        Parent root = FXMLLoader.load(${className}.class.getResource(${JSON.stringify(fxmlFile)}));
        stage.setTitle(${JSON.stringify(title)});
        stage.setScene(new Scene(root));
        stage.show();
    }

    public static void main(String[] args) {
        launch(args);
    }
}
`;
}

/** The "JavaFX window" project's files: the window, its controller with the button's handler written, the launcher. */
export function fxTemplate(): Record<string, string> {
  const p = parseFxml(newFxmlSource("GreetingController"))!;
  const c = (x: Partial<GuiComponent> & Pick<GuiComponent, "type" | "name" | "x" | "y" | "w" | "h">): GuiComponent => ({ events: [], ...x });
  p.form.width = 400;
  p.form.height = 200;
  p.form.components = [
    c({ type: "JLabel", name: "nameLabel", x: 24, y: 24, w: 120, h: 24, text: t("Your name:") }),
    c({ type: "JTextField", name: "nameField", x: 144, y: 24, w: 232, h: 24, events: ["actionPerformed"] }),
    c({ type: "JButton", name: "greetButton", x: 144, y: 64, w: 120, h: 28, text: t("Greet me"), events: ["actionPerformed"] }),
    c({ type: "JLabel", name: "answerLabel", x: 24, y: 112, w: 352, h: 40, align: "center", fontSize: 18, bold: true, foreground: "#4a3bd6" }),
  ];
  const controller = syncController(newControllerSource("GreetingController", "", { fields: t("the designer writes this part"), initialize: t("Runs once the window is loaded.") }), p.form, "GreetingController", (name) => `TODO ${name}`)
    .replace(/(void greetButton_Action\(ActionEvent event\) \{\n)\s*\/\/ TODO greetButton\n/, `$1        String name = nameField.getText().trim();\n        answerLabel.setText(name.isEmpty() ? ${JSON.stringify(t("Type your name first."))} : ${JSON.stringify(t("Hello, "))} + name + "!");\n`)
    .replace(/(void nameField_Action\(ActionEvent event\) \{\n)\s*\/\/ TODO nameField\n/, `$1        // ${t("Enter in the text field does the same as the button.")}\n        greetButton_Action(event);\n`);
  return {
    "GreetingWindow.fxml": writeFxml(p),
    "GreetingController.java": controller,
    "GreetingApp.java": newFxAppSource("GreetingApp", "", "GreetingWindow.fxml", t("Greeting")),
  };
}
