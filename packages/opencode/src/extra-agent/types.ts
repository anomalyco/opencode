export interface BridgeServer {
  readonly hostname?: string
  readonly port?: number
  stop(): void | Promise<void>
}

export interface BridgeListenOpts {
  hostname: string
  port: number
  cors?: string[]
  config?: Record<string, unknown>
}

export interface ExtraAgentBridge {
  readonly id: string
  listen(opts: BridgeListenOpts): BridgeServer
}
