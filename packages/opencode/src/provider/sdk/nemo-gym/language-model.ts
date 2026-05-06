/**
 * NeMo-Gym LanguageModelV3 implementation.
 *
 * The opencode `processor.ts` agentic loop is unmodified — this is the only
 * piece that swaps. Internally we POST to NeMo Gym's `/v1/chat/completions`
 * non-streaming, capture token IDs (`prompt_token_ids` / `generation_token_ids`
 * / `generation_log_probs`) from the response, and emit a single-shot synthetic
 * stream so opencode's streaming handler is happy.
 *
 * Why non-streaming? RL training requires contiguous, exact token IDs across
 * turns. Streaming has them drip in across SSE chunks; non-streaming returns
 * them in the final response cleanly. The opencode loop doesn't notice — it
 * receives all stream parts at once.
 *
 * Trajectory dump: every doStream call writes
 * `<completionsDir>/<instanceId>/<turn>.json` BEFORE the stream finishes,
 * so a tool crash later cannot lose this turn's token IDs. The shape matches
 * openhands' `llm_completions/<id>/*.json` exactly so gym's
 * `get_openhands_trajectory_from_completions` reads it without changes.
 */

import {
  type LanguageModelV3,
  type LanguageModelV3CallOptions,
  type LanguageModelV3StreamPart,
  type LanguageModelV3Content,
  type SharedV3ProviderMetadata,
  type SharedV3Warning,
} from "@ai-sdk/provider"
import { promises as fs } from "node:fs"
import path from "node:path"
import { convertToOpenAICompatibleChatMessages } from "../copilot/chat/convert-to-openai-compatible-chat-messages"
import { prepareTools } from "../copilot/chat/openai-compatible-prepare-tools"

// ---------------------------------------------------------------------------
// Wire types
// ---------------------------------------------------------------------------

interface ChatRequestMessage {
  role: "system" | "user" | "assistant" | "tool"
  content?: string | Array<unknown> | null
  tool_calls?: Array<{
    id: string
    type: "function"
    function: { name: string; arguments: string }
  }>
  tool_call_id?: string
  name?: string
  prompt_token_ids?: number[]
  generation_token_ids?: number[]
  generation_log_probs?: number[]
  [key: string]: unknown
}

interface ChatResponseChoice {
  index?: number
  finish_reason?: string | null
  message: {
    role: string
    content?: string | null
    reasoning_text?: string | null
    tool_calls?: Array<{
      id?: string
      type?: string
      function: { name: string; arguments: string }
    }>
    prompt_token_ids?: number[]
    generation_token_ids?: number[]
    generation_log_probs?: number[]
    [key: string]: unknown
  }
}

interface ChatResponseUsage {
  prompt_tokens?: number | null
  completion_tokens?: number | null
  total_tokens?: number | null
}

