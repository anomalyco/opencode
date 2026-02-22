import type { APIEvent } from "@solidjs/start/server"
import { and, Database, eq, isNull } from "@opencode-ai/console-core/drizzle/index.js"
import { KeyTable } from "@opencode-ai/console-core/schema/key.sql.js"
import { WorkspaceTable } from "@opencode-ai/console-core/schema/workspace.sql.js"
import { ModelTable } from "@opencode-ai/console-core/schema/model.sql.js"
import { ZenData } from "@opencode-ai/console-core/model.js"

export async function OPTIONS(input: APIEvent) {
  return new Response(null, {
    status: 200,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  })
}

export async function GET(input: APIEvent) {
  const zenData = ZenData.list()
  const disabledModels = await authenticate()

  return new Response(
    JSON.stringify({
      object: "list",
      data: Object.entries(zenData.models)
        .filter(([id]) => !disabledModels.includes(id))
        .map(([id, _model]) => ({
          id,
          object: "model",
          created: Math.floor(Date.now() / 1000),
          owned_by: "opencode",
        })),
    }),
    {
      headers: {
        "Content-Type": "application/json",
      },
    },
  )

  async function authenticate() {
    const apiKey = input.request.headers.get("authorization")?.split(" ")[1]
    if (!apiKey) return []

    const disabledModels = await Database.use((tx) =>
      tx
        .select({
          model: ModelTable.model,
        })
        .from(KeyTable)
        .innerJoin(WorkspaceTable, eq(WorkspaceTable.id, KeyTable.workspaceID))
        .leftJoin(ModelTable, and(eq(ModelTable.workspaceID, KeyTable.workspaceID), isNull(ModelTable.timeDeleted)))
        .where(and(eq(KeyTable.key, apiKey), isNull(KeyTable.timeDeleted)))
        .then((rows) => rows.map((row) => row.model)),
    )

    return disabledModels
  }
}
