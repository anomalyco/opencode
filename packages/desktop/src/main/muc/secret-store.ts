// MUC Harness: 凭据安全存储。
// macOS 上 Electron safeStorage 由 Keychain 背书；密文落盘 userData，
// 明文仅存在于调用进程内存。禁止把凭据写入 config/日志/localStorage。

import { safeStorage } from "electron"
import fs from "node:fs"
import path from "node:path"
import { randomUUID } from "node:crypto"
import { resolveBrand } from "@opencode-ai/brand"

export type MucCredential = {
  gateway: string
  apiKey: string
  keyName: string
  deviceId: string
  user: string
  connectedAt: string
}

export type MucConnectionState =
  | { connected: false }
  | {
      connected: true
      gateway: string
      keyName: string
      deviceId: string
      user: string
      connectedAt: string
    }

export class MucSecretStore {
  private file: string
  private deviceId: string

  constructor(userDataDir: string) {
    // 各品牌凭据文件隔离（muc 保持历史文件名，老用户凭据不失效）
    const prefix = resolveBrand().id === "muc" ? "muc" : resolveBrand().id
    this.file = path.join(userDataDir, `${prefix}-credential.bin`)
    // 设备 ID 非机密，明文存放，用于 per-device Key 撤销对账
    const idFile = path.join(userDataDir, `${prefix}-device-id`)
    try {
      this.deviceId = fs.readFileSync(idFile, "utf8").trim()
    } catch {
      this.deviceId = randomUUID()
      fs.mkdirSync(path.dirname(idFile), { recursive: true })
      fs.writeFileSync(idFile, this.deviceId, { mode: 0o600 })
    }
  }

  getDeviceId(): string {
    return this.deviceId
  }

  static isEncryptionAvailable(): boolean {
    try {
      return safeStorage.isEncryptionAvailable()
    } catch {
      return false
    }
  }

  async set(credential: Omit<MucCredential, "deviceId" | "connectedAt">): Promise<MucConnectionState> {
    if (!MucSecretStore.isEncryptionAvailable()) {
      throw new Error("secure storage unavailable on this platform")
    }
    const full: MucCredential = {
      ...credential,
      deviceId: this.deviceId,
      connectedAt: new Date().toISOString(),
    }
    const encrypted = safeStorage.encryptString(JSON.stringify(full))
    fs.mkdirSync(path.dirname(this.file), { recursive: true })
    fs.writeFileSync(this.file, encrypted, { mode: 0o600 })
    return this.getState()
  }

  async get(): Promise<MucCredential | null> {
    try {
      const raw = fs.readFileSync(this.file)
      if (!MucSecretStore.isEncryptionAvailable()) return null
      const json = safeStorage.decryptString(raw)
      const parsed = JSON.parse(json) as MucCredential
      if (!parsed.apiKey || !parsed.gateway) return null
      return parsed
    } catch {
      return null
    }
  }

  async clear(): Promise<void> {
    try {
      fs.rmSync(this.file, { force: true })
    } catch {
      // 文件不存在视为已清除
    }
  }

  async getState(): Promise<MucConnectionState> {
    const cred = await this.get()
    if (!cred) return { connected: false }
    return {
      connected: true,
      gateway: cred.gateway,
      keyName: cred.keyName,
      deviceId: cred.deviceId,
      user: cred.user,
      connectedAt: cred.connectedAt,
    }
  }
}
