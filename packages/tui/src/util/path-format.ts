import path from "path"

export function abbreviateHome(input: string, home: string) {
  if (!home) return input
  const paths = windowsPath(home) ? path.win32 : path.posix
  const relative = paths.relative(home, input)
  if (!relative) return "~"
  if (relative === ".." || relative.startsWith(".." + paths.sep) || paths.isAbsolute(relative)) return input
  return "~/" + relative.split(paths.sep).join("/")
}

// The final path segment, split by the same win32/posix rule as the rest of this module so a
// Windows directory divides on backslashes.
export function basename(input: string, home: string) {
  const paths = windowsPath(home) || windowsPath(input) ? path.win32 : path.posix
  return paths.basename(input)
}

export function formatPath(
  input: string | undefined,
  options: { base: string; home?: string; forwardSlashes?: boolean },
) {
  if (!input) return ""
  const windows = windowsPath(options.base)
  if (!windows && windowsPath(input)) {
    return options.forwardSlashes ? input.replaceAll("\\", "/") : input
  }

  const paths = windows ? path.win32 : path.posix
  const absolute = paths.isAbsolute(input) ? input : paths.resolve(options.base, input)
  const relative = paths.relative(options.base, absolute)
  const formatted = !relative
    ? "."
    : relative !== ".." && !relative.startsWith(".." + paths.sep) && !paths.isAbsolute(relative)
      ? relative
      : options.home
        ? abbreviateHome(absolute, options.home)
        : absolute
  return options.forwardSlashes ? formatted.replaceAll("\\", "/") : formatted
}

function windowsPath(input: string) {
  return /^[A-Za-z]:[\\/]/.test(input) || input.startsWith("\\\\")
}
