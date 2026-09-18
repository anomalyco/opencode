/** Connection details for a local OpenCode service. */
export type Endpoint = {
  /** Base URL of the service. */
  readonly url: string
  /** Authentication required by the service, when configured. */
  readonly auth?: {
    /** HTTP authentication scheme. */
    readonly type: "basic"
    /** Basic authentication username. */
    readonly username: string
    /** Basic authentication password. */
    readonly password: string
  }
}

/** Options used to discover the local OpenCode service. */
export type DiscoverOptions = {
  /** Absolute registration file path. Defaults to the XDG state directory. */
  readonly file?: string
  /** Required exact service version or compatibility predicate. */
  readonly version?: string | ((version: string) => boolean)
}

/** Reason ensuring the service requires a new process. */
export type EnsureReason = "missing" | "version-mismatch"

/** Options used to ensure the local OpenCode service is running. */
export type EnsureOptions = DiscoverOptions & {
  /** Service command and arguments. Defaults to `opencode serve --service`. */
  readonly command?: ReadonlyArray<string>
  /** Environment variables added to the inherited service process environment. */
  readonly env?: Readonly<Record<string, string>>
  /** Called once before spawning a new service process. */
  readonly onStart?: (reason: EnsureReason, previousVersion?: string) => void
}

/** Options used to stop the local OpenCode service. */
export type StopOptions = {
  /** Absolute registration file path. Defaults to the XDG state directory. */
  readonly file?: string
  /** How to handle persistent terminals before stopping the service. */
  readonly pty?: "clear" | "handoff"
}

/** Contents of the local service registration file. */
export type Info = {
  /** Unique service instance identifier. */
  readonly id?: string
  /** OpenCode version served by the process. */
  readonly version?: string
  /** Base URL advertised by the service. */
  readonly url: string
  /** Operating system process identifier. */
  readonly pid: number
  /** Private service password, when authentication is enabled. */
  readonly password?: string
}

/** Rewrite wildcard bind addresses to loopback for local client connections. */
export function loopbackURL(value: string) {
  const url = new URL(value)
  // Bun keeps IPv6 brackets on hostname (`[::]`); WHATWG/Node use `::`.
  if (url.hostname !== "0.0.0.0" && url.hostname !== "::" && url.hostname !== "[::]") return value
  if (url.hostname === "0.0.0.0") url.hostname = "127.0.0.1"
  if (url.hostname === "::") url.hostname = "::1"
  if (url.hostname === "[::]") url.hostname = "[::1]"
  return value.endsWith("/") ? url.href : url.origin
}
