import { AwsClient } from "aws4fetch"
import { lazy } from "@opencode-ai/util/lazy"

export namespace Storage {
  export interface Adapter {
    read(path: string): Promise<string | undefined>
    write(path: string, value: string): Promise<void>
    remove(path: string): Promise<void>
    list(options?: { prefix?: string; limit?: number; after?: string; before?: string }): Promise<string[]>
  }

  function createAdapter(client: AwsClient, endpoint: string, bucket: string): Adapter {
    const base = `${endpoint}/${bucket}`
    return {
      async read(path: string): Promise<string | undefined> {
        const response = await client.fetch(`${base}/${path}`)
        if (response.status === 404) return undefined
        if (!response.ok) throw new Error(`Failed to read ${path}: ${response.status}`)
        return response.text()
      },

      async write(path: string, value: string): Promise<void> {
        const response = await client.fetch(`${base}/${path}`, {
          method: "PUT",
          body: value,
          headers: {
            "Content-Type": "application/json",
          },
        })
        if (!response.ok) throw new Error(`Failed to write ${path}: ${response.status}`)
      },

      async remove(path: string): Promise<void> {
        const response = await client.fetch(`${base}/${path}`, {
          method: "DELETE",
        })
        if (!response.ok) throw new Error(`Failed to remove ${path}: ${response.status}`)
      },

      async list(options?: { prefix?: string; limit?: number; after?: string; before?: string }): Promise<string[]> {
        const prefix = options?.prefix || ""
        const params = new URLSearchParams({ "list-type": "2", prefix })
        if (options?.limit) params.set("max-keys", options.limit.toString())
        if (options?.after) {
          const afterPath = prefix + options.after + ".json"
          params.set("start-after", afterPath)
        }
        const response = await client.fetch(`${base}?${params}`)
        if (!response.ok) throw new Error(`Failed to list ${prefix}: ${response.status}`)
        const xml = await response.text()
        const keys: string[] = []
        const regex = /<Key>([^<]+)<\/Key>/g
        let match
        while ((match = regex.exec(xml)) !== null) {
          keys.push(match[1])
        }
        if (options?.before) {
          const beforePath = prefix + options.before + ".json"
          return keys.filter((key) => key < beforePath)
        }
        return keys
      },
    }
  }

  function s3(): Adapter {
    const bucket = process.env.OPENCODE_STORAGE_BUCKET!
    const region = process.env.OPENCODE_STORAGE_REGION || "us-east-1"
    const client = new AwsClient({
      region,
      accessKeyId: process.env.OPENCODE_STORAGE_ACCESS_KEY_ID!,
      secretAccessKey: process.env.OPENCODE_STORAGE_SECRET_ACCESS_KEY!,
    })
    return createAdapter(client, `https://s3.${region}.amazonaws.com`, bucket)
  }

  function r2() {
    const accountId = process.env.OPENCODE_STORAGE_ACCOUNT_ID!
    const client = new AwsClient({
      accessKeyId: process.env.OPENCODE_STORAGE_ACCESS_KEY_ID!,
      secretAccessKey: process.env.OPENCODE_STORAGE_SECRET_ACCESS_KEY!,
    })
    return createAdapter(client, `https://${accountId}.r2.cloudflarestorage.com`, process.env.OPENCODE_STORAGE_BUCKET!)
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

  export async function list(options?: { prefix?: string[]; limit?: number; after?: string; before?: string }) {
    const p = options?.prefix ? options.prefix.join("/") + (options.prefix.length ? "/" : "") : ""
    const result = await adapter().list({
      prefix: p,
      limit: options?.limit,
      after: options?.after,
      before: options?.before,
    })
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
