import { errorCode, normalize, toWin32 } from "@romanilyin/canonicalpath/canonicalpath"
import type { CanonicalPath } from "@romanilyin/canonicalpath/canonicalpath"

export type Directory = string & { readonly _brand: "ServerDirectory" }

export type Profile =
  | { readonly kind: "win32" }
  | { readonly kind: "posix" }
  | { readonly kind: "wsl"; readonly mountRoot: string; readonly distro?: string }

export type ParseReason = "empty" | "nul" | "drive-relative" | "foreign" | "invalid"

export class ParseError extends Error {
  readonly reason: ParseReason

  constructor(reason: ParseReason, message: string) {
    super(message)
    this.name = "ServerDirectoryParseError"
    this.reason = reason
  }
}

export function profile(input?: {
  readonly platform?: NodeJS.Platform
  readonly env?: NodeJS.ProcessEnv
  readonly mountRoot?: string
}): Profile {
  const platform = input?.platform ?? process.platform
  const env = input?.env ?? process.env
  if (platform === "win32") return { kind: "win32" }
  if (platform === "linux" && (env.WSL_DISTRO_NAME || env.WSL_INTEROP)) {
    return {
      kind: "wsl",
      mountRoot: input?.mountRoot ?? "/mnt",
      ...(env.WSL_DISTRO_NAME ? { distro: env.WSL_DISTRO_NAME } : {}),
    }
  }
  return { kind: "posix" }
}

export function parse(raw: string, target: Profile = profile()): Directory {
  if (raw.length === 0) throw new ParseError("empty", "Path is empty")
  if (raw.includes("\0")) throw new ParseError("nul", "Path contains NUL")
  if (target.kind === "win32") return parseWindows(raw)
  if (hasWindowsDriveRoot(raw) || hasWindowsUncRoot(raw)) throw foreignPathError(raw)
  return raw as Directory
}

function parseWindows(raw: string): Directory {
  if (hasPosixRoot(raw)) throw foreignPathError(raw)
  if (
    !hasWindowsDriveRoot(raw) &&
    !hasWindowsUncRoot(raw) &&
    !hasWindowsDriveRelative(raw) &&
    !hasUriScheme(raw)
  ) {
    return raw as Directory
  }
  try {
    return toWin32(normalize(raw) as CanonicalPath) as Directory
  } catch (error) {
    throw toParseError(error)
  }
}

function hasWindowsDriveRoot(value: string) {
  return /^[A-Za-z]:[\\/]/.test(value)
}

function hasWindowsDriveRelative(value: string) {
  return /^[A-Za-z]:(?:$|[^\\/])/.test(value)
}

function hasWindowsUncRoot(value: string) {
  return /^\\\\/.test(value) || /^\/\/(?:[^/]|$)/.test(value)
}

function hasPosixRoot(value: string) {
  return value.startsWith("/") && !hasWindowsUncRoot(value)
}

function hasUriScheme(value: string) {
  return /^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(value)
}

function foreignPathError(raw: string) {
  try {
    normalize(raw, { targetProfile: "posix" })
  } catch (error) {
    if (errorCode(error) === "ERR_INVALID_PATH") {
      return new ParseError("foreign", "Path syntax is not native to this server")
    }
    return toParseError(error)
  }
  return new ParseError("foreign", "Path syntax is not native to this server")
}

function toParseError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  switch (errorCode(error)) {
    case "ERR_EMPTY_PATH":
      return new ParseError("empty", "Path is empty")
    case "ERR_NUL_BYTE":
      return new ParseError("nul", "Path contains NUL")
    case "ERR_DRIVE_RELATIVE_PATH":
      return new ParseError("drive-relative", "Windows drive-relative paths are not allowed")
    default:
      return new ParseError("invalid", message)
  }
}

export * as ServerDirectory from "./server-directory"
