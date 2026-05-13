import { S3Client } from "bun"

/**
 * Exchange uploads (xlsx bytes) are stored as binary S3 objects: object key = upload `FileId`, body = raw bytes
 * (`client.write`). Same pattern as `univer-go-compat` persisting uploads to object storage.
 *
 * Sheet **unit** state (revision, snapshots, changesets) is stored separately under `veritly/unit/<unitID>.json`
 * via `Store.persistUnit` — not under project paths; OpenCode owns project/session ↔ unit mapping.
 *
 * Production: S3-compatible endpoint + bucket policies (e.g. DigitalOcean Spaces). Local dev: MinIO in Docker only.
 * Configure via `UNIVER_COMPAT_S3_*` — never assume MinIO in production.
 */

/** Missing exchange upload blob (S3 `NoSuchKey`). */
export class BlobMissing extends Error {
  readonly tag = "blob-missing"
  constructor() {
    super("exchange blob missing")
    this.name = "BlobMissing"
  }
}

function notFound(e: unknown) {
  if (!e || typeof e !== "object") return false
  const o = e as { name?: string; code?: string }
  return o.name === "S3Error" && o.code === "NoSuchKey"
}

function requiredEnv(name: string): string {
  const v = process.env[name]?.trim()
  if (!v) throw new Error(`${name} is required`)
  return v
}

/** Upload / resolve exchange XLSX blobs (universer upload → import task). Binary in, binary out. */
export interface ExchangeFileBackend {
  /** Verify bucket is reachable (list probe). Create the bucket out-of-band (e.g. MinIO init in Docker compose). */
  ensureReady(): Promise<void>
  put(id: string, body: Uint8Array): Promise<void>
  exists(id: string): Promise<boolean>
  get(id: string): Promise<Uint8Array>
}

export function exchangeFilesFromEnv(): S3ExchangeFiles {
  const endpoint = requiredEnv("UNIVER_COMPAT_S3_ENDPOINT")
  const region = requiredEnv("UNIVER_COMPAT_S3_REGION")
  const access = requiredEnv("UNIVER_COMPAT_S3_ACCESS_KEY")
  const secret = requiredEnv("UNIVER_COMPAT_S3_SECRET_KEY")
  const bucket = requiredEnv("UNIVER_COMPAT_S3_BUCKET")
  const client = new S3Client({
    accessKeyId: access,
    secretAccessKey: secret,
    bucket,
    endpoint,
    region,
  })
  return new S3ExchangeFiles(client)
}

export class S3ExchangeFiles implements ExchangeFileBackend {
  constructor(private readonly client: S3Client) {}

  async ensureReady() {
    await this.client.list({ maxKeys: 1 })
  }

  async put(id: string, body: Uint8Array) {
    await this.client.write(id, body)
  }

  async exists(id: string) {
    return await this.client.exists(id)
  }

  async get(id: string) {
    try {
      return await this.client.file(id).bytes()
    } catch (e: unknown) {
      if (notFound(e)) throw new BlobMissing()
      throw e
    }
  }
}
