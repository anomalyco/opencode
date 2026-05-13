import { BlobMissing, type ExchangeFileBackend } from "../../src/exchange-files"

/**
 * Only for `bun test` in this package — not loaded in production. Real deploys use `S3ExchangeFiles`
 * (DigitalOcean Spaces, AWS S3, etc.); local dev points at MinIO via `UNIVER_COMPAT_S3_*`.
 */
export class MemoryExchangeFiles implements ExchangeFileBackend {
  private readonly m = new Map<string, Uint8Array>()

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
}
