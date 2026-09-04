import type { APIEvent } from "@solidjs/start/server"
import { ZenData } from "@opencode-ai/console-core/model.js"
import { and, Database, eq, isNull } from "@opencode-ai/console-core/drizzle/index.js"
import { KeyTable } from "@opencode-ai/console-core/schema/key.sql.js"
import { WorkspaceTable } from "@opencode-ai/console-core/schema/workspace.sql.js"
import { ModelTable } from "@opencode-ai/console-core/schema/model.sql.js"
import { buildOptionsResponse, buildModelsResponse } from "~/routes/zen/util/modelsHandler"
import { Resource } from "@opencode-ai/console-resource"

export async function OPTIONS(_input: APIEvent) {
  return buildOptionsResponse()
}

export async function GET(input: APIEvent) {
  const apiKey = input.request.headers.get("authorization")?.split(" ")[1]
  if (apiKey && apiKey !== "public") {
    const response = await proxyModels(input, apiKey).catch(() =>
      Response.json(
        { error: { type: "api_error", message: "Inference routing is unavailable. Please retry later." } },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      ),
    )
    if (response) return response
  }

  const disabledModels = await (() => {
    if (!apiKey) return [] as string[]

    return Database.use((tx) =>
      tx
        .select({
          model: ModelTable.model,
        })
        .from(KeyTable)
        .innerJoin(WorkspaceTable, eq(WorkspaceTable.id, KeyTable.workspaceID))
        .innerJoin(ModelTable, and(eq(ModelTable.workspaceID, KeyTable.workspaceID), isNull(ModelTable.timeDeleted)))
        .where(and(eq(KeyTable.key, apiKey), isNull(KeyTable.timeDeleted)))
        .then((rows) => rows.map((row) => row.model)),
    )
  })()

  const models = Object.keys(ZenData.list("full").models)
    .filter((id) => !id.endsWith(":global"))
    .filter((id) => !disabledModels.includes(id))

  return buildModelsResponse(models)
}

async function proxyModels(input: APIEvent, apiKey: string) {
  // No legacy revocation or model-policy checks before destination authentication.
  const workspace = await Database.use((tx) =>
    tx
      .select({ migratedAt: WorkspaceTable.migrated_at })
      .from(KeyTable)
      .innerJoin(WorkspaceTable, eq(WorkspaceTable.id, KeyTable.workspaceID))
      .where(eq(KeyTable.key, apiKey))
      .limit(1)
      .then((rows) => rows[0]),
  )
  if (!workspace?.migratedAt) return undefined

  const destination = new URL(Resource.ConsoleMigration.inferenceUrl)
  destination.pathname = `${destination.pathname.replace(/\/$/, "")}/v1/models`
  destination.search = new URL(input.request.url).search
  destination.hash = ""
  const headers = new Headers({ authorization: `Bearer ${apiKey}` })
  const ip = input.request.headers.get("cf-connecting-ip")
  if (ip) headers.set("x-real-ip", ip)
  return fetch(destination, { headers, signal: input.request.signal, redirect: "manual" })
}
