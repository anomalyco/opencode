/** LSP server stub — no servers are launched for browser agent. */
export namespace LSPServer {
  export interface Handle { id: string; kill(): void }
  export interface Info { id: string; name: string; extensions: string[] }
}
