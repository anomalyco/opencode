// MUC Harness: 连接控制器 —— 把 deep link code 变成本机安全凭据，
// 并以内存环境变量 MUC_API_KEY 注入 opencode 核心（不落盘）。

import { MucSecretStore, type MucConnectionState } from "./secret-store"
import { exchangeMucCode, MucExchangeError } from "./connect"
import { mucGatewayBaseURL } from "./gateway"

export class MucConnectController {
  constructor(private store: MucSecretStore) {}

  async getState(): Promise<MucConnectionState> {
    return this.store.getState()
  }

  async connect(code: string): Promise<MucConnectionState> {
    const gateway = mucGatewayBaseURL()
    const deviceName = this.store.getDeviceId().slice(0, 8)
    const result = await exchangeMucCode(gateway, code, `MUC-${deviceName}`)
    const state = await this.store.set({
      gateway: result.gateway,
      apiKey: result.apiKey,
      keyName: result.keyName,
      user: result.user,
    })
    this.applyToProcessEnv(result.apiKey)
    return state
  }

  async disconnect(): Promise<MucConnectionState> {
    await this.store.clear()
    delete process.env.MUC_API_KEY
    return { connected: false }
  }

  // 启动时恢复：把已存凭据注入本进程内存（供内嵌 opencode server 读取）
  async restoreToProcessEnv(): Promise<MucConnectionState> {
    const cred = await this.store.get()
    if (!cred) return { connected: false }
    this.applyToProcessEnv(cred.apiKey)
    return this.store.getState()
  }

  private applyToProcessEnv(apiKey: string): void {
    process.env.MUC_API_KEY = apiKey
  }
}

export function isMucExchangeError(error: unknown): error is MucExchangeError {
  return error instanceof MucExchangeError
}
