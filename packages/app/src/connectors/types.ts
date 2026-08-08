/**
 * Shared types for Jarvis connectors.
 *
 * These types are used by:
 * - The renderer (UI components + platform bridge)
 * - The desktop main process (OAuth device flow implementation)
 *
 * The desktop main process owns the GitHub OAuth flow (device flow) and token
 * storage (encrypted with Electron safeStorage). The renderer only talks to it
 * through the platform bridge (`platform.connector.github`).
 */

/** Public GitHub user info — safe to store plaintext (not a secret). */
export type GitHubUser = {
  /** GitHub username, e.g. "jaminsmoke" */
  login: string
  /** Avatar URL */
  avatar: string
  /** Optional display name */
  name?: string
}

/** Current state of the GitHub connector. */
export type GitHubConnectorStatus = {
  /** Whether the connector is enabled (Switch ON). */
  enabled: boolean
  /** Whether an access token exists and the user is connected. */
  connected: boolean
  /** The connected GitHub user, if any. */
  user?: GitHubUser
}

/** Result of starting a device-flow authorization attempt. */
export type DeviceFlowStart = {
  /** Opaque session id; the renderer passes it back to poll. The device_code itself never leaves the main process. */
  sessionId: string
  /** Human-readable code the user must enter at the verification URL, e.g. "WDJB-MJHT". */
  userCode: string
  /** URL to open in the browser, e.g. https://github.com/login/device */
  verificationUri: string
  /** Minimum polling interval in seconds. */
  interval: number
  /** How long the codes are valid, in seconds. */
  expiresIn: number
}

/** Result of polling a device-flow authorization attempt. */
export type DeviceFlowPoll =
  | { status: "success"; user: GitHubUser }
  | { status: "pending"; slowDown?: boolean }
  | { status: "expired" }
  | { status: "denied" }
  | { status: "error"; message: string }

/** The platform bridge surface for the GitHub connector (desktop only). */
export type GitHubConnectorPlatform = {
  /** Get current status (enabled + connected + user). */
  getStatus(): Promise<GitHubConnectorStatus>
  /** Enable or disable the connector. Disabling does NOT revoke the token. */
  setEnabled(enabled: boolean): Promise<GitHubConnectorStatus>
  /** Begin a device-flow authorization. Returns the code to show the user. */
  startDeviceFlow(): Promise<DeviceFlowStart>
  /** Poll the device-flow attempt. Call every `interval` seconds until a terminal state. */
  pollDeviceFlow(sessionId: string): Promise<DeviceFlowPoll>
  /** Revoke the stored token and disconnect. */
  disconnect(): Promise<GitHubConnectorStatus>
}

/** All connectors exposed on the platform bridge. */
export type ConnectorPlatform = {
  github: GitHubConnectorPlatform
}
