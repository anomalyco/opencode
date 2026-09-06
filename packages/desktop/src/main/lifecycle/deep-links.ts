export function deepLinksFromArgv(argv: string[]) {
  return argv.filter((arg) => arg.startsWith("opencode://"))
}
