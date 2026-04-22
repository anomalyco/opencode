import { abortAfterAny } from "@/util/abort"

type Req = {
  name: string
  args: Record<string, unknown>
  timeout: number
  abort: AbortSignal
}

type Res = {
  content: Array<{
    type: string
    text: string
  }>
}

function url() {
  if (!process.env.EXA_API_KEY) return "https://mcp.exa.ai/mcp"
  return `https://mcp.exa.ai/mcp?exaApiKey=${encodeURIComponent(process.env.EXA_API_KEY)}`
}

export async function callExa(input: Req) {
  const { signal, clearTimeout } = abortAfterAny(input.timeout, input.abort)

  try {
    const res = await fetch(url(), {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: input.name,
          arguments: input.args,
        },
      }),
      signal,
    })

    clearTimeout()

    if (!res.ok) {
      const txt = await res.text()
      throw new Error(`${input.name} error (${res.status}): ${txt}`)
    }

    return first(await res.text())
  } catch (err) {
    clearTimeout()
    if (err instanceof Error && err.name === "AbortError") throw new Error(`${input.name} request timed out`)
    throw err
  }
}

function first(input: string) {
  let bad = false
  for (const line of input.split("\n")) {
    if (!line.startsWith("data: ")) continue
    const raw = line.substring(6).trim()
    if (!raw) continue
    try {
      const data = JSON.parse(raw) as { result?: Res }
      const txt = data.result?.content.find((item) => item.type === "text")?.text
      if (txt) return txt
    } catch {
      bad = true
    }
  }

  if (bad) throw new Error("Invalid Exa MCP response")
  return undefined
}
