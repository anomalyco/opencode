export type WslRuntimeCheck = {
  available: boolean
  version: string | null
  error: string | null
}

export type WslInstalledDistro = {
  name: string
  version: number | null
  isDefault: boolean
}

export type WslOnlineDistro = {
  name: string
  label: string
}

export type WslDistroProbe = {
  name: string
  canExecute: boolean
  hasBash: boolean
  hasCurl: boolean
  error: string | null
}

export type WslOpencodeCheck = {
  distro: string
  resolvedPath: string | null
  version: string | null
  expectedVersion: string | null
  matchesDesktop: boolean | null
  error: string | null
}

export type WslServerConfig = {
  id: string
  distro: string
}

export type WslServerRuntime =
  | { kind: "starting" }
  | { kind: "ready"; url: string; username: string | null; password: string | null }
  | { kind: "failed"; message: string }
  | { kind: "stopped" }

export type WslServerItem = {
  config: WslServerConfig
  runtime: WslServerRuntime
}

export type WslJob =
  | { kind: "runtime"; startedAt: number }
  | { kind: "distros"; startedAt: number }
  | { kind: "install-wsl"; startedAt: number }
  | { kind: "install-distro"; distro: string; startedAt: number }
  | { kind: "probe-addable"; distros: string[]; startedAt: number }
  | { kind: "install-opencode"; distro: string; startedAt: number }

export type WslServersState = {
  runtime: WslRuntimeCheck | null
  installed: WslInstalledDistro[]
  online: WslOnlineDistro[]
  distroProbes: Record<string, WslDistroProbe>
  opencodeChecks: Record<string, WslOpencodeCheck>
  pendingRestart: boolean
  servers: WslServerItem[]
  job: WslJob | null
}

export type WslServersEvent = { type: "state"; state: WslServersState }

export type WslServersPlatform = {
  getState(): Promise<WslServersState>
  subscribe(cb: (event: WslServersEvent) => void): () => void
  probeRuntime(): Promise<void>
  refreshDistros(): Promise<void>
  installWsl(): Promise<void>
  installDistro(name: string): Promise<void>
  probeAddable(distros: string[]): Promise<void>
  installOpencode(name: string): Promise<void>
  openTerminal(name: string): Promise<void>
  addServer(distro: string): Promise<WslServerConfig>
  removeServer(id: string): Promise<void>
  startServer(id: string): Promise<void>
}
