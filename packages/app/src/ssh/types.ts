export type SshConnectionConfig = {
  id: string
  name: string
  host: string
  port?: number
  identityFile?: string
}

export type SshServerRuntime =
  | { kind: "stopped" }
  | { kind: "authenticating" }
  | { kind: "installing" }
  | { kind: "starting" }
  | { kind: "ready"; url: string; username: string | null; password: string | null }
  | { kind: "failed"; message: string }

export type SshServerItem = {
  config: SshConnectionConfig
  runtime: SshServerRuntime
}

export type SshServersState = {
  servers: SshServerItem[]
}

export type SshServersEvent = { type: "state"; state: SshServersState }

export type SshServersPlatform = {
  getState(): Promise<SshServersState>
  subscribe(cb: (event: SshServersEvent) => void): () => void
  addServer(config: SshConnectionConfig): Promise<SshServerItem>
  removeServer(id: string): Promise<void>
  startServer(id: string): Promise<void>
}
