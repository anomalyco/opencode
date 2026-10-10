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

/** A managed service could not bind its fixed port and did not recognize an OpenCode incumbent. */
export class PortConflictError extends Error {
  /** Error identity for managed service port conflicts. */
  override readonly name = "PortConflictError"

  /**
   * Create a confirmed managed service port conflict.
   * @param hostname Host on which the service attempted to listen.
   * @param port Fixed TCP port that was already occupied.
   * @param options Original listener failure, when available.
   */
  constructor(
    /** Host on which the service attempted to listen. */
    readonly hostname: string,
    /** Fixed TCP port that was already occupied. */
    readonly port: number,
    options?: ErrorOptions,
  ) {
    super(
      `Managed service port ${port} on ${hostname} is already in use by another process. ` +
        "Configure another port with `opencode service set port <port>` and start the service again.",
      options,
    )
  }
}
