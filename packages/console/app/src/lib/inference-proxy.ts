import { Resource } from "@opencode-ai/console-resource"
import { Database, eq } from "@opencode-ai/console-core/drizzle/index.js"
import { KeyTable } from "@opencode-ai/console-core/schema/key.sql.js"
import { WorkspaceTable } from "@opencode-ai/console-core/schema/workspace.sql.js"

const paths: Record<string, string | undefined> = {
  "GET /zen/v1/models": "/v1/models",
  "POST /zen/v1/chat/completions": "/openai/v1/chat/completions",
  "POST /zen/v1/responses": "/openai/v1/responses",
  "POST /zen/v1/messages": "/anthropic/v1/messages",
}

export async function proxyInference(request: Request, clientIP?: string): Promise<Response | undefined> {
  const url = new URL(request.url)
  const path =
    paths[`${request.method} ${url.pathname}`] ??
    (request.method === "POST" &&
    /^\/zen\/v1\/models\/[^/]+:(?:generateContent|streamGenerateContent)$/.test(url.pathname)
      ? url.pathname.replace("/zen/v1/models/", "/google/v1beta/models/")
      : undefined)
  if (!path) return undefined

  const key = path.startsWith("/anthropic/")
    ? request.headers.get("x-api-key")
    : path.startsWith("/google/")
      ? request.headers.get("x-goog-api-key")
      : request.headers.get("authorization")?.split(" ")[1]
  if (!key || key === "public") return undefined

  // Routing only; the destination owns authentication and revocation after cutover.
  const workspace = await Database.use((tx) =>
    tx
      .select({ migratedAt: WorkspaceTable.migrated_at })
      .from(KeyTable)
      .innerJoin(WorkspaceTable, eq(WorkspaceTable.id, KeyTable.workspaceID))
      .where(eq(KeyTable.key, key))
      .limit(1)
      .then((rows) => rows[0]),
  )
  if (!workspace?.migratedAt) return undefined

  const destination = new URL(Resource.ConsoleMigration.inferenceUrl)
  destination.pathname = `${destination.pathname.replace(/\/$/, "")}${path}`
  destination.search = url.search
  destination.hash = ""

  const forwarded = new Request(destination, request)
  forwarded.headers.set("authorization", `Bearer ${key}`)
  const ip = request.headers.get("cf-connecting-ip") ?? clientIP
  if (ip) forwarded.headers.set("x-real-ip", ip)
  const requestID = request.headers.get("x-opencode-request-id") ?? request.headers.get("x-opencode-request")
  if (requestID) forwarded.headers.set("x-opencode-request-id", requestID)

  return fetch(forwarded, { redirect: "manual" })
}
