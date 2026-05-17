import { BlobMissing, type ExchangeFileBackend } from "./exchange-files"

type PutSlot = { key: string; exp: number; contentType: string; owner: string }
type GetSlot = { key: string; exp: number; owner: string }

/**
 * In-process object storage for `bun test` only. Presigned URLs are same-origin paths
 * (`/_memory_exchange_*`) consumed by `createCompatApp` routes — not for production deploys.
 */
export class MemoryExchangeFiles implements ExchangeFileBackend {
  private readonly m = new Map<string, Uint8Array>()
  private readonly putSlots = new Map<string, PutSlot>()
  private readonly getSlots = new Map<string, GetSlot>()

  async ensureReady() {}

  async put(id: string, body: Uint8Array) {
    this.m.set(id, body)
  }

  async exists(id: string) {
    return this.m.has(id)
  }

  async get(id: string) {
    const b = this.m.get(id)
    if (!b) throw new BlobMissing()
    return b
  }

  async presignedPut(key: string, contentType: string, ttlSec: number, owner: string) {
    const token = crypto.randomUUID()
    this.putSlots.set(token, { key, exp: Date.now() + ttlSec * 1000, contentType, owner })
    return {
      url: `/universer-api/_memory_exchange_put/${token}`,
      headers: { "Content-Type": contentType },
    }
  }

  async presignedGet(key: string, ttlSec: number, owner: string) {
    const token = crypto.randomUUID()
    this.getSlots.set(token, { key, exp: Date.now() + ttlSec * 1000, owner })
    return { url: `/universer-api/_memory_exchange_get/${token}` }
  }

  async listKeysWithPrefix(prefix: string) {
    const out: string[] = []
    for (const k of this.m.keys()) {
      if (k.startsWith(prefix)) out.push(k)
    }
    return out.sort()
  }

  finishPresignedPut(token: string, actor: string, body: Uint8Array) {
    const slot = this.putSlots.get(token)
    if (!slot) throw new Error("invalid presign token")
    if (slot.owner !== actor) throw new Error("presign actor mismatch")
    if (Date.now() > slot.exp) {
      this.putSlots.delete(token)
      throw new Error("presign expired")
    }
    this.putSlots.delete(token)
    this.m.set(slot.key, body)
  }

  consumePresignedGetToken(token: string, actor: string) {
    const slot = this.getSlots.get(token)
    if (!slot) return undefined
    if (slot.owner !== actor) {
      this.getSlots.delete(token)
      return undefined
    }
    if (Date.now() > slot.exp) {
      this.getSlots.delete(token)
      return undefined
    }
    this.getSlots.delete(token)
    return slot.key
  }
}
