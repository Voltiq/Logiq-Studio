import { describe, expect, it } from "vitest";
import { parseTraceback } from "./traceback";

const inProject = (p: string) => p.startsWith("C:\\p\\");

describe("parseTraceback", () => {
  it("points at the last frame in the project", () => {
    const err = `Traceback (most recent call last):
  File "C:\\p\\main.py", line 12, in <module>
    main()
  File "C:\\p\\shapes.py", line 5, in area
    return self.w * h
                    ^
  File "C:\\Python314\\Lib\\json\\__init__.py", line 3, in dumps
    raise TypeError("x")
NameError: name 'h' is not defined
`;
    expect(parseTraceback(err, inProject)).toEqual({ path: "C:\\p\\shapes.py", line: 5, column: 0, severity: "error", message: "NameError: name 'h' is not defined" });
  });

  it("reads syntax errors with their column", () => {
    const err = `  File "C:\\p\\main.py", line 3
    print("x"
         ^
SyntaxError: '(' was never closed
`;
    expect(parseTraceback(err, inProject)).toEqual({ path: "C:\\p\\main.py", line: 3, column: 6, severity: "error", message: "SyntaxError: '(' was never closed" });
  });

  it("reads Python 3.14's tracebacks with their ~~~^^^ marks", () => {
    const err = `Traceback (most recent call last):
  File "C:\\p\\main.py", line 10, in <module>
    main()
    ~~~~^^
  File "C:\\p\\main.py", line 3, in total
    return sum(items) + "x"
           ~~~~~~~~~~~^~~~~
TypeError: unsupported operand type(s) for +: 'int' and 'str'
`;
    expect(parseTraceback(err, inProject)).toEqual({ path: "C:\\p\\main.py", line: 3, column: 0, severity: "error", message: "TypeError: unsupported operand type(s) for +: 'int' and 'str'" });
  });

  it("ignores output without a traceback", () => {
    expect(parseTraceback("Warning: something\nDone\n", inProject)).toBeNull();
  });
});
