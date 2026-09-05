export type SshHostProbe = {
  host: string
  reachable: boolean
  opencodePath: string | null
  opencodeVersion: string | null
  expectedVersion: string | null
  matchesDesktop: boolean | null
  error: string | null
}

export type SshServerConfig = {
  id: string
  host: string
}

export type SshServerRuntime =
  | { kind: "starting" }
  | { kind: "ready"; url: string; username: string | null; password: string | null }
  | { kind: "failed"; message: string; reason?: "opencode-missing" }
  | { kind: "stopped" }

export type SshServerItem = {
  config: SshServerConfig
  runtime: SshServerRuntime
}

export type SshJob =
  | { kind: "probe-host"; host: string; startedAt: number }
  | { kind: "install-opencode"; host: string; startedAt: number }

export type SshServersState = {
  configHosts: string[]
  hostProbes: Record<string, SshHostProbe>
  servers: SshServerItem[]
  job: SshJob | null
}

export type SshServersEvent = { type: "state"; state: SshServersState }

export type SshServersPlatform = {
  getState(): Promise<SshServersState>
  subscribe(cb: (event: SshServersEvent) => void): () => void
  refreshConfigHosts(): Promise<void>
  probeHost(host: string): Promise<void>
  installOpencode(host: string): Promise<void>
  openTerminal(host: string): Promise<void>
  addServer(host: string): Promise<SshServerConfig>
  removeServer(id: string): Promise<void>
  startServer(id: string): Promise<void>
  stopServer(id: string): Promise<void>
}
