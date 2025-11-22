import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3"
import { lazy } from "@opencode-ai/util/lazy"

export namespace Storage {
  export interface Adapter {
    read(path: string): Promise<string | undefined>
    write(path: string, value: string): Promise<void>
    remove(path: string): Promise<void>
    list(prefix: string): Promise<string[]>
  }

  function createAdapter(client: S3Client, bucket: string): Adapter {
    return {
      async read(path: string): Promise<string | undefined> {
        try {
          console.log("reading", bucket, path)
          const command = new GetObjectCommand({
            Bucket: bucket,
            Key: path,
          })
          const response = await client.send(command)
          if (!response.Body) return undefined
          return response.Body.transformToString()
        } catch (e: any) {
          if (e.name === "NoSuchKey") return undefined
          throw e
        }
      },

      async write(path: string, value: string): Promise<void> {
        const command = new PutObjectCommand({
          Bucket: bucket,
          Key: path,
          Body: value,
          ContentType: "application/json",
        })
        await client.send(command)
      },

      async remove(path: string): Promise<void> {
        const command = new DeleteObjectCommand({
          Bucket: bucket,
          Key: path,
        })
        await client.send(command)
      },

      async list(prefix: string): Promise<string[]> {
        const command = new ListObjectsV2Command({
          Bucket: bucket,
          Prefix: prefix,
        })
        const response = await client.send(command)
        return response.Contents?.map((c) => c.Key!) || []
      },
    }
  }

  function s3(): Adapter {
    const bucket = process.env.OPENCODE_STORAGE_BUCKET!
    const client = new S3Client({
      region: process.env.OPENCODE_STORAGE_REGION,
      credentials: process.env.OPENCODE_STORAGE_ACCESS_KEY_ID
        ? {
            accessKeyId: process.env.OPENCODE_STORAGE_ACCESS_KEY_ID!,
            secretAccessKey: process.env.OPENCODE_STORAGE_SECRET_ACCESS_KEY!,
          }
        : undefined,
    })
    return createAdapter(client, bucket)
  }

  function r2() {
    const accountId = process.env.OPENCODE_STORAGE_ACCOUNT_ID!
    const accessKeyId = process.env.OPENCODE_STORAGE_ACCESS_KEY_ID!
    const secretAccessKey = process.env.OPENCODE_STORAGE_SECRET_ACCESS_KEY!
    const bucket = process.env.OPENCODE_STORAGE_BUCKET!

    const client = new S3Client({
      region: "auto",
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
    })
    return createAdapter(client, bucket)
  }

  const adapter = lazy(() => {
    const type = process.env.OPENCODE_STORAGE_ADAPTER
    if (type === "r2") return r2()
    if (type === "s3") return s3()
    throw new Error("No storage adapter configured")
  })

  function resolve(key: string[]) {
    return key.join("/") + ".json"
  }

  export async function read<T>(key: string[]) {
    const result = await adapter().read(resolve(key))
    if (!result) return undefined
    return JSON.parse(result) as T
  }

  export function write<T>(key: string[], value: T) {
    return adapter().write(resolve(key), JSON.stringify(value))
  }

  export function remove(key: string[]) {
    return adapter().remove(resolve(key))
  }

  export async function list(prefix: string[]) {
    const p = prefix.join("/") + (prefix.length ? "/" : "")
    const result = await adapter().list(p)
    return result.map((x) => x.replace(/\.json$/, "").split("/"))
  }

  export async function update<T>(key: string[], fn: (draft: T) => void) {
    const val = await read<T>(key)
    if (!val) throw new Error("Not found")
    fn(val)
    await write(key, val)
    return val
  }
}
