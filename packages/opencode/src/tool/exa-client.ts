import { abortAfterAny } from "../util/abort"

const EXA_BASE_URL = "https://mcp.exa.ai"
const EXA_ENDPOINT = "/mcp"

interface ExaMcpRequest {
  jsonrpc: string
  id: number
  method: string
  params: {
    name: string
    arguments: Record<string, unknown>
  }
}

interface ExaMcpResponse {
  jsonrpc: string
  result: {
    content: Array<{ type: string; text: string }>
  }
}

export async function exaToolCall(opts: {
  toolName: string
  args: Record<string, unknown>
  timeoutMs: number
  abort: AbortSignal
}): Promise<string | null> {
  const request: ExaMcpRequest = {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: opts.toolName, arguments: opts.args },
  }

  const { signal, clearTimeout } = abortAfterAny(opts.timeoutMs, opts.abort)

  try {
    const response = await fetch(`${EXA_BASE_URL}${EXA_ENDPOINT}`, {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
      },
      body: JSON.stringify(request),
      signal,
    })
    clearTimeout()

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Exa API error (${response.status}): ${errorText}`)
    }

    const responseText = await response.text()
    for (const line of responseText.split("\n")) {
      if (line.startsWith("data: ")) {
        const data: ExaMcpResponse = JSON.parse(line.substring(6))
        if (data.result?.content?.length > 0) {
          return data.result.content[0].text
        }
      }
    }
    return null
  } catch (error) {
    clearTimeout()
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Request timed out")
    }
    throw error
  }
}
