const OPS = "(?:\\d+>>?|>>|>|&>|>&)"

export function normalizeNul(command: string, platform: string) {
  if (platform === "win32") return command

  return command
    .replace(new RegExp(`(^|[\\s;|&(])(${OPS}\\s*)["']nul["'](?=($|[\\s;|&)]))`, "gi"), "$1$2/dev/null")
    .replace(new RegExp(`(^|[\\s;|&(])(${OPS}\\s*)nul(?=($|[\\s;|&)]))`, "gi"), "$1$2/dev/null")
}
