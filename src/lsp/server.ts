/** LSP server stub — no servers are launched for browser agent.
 * Exports empty values so Object.values(LSPServer) works in config validation.
 */
export namespace LSPServer {
  export interface Handle { id: string; kill(): void }
  export interface Info { id: string; name: string; extensions: string[] }
  // No servers — Object.values(LSPServer) returns [] for config validation
}
