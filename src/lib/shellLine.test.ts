import { describe, expect, it } from "vitest";
import { shellLine } from "./shellLine";

describe("shellLine", () => {
  const mvn = String.raw`C:\Program Files\Maven\bin\mvn.cmd`;
  it("quotes for PowerShell, keeping -Dkey=value whole", () => {
    expect(shellLine("powershell", mvn, ["-Dtest=CircleTest", "test"])).toBe(String.raw`& 'C:\Program Files\Maven\bin\mvn.cmd' '-Dtest=CircleTest' test`);
    expect(shellLine("pwsh", String.raw`C:\p\mvnw.cmd`, ["clean"])).toBe(String.raw`& 'C:\p\mvnw.cmd' clean`);
  });
  it("quotes for the Command Prompt", () => {
    expect(shellLine("cmd", mvn, ["clean", "verify"])).toBe(String.raw`"C:\Program Files\Maven\bin\mvn.cmd" clean verify`);
  });
  it("turns the path into a Git Bash path", () => {
    expect(shellLine("bash", String.raw`C:\Users\Ada\p\gradlew.bat`, ["test", "--tests", "app.App*"])).toBe("/c/Users/Ada/p/gradlew.bat test --tests 'app.App*'");
  });
});
