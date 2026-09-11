const windowIDPrefix = "--opencode-window-id="

export function windowIDArgument(id: string) {
  return windowIDPrefix + encodeURIComponent(id)
}

export function windowIDFromArguments(args: readonly string[]) {
  const value = args.find((arg) => arg.startsWith(windowIDPrefix))?.slice(windowIDPrefix.length)
  if (!value) throw new Error("Window ID argument not found")
  return decodeURIComponent(value)
}
