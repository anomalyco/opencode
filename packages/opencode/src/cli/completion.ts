export function isShellCompletionInvocation(argv: readonly string[]) {
  if (argv.includes("--get-yargs-completions")) return true
  return argv.find((arg) => !arg.startsWith("-")) === "completion"
}
