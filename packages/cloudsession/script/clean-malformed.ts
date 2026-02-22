/**
 * Clean malformed session blobs from R2.
 *
 * Lists all share/ keys, validates each blob, and optionally deletes malformed entries.
 *
 * Prerequisites:
 *   export CLOUDFLARE_ACCOUNT_ID=<your-account-id>
 *   export R2_ACCESS_KEY_ID=<your-r2-access-key>
 *   export R2_SECRET_ACCESS_KEY=<your-r2-secret-key>
 *
 * Usage:
 *   bun run script/clean-malformed.ts --dry-run     # only report
 *   bun run script/clean-malformed.ts               # delete malformed entries
 */

import { S3Client, ListObjectsV2Command, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3"

const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID
const ACCESS_KEY = process.env.R2_ACCESS_KEY_ID
const SECRET_KEY = process.env.R2_SECRET_ACCESS_KEY
const BUCKET = "opencode-sessions"
const DRY_RUN = process.argv.includes("--dry-run")

if (!ACCOUNT_ID || !ACCESS_KEY || !SECRET_KEY) {
  console.error("Missing env vars. Set CLOUDFLARE_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY")
  process.exit(1)
}

const s3 = new S3Client({
  region: "auto",
  endpoint: `https://${ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: ACCESS_KEY, secretAccessKey: SECRET_KEY },
})

type AgentSession = {
  session?: {
    id?: string
    title?: string
    directory?: string
    time?: { created: number; updated: number }
  }
  messages?: unknown[]
  parts?: unknown[]
  diffs?: unknown[]
  models?: unknown[]
  metadata?: {
    sessionID?: string
    createdAt?: number
    lastUpdated?: number
    syncCount?: number
    secret?: string
  }
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

async function deleteKey(key: string): Promise<void> {
  if (DRY_RUN) {
    console.log(`  [dry-run] DELETE ${key}`)
    return
  }
  await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }))
  console.log(`  DELETED ${key}`)
}

function isMalformed(session: AgentSession): boolean {
  // Missing session object entirely
  if (!session.session) return true
  
  // Empty session object (no properties)
  const sessionObj = session.session
  const keys = Object.keys(sessionObj)
  if (keys.length === 0) return true
  
  // Missing required fields that the UI expects
  if (!sessionObj.id && !sessionObj.time) return true
  
  // Missing metadata
  if (!session.metadata) return true
  
  return false
}

async function main() {
  console.log("Listing share/ keys from R2...")
  const shareKeys = await listKeys("share/")
  console.log(`Found ${shareKeys.length} sessions`)
  
  const malformed: { key: string; id: string; reason: string }[] = []
  
  for (const key of shareKeys) {
    const id = key.replace("share/", "")
    if (!id) continue
    
    const raw = await read(key)
    if (!raw) {
      malformed.push({ key, id, reason: "empty blob" })
      continue
    }
    
    let session: AgentSession
    try {
      session = JSON.parse(raw) as AgentSession
    } catch {
      malformed.push({ key, id, reason: "invalid JSON" })
      continue
    }
    
    if (isMalformed(session)) {
      malformed.push({ key, id, reason: "malformed session object" })
    }
  }
  
  console.log(`\nMalformed sessions: ${malformed.length}`)
  for (const { key, id, reason } of malformed) {
    console.log(`  ${key} (${id}) - ${reason}`)
  }
  
  if (malformed.length === 0) {
    console.log("No malformed sessions found.")
    return
  }
  
  if (DRY_RUN) {
    console.log("\nDry run complete. Run without --dry-run to delete.")
    return
  }
  
  console.log("\nDeleting malformed sessions and their index entries...")
  let deleted = 0
  for (const { key, id } of malformed) {
    await deleteKey(key)
    await deleteKey(`index/${id}`)
    deleted++
  }
  console.log(`Deleted ${deleted} malformed sessions.`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
