/**
 * The links among a process's arguments. Windows and Linux start the app for a link with the link on the command
 * line, next to the executable, Chromium switches and, in a source build, the app's folder.
 */
export function deepLinkArguments(argv: readonly string[]) {
  return argv.filter((arg) => arg.startsWith("opencode://"))
}

/** The arguments a relaunch starts with: this launch's own, without its links, which would open a second time. */
export function relaunchArguments(argv: readonly string[]) {
  return argv.slice(1).filter((arg) => !arg.startsWith("opencode://"))
}
