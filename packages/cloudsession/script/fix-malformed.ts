/**
 * Fix malformed session blobs in R2.
 *
 * Lists all share/ keys, validates each blob, and repairs malformed entries
 * by adding a minimal session object derived from metadata.
 *
 * Prerequisites:
 *   export CLOUDFLARE_ACCOUNT_ID=<your-account-id>
 *   export R2_ACCESS_KEY_ID=<your-r2-access-key>
 *   export R2_SECRET_ACCESS_KEY=<your-r2-secret-key>
 *
 * Usage:
 *   bun run script/fix-malformed.ts --dry-run     # only report
 *   bun run script/fix-malformed.ts               # apply fixes
 */

import { S3Client, ListObjectsV2Command, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3"

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
    slug?: string
    projectID?: string
    directory?: string
    title?: string
    version?: string
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

async function put(key: string, data: unknown): Promise<void> {
  if (DRY_RUN) {
    console.log(`  [dry-run] PUT ${key}`)
    return
  }
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: JSON.stringify(data),
      ContentType: "application/json",
    }),
  )
  console.log(`  UPDATED ${key}`)
}

function isMalformed(session: AgentSession): boolean {
  if (!session.session) return true
  const sessionObj = session.session
  const keys = Object.keys(sessionObj)
  if (keys.length === 0) return true
  if (!sessionObj.id && !sessionObj.time) return true
  if (!session.metadata) return true
  return false
}

function repairSession(session: AgentSession, shareID: string): AgentSession {
  const meta = session.metadata!
  const sessionID = meta.sessionID || `ses_${shareID}`
  const createdAt = meta.createdAt || Date.now()
  const lastUpdated = meta.lastUpdated || createdAt

  // Build a proper session object
  const fixedSession = {
    ...session,
    session: {
      id: sessionID,
      slug: sessionID,
      projectID: "",
      directory: "",
      title: "",
      version: "1",
      time: {
        created: createdAt,
        updated: lastUpdated,
      },
      ...session.session, // preserve any existing fields
    },
    messages: session.messages || [],
    parts: session.parts || [],
    diffs: session.diffs || [],
    models: session.models || [],
    metadata: {
      ...meta,
      sessionID,
      createdAt,
      lastUpdated,
      syncCount: meta.syncCount || 0,
      secret: meta.secret || "",
    },
  }

  return fixedSession
}

async function main() {
  console.log("Listing share/ keys from R2...")
  const shareKeys = await listKeys("share/")
  console.log(`Found ${shareKeys.length} sessions`)

  const malformed: { key: string; id: string }[] = []

  for (const key of shareKeys) {
    const id = key.replace("share/", "")
    if (!id) continue

    const raw = await read(key)
    if (!raw) continue

    let session: AgentSession
    try {
      session = JSON.parse(raw) as AgentSession
    } catch {
      continue
    }

    if (isMalformed(session)) {
      malformed.push({ key, id })
    }
  }

  console.log(`\nMalformed sessions: ${malformed.length}`)
  for (const { key, id } of malformed) {
    console.log(`  ${key} (${id})`)
  }

  if (malformed.length === 0) {
    console.log("No malformed sessions found.")
    return
  }

  if (DRY_RUN) {
    console.log("\nDry run complete. Run without --dry-run to apply fixes.")
    return
  }

  console.log("\nFixing malformed sessions...")
  let fixed = 0
  for (const { key, id } of malformed) {
    const raw = await read(key)
    if (!raw) continue
    const session = JSON.parse(raw) as AgentSession
    const repaired = repairSession(session, id)

    // Update share blob
    await put(key, repaired)

    // Update index entry
    const indexEntry = {
      id,
      sessionID: repaired.metadata!.sessionID,
      title: repaired.session!.title || "",
      directory: repaired.session!.directory || "",
      messageCount: repaired.messages!.length,
      partCount: repaired.parts!.length,
      diffCount: repaired.diffs!.length,
      modelCount: repaired.models!.length,
      lastUpdated: repaired.metadata!.lastUpdated,
      syncCount: repaired.metadata!.syncCount,
      createdAt: repaired.metadata!.createdAt,
    }
    await put(`index/${id}`, indexEntry)

    fixed++
    console.log(`  FIXED ${id}`)
  }
  console.log(`Fixed ${fixed} malformed sessions.`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
