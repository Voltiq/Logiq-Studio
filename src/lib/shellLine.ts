/* Quoting a command line for the shell a terminal runs. */

/** A command line that runs `program` with `args` in the given shell, quoted for it. */
export function shellLine(shell: string, program: string, args: string[]): string {
  if (shell === "cmd") {
    return [program, ...args].map((a) => (/[\s&|<>^()]/.test(a) ? `"${a.replace(/"/g, '""')}"` : a)).join(" ");
  }
  if (shell === "bash" || shell === "zsh" || shell === "default") {
    const p = /^[A-Za-z]:\\/.test(program) ? "/" + program[0].toLowerCase() + program.slice(2).replace(/\\/g, "/") : program;
    return [p, ...args].map((a) => (/[^\w@%+=:,./-]/.test(a) ? `'${a.replace(/'/g, "'\\''")}'` : a)).join(" ");
  }
  // PowerShell: `&` runs a quoted path; arguments with = . or spaces are quoted so -Dkey=value stays whole.
  return "& " + [program, ...args].map((a) => (/[^\w\\:/-]/.test(a) ? `'${a.replace(/'/g, "''")}'` : a)).join(" ");
}
