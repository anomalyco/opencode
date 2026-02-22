/**
 * One-time migration: backfill index/ entries from existing share/ blobs.
 *
 * Uses the R2 S3-compatible API directly — reads share/ blobs, writes index/ entries.
 *
 * Prerequisites:
 *   export CLOUDFLARE_ACCOUNT_ID=<your-account-id>
 *   export R2_ACCESS_KEY_ID=<your-r2-access-key>
 *   export R2_SECRET_ACCESS_KEY=<your-r2-secret-key>
 *
 * Usage:
 *   bun run script/backfill-index.ts
 */

import { S3Client, ListObjectsV2Command, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3"

const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID
const ACCESS_KEY = process.env.R2_ACCESS_KEY_ID
const SECRET_KEY = process.env.R2_SECRET_ACCESS_KEY
const BUCKET = "opencode-sessions"

if (!ACCOUNT_ID || !ACCESS_KEY || !SECRET_KEY) {
  console.error("Missing env vars. Set CLOUDFLARE_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY")
  process.exit(1)
}

const s3 = new S3Client({
  region: "auto",
  endpoint: `https://${ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: ACCESS_KEY, secretAccessKey: SECRET_KEY },
})

type SessionBlob = {
  session: { id: string; title: string; directory: string }
  messages: unknown[]
  parts: unknown[]
  diffs: unknown[]
  models: unknown[]
  metadata: { secret: string; sessionID: string; createdAt: number; lastUpdated: number; syncCount: number }
}

type SessionIndex = {
  id: string
  sessionID: string
  title: string
  directory: string
  messageCount: number
  partCount: number
  diffCount: number
  modelCount: number
  lastUpdated: number
  syncCount: number
  createdAt: number
}

async function listKeys(prefix: string): Promise<string[]> {
  const keys: string[] = []
  let token: string | undefined

  do {
    const res = await s3.send(
      new ListObjectsV2Command({
        Bucket: BUCKET,
        Prefix: prefix,
        ContinuationToken: token,
      }),
    )
    for (const obj of res.Contents || []) {
      if (obj.Key) keys.push(obj.Key)
    }
    token = res.IsTruncated ? res.NextContinuationToken : undefined
  } while (token)

  return keys
}

async function read(key: string): Promise<string | null> {
  const res = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }))
  return res.Body ? await res.Body.transformToString() : null
}

async function put(key: string, data: unknown): Promise<void> {
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: JSON.stringify(data),
      ContentType: "application/json",
    }),
  )
}

async function main() {
  console.log("Listing share/ keys from R2...")
  const shareKeys = await listKeys("share/")
  console.log(`Found ${shareKeys.length} sessions`)

  console.log("Listing existing index/ keys...")
  const indexKeys = new Set(await listKeys("index/"))
  console.log(`Found ${indexKeys.size} existing index entries`)

  let created = 0
  let skipped = 0
  let failed = 0

  for (const key of shareKeys) {
    const id = key.replace("share/", "")
    if (!id) continue

    if (indexKeys.has(`index/${id}`)) {
      skipped++
      continue
    }

    const raw = await read(key)
    if (!raw) {
      console.error(`  SKIP ${id}: empty blob`)
      failed++
      continue
    }

    const session = JSON.parse(raw) as SessionBlob

    const entry: SessionIndex = {
      id,
      sessionID: session.metadata.sessionID || session.session.id,
      title: session.session.title,
      directory: session.session.directory,
      messageCount: (session.messages || []).length,
      partCount: (session.parts || []).length,
      diffCount: (session.diffs || []).length,
      modelCount: (session.models || []).length,
      lastUpdated: session.metadata.lastUpdated,
      syncCount: session.metadata.syncCount,
      createdAt: session.metadata.createdAt,
    }

    await put(`index/${id}`, entry)
    created++
    console.log(`  OK ${id}: "${entry.title || "Untitled"}" (${entry.messageCount} msgs)`)
  }

  console.log(`\nDone. created=${created} skipped=${skipped} failed=${failed}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
