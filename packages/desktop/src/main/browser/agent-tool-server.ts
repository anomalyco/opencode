import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"
import { randomUUID } from "node:crypto"
import { createIntegratedBrowserAgentTools, type IntegratedBrowserAgentTool } from "./agent-tools"

type Options = {
  tools?: IntegratedBrowserAgentTool[]
  token?: string
}

export type IntegratedBrowserAgentToolServer = {
  url: string
  token: string
  stop: () => Promise<void>
}

export async function startIntegratedBrowserAgentToolServer(options: Options = {}): Promise<IntegratedBrowserAgentToolServer> {
  const token = options.token ?? randomUUID()
  const tools = Object.fromEntries((options.tools ?? createIntegratedBrowserAgentTools()).map((tool) => [tool.name, tool]))
  const server = createServer(async (request, response) => {
    if (request.method !== "POST" || request.url !== "/tool") {
      send(response, 404, { ok: false, error: "Not found" })
      return
    }
    if (request.headers.authorization !== `Bearer ${token}`) {
      send(response, 401, { ok: false, error: "Unauthorized" })
      return
    }

    const body = await readJson(request)
    if (!body || typeof body.tool !== "string" || !body.input || typeof body.input !== "object" || Array.isArray(body.input)) {
      send(response, 400, { ok: false, error: "Invalid integrated browser tool request" })
      return
    }

    const tool = tools[body.tool]
    if (!tool) {
      send(response, 404, { ok: false, error: `Unknown integrated browser tool: ${body.tool}` })
      return
    }

    try {
      send(response, 200, { ok: true, result: await tool.handler(body.input as Record<string, unknown>) })
    } catch (error) {
      send(response, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
    }
  })
  await listen(server)
  const address = server.address()
  if (!address || typeof address !== "object") throw new Error("Integrated browser agent tool server did not bind to a TCP port")
  const url = `http://127.0.0.1:${address.port}`
  process.env.OPENCODE_INTEGRATED_BROWSER_TOOL_URL = url
  process.env.OPENCODE_INTEGRATED_BROWSER_TOOL_TOKEN = token
  return { url, token, stop: () => stop(server) }
}

function send(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { "content-type": "application/json" })
  response.end(JSON.stringify(body))
}

async function readJson(request: IncomingMessage) {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as { tool?: unknown; input?: unknown }
  } catch {
    return undefined
  }
}

function listen(server: Server) {
  return new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject)
      resolve()
    })
  })
}

function stop(server: Server) {
  return new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()))
  })
}