interface ChatResponse {
  id?: string
  model?: string
  created?: number
  choices: ChatResponseChoice[]
  usage?: ChatResponseUsage
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const TOKEN_ID_FIELDS = ["prompt_token_ids", "generation_token_ids", "generation_log_probs"] as const

export interface NemoGymLanguageModelConfig {
  /** Provider id used to namespace providerMetadata. Defaults to "nemo-gym". */
  provider: string
  /** Full base URL of the model server (e.g. `http://gym-host:18086`). */
  baseURL: string
  /** Optional gym head-server-style model server name; informational only. */
  modelServerName?: string
  /** Custom request headers (auth, etc). */
  headers?: () => Record<string, string | undefined>
  /** Per-call HTTP timeout in ms. */
  requestTimeoutMs?: number
  /** Number of HTTP retry attempts on transient errors. */
  retries?: number
  /**
   * Where per-call llm_completions JSONs land. The bench harness builds this
   * path; it must match what gym's host-side glob expects. If unset, no
   * trajectory dump happens (useful for dev/test).
   */
  completionsDir?: string
  /** instance_id for the dump file naming + path. Required when completionsDir set. */
  instanceId?: string
  /** Optional sink that the bench harness uses to count turns globally. */
  turnCounter?: { next(): number }
  /** Optional callback fired after each successful chat completion. */
  onCompletion?: (info: {
    turn: number
    messages: ChatRequestMessage[]
    response: ChatResponse
    providerSpecificFields: Record<string, unknown>
    requestParams: Record<string, unknown>
  }) => void | Promise<void>
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export class NemoGymLanguageModel implements LanguageModelV3 {
  readonly specificationVersion = "v3"
  readonly modelId: string
  readonly provider: string

  private readonly cfg: NemoGymLanguageModelConfig
  private cookies: Record<string, string> = {}

  constructor(modelId: string, cfg: NemoGymLanguageModelConfig) {
    this.modelId = modelId
    this.provider = cfg.provider
    this.cfg = {
      requestTimeoutMs: 600_000,
      retries: 3,
      ...cfg,
    }
  }

  get supportedUrls() {
    return {} as Record<string, RegExp[]>
  }

  // The streamText path in `session/llm.ts` only calls doStream. We still
  // implement doGenerate for completeness / future direct-use.
  async doGenerate(options: LanguageModelV3CallOptions) {
    const { warnings, messages, requestParams } = await this._buildRequestParams(options)
    const { responseJson } = await this._postChat(requestParams)

    const choice = responseJson.choices[0]
    if (!choice) throw new Error("nemo-gym: empty choices in response")
    const msg: ChatResponseChoice["message"] = choice.message ?? ({ role: "assistant" } as ChatResponseChoice["message"])

    const content: LanguageModelV3Content[] = []
    if (msg.content) content.push({ type: "text", text: msg.content })
    if (msg.reasoning_text) content.push({ type: "reasoning", text: msg.reasoning_text })
    if (msg.tool_calls) {
      for (const tc of msg.tool_calls) {
        content.push({
          type: "tool-call",
          toolCallId: tc.id ?? `call_${Math.random().toString(36).slice(2, 10)}`,
          toolName: tc.function.name,
          input: tc.function.arguments,
        })
      }
    }

    const providerSpecificFields = this._extractProviderFields(msg)
    const providerMetadata = this._buildProviderMetadata(providerSpecificFields)

    await this._dumpAndNotify({
      messages,
      response: responseJson,
      providerSpecificFields,
      requestParams,
    })

    return {
      content,
      finishReason: this._mapFinishReason(choice.finish_reason ?? null),
      usage: this._mapUsage(responseJson.usage),
      providerMetadata,
      request: { body: JSON.stringify(requestParams) },
      response: { body: responseJson },
      warnings,
    }
  }

  async doStream(options: LanguageModelV3CallOptions) {
    const { warnings, messages, requestParams } = await this._buildRequestParams(options)

    // Fire the HTTP call eagerly so any error surfaces synchronously when the
    // stream is consumed. We then synthesize parts in `start`.
    const self = this

    const stream = new ReadableStream<LanguageModelV3StreamPart>({
      async start(controller) {
        controller.enqueue({ type: "stream-start", warnings })

        try {
          const { responseJson } = await self._postChat(requestParams)

          const choice = responseJson.choices[0]
          if (!choice) throw new Error("nemo-gym: empty choices in response")
          const msg: ChatResponseChoice["message"] =
            choice.message ?? ({ role: "assistant" } as ChatResponseChoice["message"])

          const providerSpecificFields = self._extractProviderFields(msg)
          const providerMetadata = self._buildProviderMetadata(providerSpecificFields)

          // Emit response-metadata first.
          controller.enqueue({
            type: "response-metadata",
            id: responseJson.id,
            modelId: responseJson.model,
            timestamp: responseJson.created ? new Date(responseJson.created * 1000) : undefined,
          })

          // Reasoning content.
          if (msg.reasoning_text) {
            controller.enqueue({ type: "reasoning-start", id: "reasoning-0" })
            controller.enqueue({ type: "reasoning-delta", id: "reasoning-0", delta: msg.reasoning_text })
            controller.enqueue({ type: "reasoning-end", id: "reasoning-0" })
          }

          // Text content.
          if (msg.content) {
            controller.enqueue({ type: "text-start", id: "txt-0" })
            controller.enqueue({ type: "text-delta", id: "txt-0", delta: msg.content })
            controller.enqueue({ type: "text-end", id: "txt-0" })
          }

          // Tool calls.
          if (msg.tool_calls) {
            for (const tc of msg.tool_calls) {
              const tcId = tc.id ?? `call_${Math.random().toString(36).slice(2, 10)}`
              controller.enqueue({
                type: "tool-input-start",
                id: tcId,
                toolName: tc.function.name,
              })
              controller.enqueue({
                type: "tool-input-delta",
                id: tcId,
                delta: tc.function.arguments,
              })
              controller.enqueue({ type: "tool-input-end", id: tcId })
              controller.enqueue({
                type: "tool-call",
                toolCallId: tcId,
                toolName: tc.function.name,
                input: tc.function.arguments,
              })
            }
          }

          // Persist trajectory BEFORE finishing so a downstream tool crash
          // cannot lose this turn's token IDs.
          await self._dumpAndNotify({
            messages,
            response: responseJson,
            providerSpecificFields,
            requestParams,
          })

          controller.enqueue({
            type: "finish",
            finishReason: self._mapFinishReason(choice.finish_reason ?? null),
            usage: self._mapUsage(responseJson.usage),
            providerMetadata,
          })

          controller.close()
        } catch (err) {
          controller.enqueue({ type: "error", error: err instanceof Error ? err.message : String(err) })
          controller.enqueue({
            type: "finish",
            finishReason: { unified: "error", raw: undefined },
            usage: self._mapUsage(undefined),
            providerMetadata: {},
          })
          controller.close()
        }
      },
    })

    return {
      stream,
      request: { body: JSON.stringify(requestParams) },
      response: {},
    }
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  private async _buildRequestParams(options: LanguageModelV3CallOptions): Promise<{
    warnings: SharedV3Warning[]
    messages: ChatRequestMessage[]
    tools: unknown
    toolChoice: unknown
    requestParams: Record<string, unknown>
  }> {
    const warnings: SharedV3Warning[] = []
    // Reuse opencode's existing OpenAI-compatible message converter so all
    // tool-call / multi-content shapes map identically to the rest of opencode.
    const messages = convertToOpenAICompatibleChatMessages(options.prompt) as unknown as ChatRequestMessage[]

    const { tools, toolChoice, toolWarnings } = prepareTools({
      tools: options.tools,
      toolChoice: options.toolChoice,
    })
    warnings.push(...toolWarnings)

    // Strip token-ID fields from all assistant messages EXCEPT the most recent.
    // Mirrors nemo_gym_client.py:85-97. Wire-payload dedup; the most recent
    // message keeps its IDs so the server can verify continuity.
    {
      let lastSeen = false
      for (let i = messages.length - 1; i >= 0; i--) {
        const m = messages[i] as Record<string, unknown>
        const hasAll = TOKEN_ID_FIELDS.every((f) => f in m)
        if (lastSeen) {
          for (const f of TOKEN_ID_FIELDS) delete m[f]
        } else if (hasAll) {
          lastSeen = true
        }
      }
    }

    const requestParams: Record<string, unknown> = {
      model: this.modelId,
      messages,
      max_tokens: options.maxOutputTokens,
      temperature: options.temperature,
      top_p: options.topP,
      stop: options.stopSequences,
      seed: options.seed,
    }
    if (tools && (tools as unknown[]).length) requestParams.tools = tools
    if (toolChoice) requestParams.tool_choice = toolChoice

    // Strip undefineds — vllm errors on null/undefined keys.
    for (const k of Object.keys(requestParams)) {
      if (requestParams[k] === undefined) delete requestParams[k]
    }

    return { warnings, messages, tools, toolChoice, requestParams }
  }

  private async _postChat(params: Record<string, unknown>): Promise<{ responseJson: ChatResponse }> {
    const url = this._urlFor("/v1/chat/completions")
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
    }
    const cfgHeaders = this.cfg.headers?.()
    if (cfgHeaders) {
      for (const [k, v] of Object.entries(cfgHeaders)) if (v != null) headers[k] = v
    }
    if (Object.keys(this.cookies).length) {
      headers.Cookie = Object.entries(this.cookies)
        .map(([k, v]) => `${k}=${v}`)
        .join("; ")
    }

    const retries = this.cfg.retries ?? 3
    let lastErr: unknown = null
    for (let attempt = 0; attempt < retries; attempt++) {
      const ac = new AbortController()
      const timer = setTimeout(() => ac.abort(), this.cfg.requestTimeoutMs)
      try {
        const res = await fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify(params),
          signal: ac.signal,
        })
        clearTimeout(timer)
        if (!res.ok) {
          const text = await res.text().catch(() => "")
          throw new Error(`NeMoGym ${url} ${res.status}: ${text.slice(0, 500)}`)
        }
        const setCookie = res.headers.get("set-cookie")
        if (setCookie) {
          for (const part of setCookie.split(/,(?=[^;]+=)/)) {
            const [kv] = part.split(";")
            const [k, v] = kv.split("=")
            if (k && v) this.cookies[k.trim()] = v.trim()
          }
        }
        const responseJson = (await res.json()) as ChatResponse
        return { responseJson }
      } catch (err) {
        clearTimeout(timer)
        lastErr = err
        if (attempt === retries - 1) break
        await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt))
      }
    }
    throw new Error(`NeMoGym chat completions failed after ${retries} attempts: ${String(lastErr)}`)
  }

  private _urlFor(p: string): string {
    const base = this.cfg.baseURL.endsWith("/") ? this.cfg.baseURL : `${this.cfg.baseURL}/`
    return new URL(p.replace(/^\//, ""), base).toString()
  }

  private _extractProviderFields(msg: ChatResponseChoice["message"]): Record<string, unknown> {
    const out: Record<string, unknown> = {}
    if (Array.isArray(msg.prompt_token_ids)) {
      for (const f of TOKEN_ID_FIELDS) {
        const v = (msg as Record<string, unknown>)[f]
        if (v !== undefined) out[f] = v
      }
    }
    return out
  }

  private _buildProviderMetadata(providerSpecific: Record<string, unknown>): SharedV3ProviderMetadata {
    const md: SharedV3ProviderMetadata = { [this.provider]: {} }
    for (const [k, v] of Object.entries(providerSpecific)) {
      ;(md[this.provider] as Record<string, unknown>)[k] = v as never
    }
    return md
  }

  private _mapFinishReason(raw: string | null): { unified: "stop" | "length" | "tool-calls" | "error" | "other"; raw: string | undefined } {
    if (!raw) return { unified: "other", raw: undefined }
    switch (raw) {
      case "stop":
        return { unified: "stop", raw }
      case "length":
        return { unified: "length", raw }
      case "tool_calls":
      case "function_call":
        return { unified: "tool-calls", raw }
      default:
        return { unified: "other", raw }
    }
  }

  private _mapUsage(raw?: ChatResponseUsage) {
    return {
      inputTokens: {
        total: raw?.prompt_tokens ?? undefined,
        noCache: raw?.prompt_tokens ?? undefined,
        cacheRead: undefined,
        cacheWrite: undefined,
      },
      outputTokens: {
        total: raw?.completion_tokens ?? undefined,
        text: raw?.completion_tokens ?? undefined,
        reasoning: undefined,
      },
    }
  }

  private async _dumpAndNotify(args: {
    messages: ChatRequestMessage[]
    response: ChatResponse
    providerSpecificFields: Record<string, unknown>
    requestParams: Record<string, unknown>
  }) {
    const turn = this.cfg.turnCounter ? this.cfg.turnCounter.next() : Date.now()
    if (this.cfg.onCompletion) {
      try {
        await this.cfg.onCompletion({ turn, ...args })
      } catch (err) {
        console.warn(`[nemo-gym] onCompletion hook threw: ${String(err)}`)
      }
    }

    if (!this.cfg.completionsDir || !this.cfg.instanceId) return

    try {
      await fs.mkdir(this.cfg.completionsDir, { recursive: true })
      const turnStr = String(turn).padStart(4, "0")
      const safeModel = this.modelId.replace(/\//g, "__")
      const fname = `${safeModel}-${turnStr}-${Date.now()}.json`
      const fpath = path.join(this.cfg.completionsDir, fname)
      const kwargs: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(args.requestParams)) {
        if (k !== "messages") kwargs[k] = v
      }
      const payload = {
        messages: args.messages,
        response: args.response,
        provider_specific_fields: args.providerSpecificFields,
        kwargs,
        timestamp: Date.now() / 1000,
      }
      const tmp = `${fpath}.tmp`
      await fs.writeFile(tmp, JSON.stringify(payload))
      await fs.rename(tmp, fpath)
    } catch (err) {
      console.warn(`[nemo-gym] failed to dump completion: ${String(err)}`)
    }
  }
}
