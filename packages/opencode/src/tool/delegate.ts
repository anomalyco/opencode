export interface FileSystemDelegate {
  read?(path: string, options?: { offset?: number; limit?: number }): Promise<string>
  write?(path: string, content: string): Promise<void>
}

export namespace FileSystemDelegate {
  const registry = new Map<string, FileSystemDelegate>()

  export function register(sessionID: string, delegate: FileSystemDelegate) {
    registry.set(sessionID, delegate)
  }

  export function get(sessionID: string): FileSystemDelegate | undefined {
    return registry.get(sessionID)
  }

  export function unregister(sessionID: string) {
    registry.delete(sessionID)
  }
}
