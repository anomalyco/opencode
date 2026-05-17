import { GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client as AwsJsS3Client } from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import { S3Client } from "bun"

/**
 * Exchange uploads (xlsx bytes): `u/<userId>/sheets/exchange/<FileId>`.
 * Unit bundles: `u/<userId>/sheets/veritly/unit/<unitID>.json` via `Store.persistUnit`.
 * Browser uploads use presigned PUT; bucket stays private. Server still uses Bun `S3Client` for unit bundles.
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

export type PresignHeaders = Record<string, string>

/** Upload / resolve exchange XLSX blobs. Server-side `put`/`get`/`exists` for import + unit persistence; presign for browser PUT/GET. */
export interface ExchangeFileBackend {
  /** Verify bucket is reachable (list probe). Create the bucket out-of-band (MinIO init in Docker compose, Pulumi for DO Spaces). */
  ensureReady(): Promise<void>
  put(id: string, body: Uint8Array): Promise<void>
  exists(id: string): Promise<boolean>
  get(id: string): Promise<Uint8Array>
  presignedPut(
    id: string,
    contentType: string,
    ttlSec: number,
    owner: string,
  ): Promise<{ url: string; headers: PresignHeaders }>
  presignedGet(id: string, ttlSec: number, owner: string): Promise<{ url: string }>
  listKeysWithPrefix(prefix: string): Promise<string[]>
}

export function exchangeFilesFromEnv(): S3ExchangeFiles {
  const endpoint = requiredEnv("UNIVER_COMPAT_S3_ENDPOINT")
  const region = requiredEnv("UNIVER_COMPAT_S3_REGION")
  const access = requiredEnv("UNIVER_COMPAT_S3_ACCESS_KEY")
  const secret = requiredEnv("UNIVER_COMPAT_S3_SECRET_KEY")
  const bucket = requiredEnv("UNIVER_COMPAT_S3_BUCKET")
  const bun = new S3Client({
    accessKeyId: access,
    secretAccessKey: secret,
    bucket,
    endpoint,
    region,
  })
  const signer = new AwsJsS3Client({
    region,
    endpoint,
    credentials: { accessKeyId: access, secretAccessKey: secret },
    forcePathStyle: true,
  })
  return new S3ExchangeFiles(bun, signer, bucket)
}

export class S3ExchangeFiles implements ExchangeFileBackend {
  constructor(
    private readonly bun: S3Client,
    private readonly signer: AwsJsS3Client,
    private readonly bucket: string,
  ) {}

  async ensureReady() {
    const stamp = () => new Date().toISOString()
    console.error(`[univer-compat] ${stamp()} S3 ensureReady: ListObjectsV2 bucket=${this.bucket} (30s abort)`)
    /** Bun `S3Client.list` has hung indefinitely against MinIO in Linux Testcontainers; AWS SDK matches presign path. */
    await this.signer.send(
      new ListObjectsV2Command({ Bucket: this.bucket, MaxKeys: 1 }),
      { abortSignal: AbortSignal.timeout(30_000) },
    )
    console.error(`[univer-compat] ${stamp()} S3 ensureReady: ok`)
  }

  async put(id: string, body: Uint8Array) {
    await this.bun.write(id, body)
  }

  async exists(id: string) {
    return await this.bun.exists(id)
  }

  async get(id: string) {
    try {
      return await this.bun.file(id).bytes()
    } catch (e: unknown) {
      if (notFound(e)) throw new BlobMissing()
      throw e
    }
  }

  async presignedPut(id: string, contentType: string, ttlSec: number, _owner: string) {
    const cmd = new PutObjectCommand({
      Bucket: this.bucket,
      Key: id,
      ContentType: contentType,
    })
    const url = await getSignedUrl(this.signer, cmd, { expiresIn: ttlSec })
    return { url, headers: { "Content-Type": contentType } }
  }

  async presignedGet(id: string, ttlSec: number, _owner: string) {
    const cmd = new GetObjectCommand({ Bucket: this.bucket, Key: id })
    const url = await getSignedUrl(this.signer, cmd, { expiresIn: ttlSec })
    return { url }
  }

  async listKeysWithPrefix(prefix: string) {
    const out: string[] = []
    let token: string | undefined
    do {
      const r = await this.signer.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefix,
          ContinuationToken: token,
        }),
      )
      for (const o of r.Contents ?? []) {
        if (o.Key) out.push(o.Key)
      }
      token = r.IsTruncated && r.NextContinuationToken ? r.NextContinuationToken : undefined
    } while (token)
    return out
  }
}
