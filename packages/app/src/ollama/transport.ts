import {
  ollamaURL,
  ollamaTagKey,
  ollamaUserModels,
  validOllamaTag,
  type OllamaConnection,
  type OllamaDetails,
  type OllamaModel,
  type OllamaMutation,
  type OllamaProgress,
  type OllamaResult,
} from "./types"

const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {}

async function request(
  connection: OllamaConnection,
  route: string,
  body: unknown,
  signal: AbortSignal,
  fetcher = fetch,
) {
  return fetcher(`${ollamaURL(connection.baseURL)}/api/${route}`, {
    method: body === undefined ? "GET" : route === "delete" ? "DELETE" : "POST",
    headers: { ...connection.headers, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "error",
    signal,
  })
}

const failure = (response: Response): OllamaResult<never> => ({
  ok: false,
  error: [401, 403].includes(response.status) ? "authentication" : "response",
})

export async function listOllama(
  connection: OllamaConnection,
  signal: AbortSignal,
  fetcher = fetch,
): Promise<OllamaResult<OllamaModel[]>> {
  try {
    const response = await request(connection, "tags", undefined, signal, fetcher)
    if (!response.ok) return failure(response)
    const data = record(await response.json())
    if (!Array.isArray(data.models)) return { ok: false, error: "response" }
    const models = data.models.flatMap((item: unknown) => {
      const model = record(item)
      const details = record(model.details)
      if (typeof model.name !== "string" || !validOllamaTag(model.name)) return []
      return [
        {
          name: model.name,
          size: typeof model.size === "number" ? model.size : 0,
          digest: typeof model.digest === "string" ? model.digest : "",
          family: typeof details.family === "string" ? details.family : "",
          quantization: typeof details.quantization_level === "string" ? details.quantization_level : "",
        },
      ]
    })
    return { ok: true, value: ollamaUserModels(models) }
  } catch {
    return { ok: false, error: signal.aborted ? "cancelled" : "network" }
  }
}

export async function showOllama(
  connection: OllamaConnection,
  model: string,
  signal: AbortSignal,
  fetcher = fetch,
): Promise<OllamaResult<OllamaDetails>> {
  if (!validOllamaTag(model)) return { ok: false, error: "configuration" }
  try {
    const response = await request(connection, "show", { model }, signal, fetcher)
    if (!response.ok) return failure(response)
    const data = record(await response.json())
    if (!data.model_info || !data.details) return { ok: false, error: "response" }
    const info = record(data.model_info)
    const details = record(data.details)
    const maxContext = Object.entries(info).find(
      ([key, value]) => key.endsWith(".context_length") && typeof value === "number",
    )?.[1]
    const context =
      typeof data.parameters === "string" ? Number(data.parameters.match(/(?:^|\n)\s*num_ctx\s+(\d+)/)?.[1]) : NaN
    return {
      ok: true,
      value: {
        context: Number.isSafeInteger(context) && context > 0 ? context : undefined,
        maxContext: typeof maxContext === "number" && maxContext > 0 ? maxContext : undefined,
        capabilities: Array.isArray(data.capabilities)
          ? data.capabilities.filter((value): value is string => typeof value === "string")
          : [],
        family: typeof details.family === "string" ? details.family : "",
        quantization: typeof details.quantization_level === "string" ? details.quantization_level : "",
      },
    }
  } catch {
    return { ok: false, error: signal.aborted ? "cancelled" : "network" }
  }
}

export async function mutateOllama(input: {
  connection: OllamaConnection
  mutation: OllamaMutation
  id: string
  signal: AbortSignal
  progress(value: OllamaProgress): void
  fetch?: typeof fetch
}): Promise<OllamaResult<void>> {
  const mutation = input.mutation
  if (
    !validOllamaTag(mutation.model) ||
    ((mutation.action === "copy" || mutation.action === "create") && !validOllamaTag(mutation.source))
  )
    return { ok: false, error: "configuration" }
  if (
    (mutation.action === "create" || mutation.action === "context") &&
    (!Number.isSafeInteger(mutation.context) || mutation.context < 512 || mutation.context > 1048576)
  )
    return { ok: false, error: "context" }
  try {
    // Recheck installed tags at mutation time, rather than relying on a stale UI list.
    if (mutation.action === "copy" || mutation.action === "create" || mutation.action === "context") {
      const installed = await listOllama(input.connection, input.signal, input.fetch)
      if (!installed.ok) return installed
      if (
        mutation.action !== "context" &&
        installed.value.some((model) => ollamaTagKey(model.name) === ollamaTagKey(mutation.model))
      )
        return { ok: false, error: "exists" }
      if (
        !installed.value.some(
          (model) =>
            ollamaTagKey(model.name) === ollamaTagKey(mutation.action === "context" ? mutation.model : mutation.source),
        )
      )
        return { ok: false, error: "configuration" }
    }
    const body =
      mutation.action === "copy"
        ? { source: mutation.source, destination: mutation.model }
        : mutation.action === "context"
          ? { from: mutation.model, model: mutation.model, parameters: { num_ctx: mutation.context }, stream: true }
          : mutation.action === "create"
            ? { from: mutation.source, model: mutation.model, parameters: { num_ctx: mutation.context }, stream: true }
            : { model: mutation.model, stream: true }
    const response = await request(
      input.connection,
      mutation.action === "context" ? "create" : mutation.action,
      body,
      input.signal,
      input.fetch,
    )
    if (!response.ok) return failure(response)
    if (mutation.action === "copy" || mutation.action === "delete") return { ok: true, value: undefined }
    if (!response.body) return { ok: false, error: "response" }
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ""
    let success = false
    let last = 0
    const process = (line: string) => {
      if (!line.trim()) return
      const data = record(JSON.parse(line))
      if (data.error) throw new Error("response")
      if (data.status === "success") success = true
      const now = Date.now()
      if (now - last < 150 && !success) return
      last = now
      input.progress({
        id: input.id,
        completed: typeof data.completed === "number" ? data.completed : 0,
        total: typeof data.total === "number" ? data.total : 0,
        stage: data.total ? "download" : "prepare",
      })
    }
    try {
      while (true) {
        const chunk = await reader.read()
        buffer += decoder.decode(chunk.value, { stream: !chunk.done })
        const lines = buffer.split("\n")
        buffer = lines.pop() ?? ""
        lines.forEach(process)
        if (buffer.length > 1048576) throw new Error("response")
        if (chunk.done) break
      }
      process(buffer)
      return success ? { ok: true, value: undefined } : { ok: false, error: "response" }
    } finally {
      await reader.cancel().catch(() => undefined)
    }
  } catch (error) {
    return {
      ok: false,
      error: input.signal.aborted
        ? "cancelled"
        : error instanceof SyntaxError || (error instanceof Error && error.message === "response")
          ? "response"
          : "network",
    }
  }
}
