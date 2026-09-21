export { sshHostname, sshName } from "./name"
export { isSshConnecting } from "./status"
import type { SshConfig, SshHttp, SshItem, SshStart, SshState } from "./schema"

export type { SshConfig, SshHttp, SshItem, SshStart, SshState }

export type SshPlatform = {
  getState(): Promise<SshState>
  subscribe(callback: (state: SshState) => void): () => void
  hosts(): Promise<readonly string[]>
  start(input: SshStart): Promise<void>
  resolve(id: string): Promise<SshHttp | null>
  respond(id: string, prompt: string, value: string): Promise<void>
  disconnect(id: string): Promise<void>
  cancel(id: string): Promise<void>
  forget(id: string): Promise<void>
  openConfig(): Promise<void>
}


