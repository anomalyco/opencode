export function collectDeepLinkArgs(args: string[]) {
  return args.filter((arg) => {
    try {
      return new URL(arg).protocol === "opencode:"
    } catch {
      return false
    }
  })
}
