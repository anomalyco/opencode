import os from "os"
import { Installation } from "@/installation"
import { Provider } from "@/provider/provider"
import { Log } from "@/util/log"
import {
  streamText,
  wrapLanguageModel,
  type ModelMessage,
  type StreamTextResult,
  type Tool,
  type ToolSet,
  extractReasoningMiddleware,
  tool,
  jsonSchema,
} from "ai"
import { clone, mergeDeep, pipe } from "remeda"
import { ProviderTransform } from "@/provider/transform"
import { Config } from "@/config/config"
import { Instance } from "@/project/instance"
import type { Agent } from "@/agent/agent"
import type { MessageV2 } from "./message-v2"
import { Plugin } from "@/plugin"
import { SystemPrompt } from "./system"
import { Flag } from "@/flag/flag"
import { PermissionNext } from "@/permission/next"
import { Auth } from "@/auth"

export namespace LLM {
  const log = Log.create({ service: "llm" })

  /**
   * Common tool name aliases that local models (especially via Ollama) might use.
   * Maps various naming conventions to the canonical OpenCode tool names.
   */
  const TOOL_ALIASES: Record<string, string> = {
    // read tool aliases
    readfile: "read",
    read_file: "read",
    file_read: "read",
    getfile: "read",
    get_file: "read",
    openfile: "read",
    open_file: "read",
    viewfile: "read",
    view_file: "read",
    catfile: "read",
    cat_file: "read",
    cat: "read",

    // write tool aliases
    writefile: "write",
    write_file: "write",
    file_write: "write",
    createfile: "write",
    create_file: "write",
    savefile: "write",
    save_file: "write",

    // edit tool aliases
    editfile: "edit",
    edit_file: "edit",
    file_edit: "edit",
    modifyfile: "edit",
    modify_file: "edit",
    updatefile: "edit",
    update_file: "edit",
    patchfile: "edit",
    patch_file: "edit",
    patch: "edit",

    // bash/shell tool aliases
    shell: "bash",
    terminal: "bash",
    command: "bash",
    run: "bash",
    execute: "bash",
    exec: "bash",
    runcommand: "bash",
    run_command: "bash",
    shellcommand: "bash",
    shell_command: "bash",
    runshell: "bash",
    run_shell: "bash",

    // list/ls tool aliases
    ls: "glob",
    list: "glob",
    listdir: "glob",
    list_dir: "glob",
    listdirectory: "glob",
    list_directory: "glob",
    dir: "glob",
    directory: "glob",
    listfiles: "glob",
    list_files: "glob",
    find: "glob",
    findfiles: "glob",
    find_files: "glob",

    // grep/search tool aliases
    search: "grep",
    searchcode: "grep",
    search_code: "grep",
    searchfiles: "grep",
    search_files: "grep",
    findtext: "grep",
    find_text: "grep",
    searchtext: "grep",
    search_text: "grep",
    ripgrep: "grep",
    rg: "grep",

    // webfetch aliases
    fetch: "webfetch",
    geturl: "webfetch",
    get_url: "webfetch",
    getwebpage: "webfetch",
    get_webpage: "webfetch",
    fetchurl: "webfetch",
    fetch_url: "webfetch",
    http: "webfetch",
    httpget: "webfetch",
    http_get: "webfetch",
    curl: "webfetch",

    // websearch aliases
    web_search: "websearch",
    searchweb: "websearch",
    search_web: "websearch",
    googlesearch: "websearch",
    google_search: "websearch",
    internetsearch: "websearch",
    internet_search: "websearch",

    // todo aliases
    todo: "todowrite",
    todo_write: "todowrite",
    addtodo: "todowrite",
    add_todo: "todowrite",
    createtodo: "todowrite",
    create_todo: "todowrite",
    todo_read: "todoread",
    gettodo: "todoread",
    get_todo: "todoread",
    listtodo: "todoread",
    list_todo: "todoread",

    // task/agent aliases
    agent: "task",
    subagent: "task",
    sub_agent: "task",
    delegate: "task",
    spawn: "task",
    createtask: "task",
    create_task: "task",

    // codesearch aliases
    code_search: "codesearch",
    semanticsearch: "codesearch",
    semantic_search: "codesearch",

    // skill aliases
    useskill: "skill",
    use_skill: "skill",
    runSkill: "skill",
    run_skill: "skill",
  }

  /**
   * Attempts to repair a tool name that the model called incorrectly.
   * Handles case sensitivity, common aliases, and fuzzy matching.
   */
  function repairToolName(toolName: string, availableTools: string[]): string | undefined {
    // 1. Exact match (already correct)
    if (availableTools.includes(toolName)) {
      return toolName
    }

    // 2. Case-insensitive match
    const lower = toolName.toLowerCase()
    const caseMatch = availableTools.find((t) => t.toLowerCase() === lower)
    if (caseMatch) {
      return caseMatch
    }

    // 3. Check aliases (case-insensitive)
    const aliasLower = lower.replace(/[^a-z0-9]/g, "") // normalize: remove non-alphanumeric
    const aliasMatch = TOOL_ALIASES[aliasLower] || TOOL_ALIASES[lower]
    if (aliasMatch && availableTools.includes(aliasMatch)) {
      return aliasMatch
    }

    // 4. Try removing common prefixes/suffixes that models add
    const stripped = lower
      .replace(/^(repo_browser\.|file_system\.|fs\.|tool\.|tools\.)/, "") // remove common prefixes
      .replace(/_tool$/, "") // remove _tool suffix
    const strippedMatch = availableTools.find((t) => t.toLowerCase() === stripped)
    if (strippedMatch) {
      return strippedMatch
    }

    // 5. Check if stripped version is in aliases
    const strippedAliasMatch = TOOL_ALIASES[stripped]
    if (strippedAliasMatch && availableTools.includes(strippedAliasMatch)) {
      return strippedAliasMatch
    }

    // 6. Fuzzy match: find tool that starts with or contains the name
    const fuzzyMatch = availableTools.find(
      (t) => t.toLowerCase().startsWith(stripped) || stripped.startsWith(t.toLowerCase()),
    )
    if (fuzzyMatch) {
      return fuzzyMatch
    }

    // No match found
    return undefined
  }

  export const OUTPUT_TOKEN_MAX = Flag.OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX || 32_000

  export type StreamInput = {
    user: MessageV2.User
    sessionID: string
    model: Provider.Model
    agent: Agent.Info
    system: string[]
    abort: AbortSignal
    messages: ModelMessage[]
    small?: boolean
    tools: Record<string, Tool>
    retries?: number
  }

  export type StreamOutput = StreamTextResult<ToolSet, unknown>

  export async function stream(input: StreamInput) {
    const l = log
      .clone()
      .tag("providerID", input.model.providerID)
      .tag("modelID", input.model.id)
      .tag("sessionID", input.sessionID)
      .tag("small", (input.small ?? false).toString())
      .tag("agent", input.agent.name)
      .tag("mode", input.agent.mode)
    l.info("stream", {
      modelID: input.model.id,
      providerID: input.model.providerID,
    })
    const [language, cfg, provider, auth] = await Promise.all([
      Provider.getLanguage(input.model),
      Config.get(),
      Provider.getProvider(input.model.providerID),
      Auth.get(input.model.providerID),
    ])
    const isCodex = provider.id === "openai" && auth?.type === "oauth"

    const system = SystemPrompt.header(input.model.providerID)
    system.push(
      [
        // use agent prompt otherwise provider prompt
        // For Codex sessions, skip SystemPrompt.provider() since it's sent via options.instructions
        ...(input.agent.prompt ? [input.agent.prompt] : isCodex ? [] : SystemPrompt.provider(input.model)),
        // any custom prompt passed into this call
        ...input.system,
        // any custom prompt from last user message
        ...(input.user.system ? [input.user.system] : []),
      ]
        .filter((x) => x)
        .join("\n"),
    )

    const header = system[0]
    const original = clone(system)
    await Plugin.trigger("experimental.chat.system.transform", { sessionID: input.sessionID }, { system })
    if (system.length === 0) {
      system.push(...original)
    }
    // rejoin to maintain 2-part structure for caching if header unchanged
    if (system.length > 2 && system[0] === header) {
      const rest = system.slice(1)
      system.length = 0
      system.push(header, rest.join("\n"))
    }

    const variant =
      !input.small && input.model.variants && input.user.variant ? input.model.variants[input.user.variant] : {}
    const base = input.small
      ? ProviderTransform.smallOptions(input.model)
      : ProviderTransform.options({
          model: input.model,
          sessionID: input.sessionID,
          providerOptions: provider.options,
        })
    const options: Record<string, any> = pipe(
      base,
      mergeDeep(input.model.options),
      mergeDeep(input.agent.options),
      mergeDeep(variant),
    )
    if (isCodex) {
      options.instructions = SystemPrompt.instructions()
    }

    const params = await Plugin.trigger(
      "chat.params",
      {
        sessionID: input.sessionID,
        agent: input.agent,
        model: input.model,
        provider,
        message: input.user,
      },
      {
        temperature: input.model.capabilities.temperature
          ? (input.agent.temperature ?? ProviderTransform.temperature(input.model))
          : undefined,
        topP: input.agent.topP ?? ProviderTransform.topP(input.model),
        topK: ProviderTransform.topK(input.model),
        options,
      },
    )

    const { headers } = await Plugin.trigger(
      "chat.headers",
      {
        sessionID: input.sessionID,
        agent: input.agent,
        model: input.model,
        provider,
        message: input.user,
      },
      {
        headers: {},
      },
    )

    const maxOutputTokens = isCodex
      ? undefined
      : ProviderTransform.maxOutputTokens(
          input.model.api.npm,
          params.options,
          input.model.limit.output,
          OUTPUT_TOKEN_MAX,
        )

    const tools = await resolveTools(input)

    // LiteLLM and some Anthropic proxies require the tools parameter to be present
    // when message history contains tool calls, even if no tools are being used.
    // Add a dummy tool that is never called to satisfy this validation.
    // This is enabled for:
    // 1. Providers with "litellm" in their ID or API ID (auto-detected)
    // 2. Providers with explicit "litellmProxy: true" option (opt-in for custom gateways)
    const isLiteLLMProxy =
      provider.options?.["litellmProxy"] === true ||
      input.model.providerID.toLowerCase().includes("litellm") ||
      input.model.api.id.toLowerCase().includes("litellm")

    if (isLiteLLMProxy && Object.keys(tools).length === 0 && hasToolCalls(input.messages)) {
      tools["_noop"] = tool({
        description:
          "Placeholder for LiteLLM/Anthropic proxy compatibility - required when message history contains tool calls but no active tools are needed",
        inputSchema: jsonSchema({ type: "object", properties: {} }),
        execute: async () => ({ output: "", title: "", metadata: {} }),
      })
    }

    return streamText({
      onError(error) {
        l.error("stream error", {
          error,
        })
      },
      async experimental_repairToolCall(failed) {
        const repaired = repairToolName(failed.toolCall.toolName, Object.keys(tools))
        if (repaired && repaired !== failed.toolCall.toolName) {
          l.info("repairing tool call", {
            tool: failed.toolCall.toolName,
            repaired,
          })
          return {
            ...failed.toolCall,
            toolName: repaired,
          }
        }
        return {
          ...failed.toolCall,
          input: JSON.stringify({
            tool: failed.toolCall.toolName,
            error: failed.error.message,
          }),
          toolName: "invalid",
        }
      },
      temperature: params.temperature,
      topP: params.topP,
      topK: params.topK,
      providerOptions: ProviderTransform.providerOptions(input.model, params.options),
      activeTools: Object.keys(tools).filter((x) => x !== "invalid"),
      tools,
      maxOutputTokens,
      abortSignal: input.abort,
      headers: {
        ...(input.model.providerID.startsWith("opencode")
          ? {
              "x-opencode-project": Instance.project.id,
              "x-opencode-session": input.sessionID,
              "x-opencode-request": input.user.id,
              "x-opencode-client": Flag.OPENCODE_CLIENT,
            }
          : input.model.providerID !== "anthropic"
            ? {
                "User-Agent": `opencode/${Installation.VERSION}`,
              }
            : undefined),
        ...input.model.headers,
        ...headers,
      },
      maxRetries: input.retries ?? 0,
      messages: [
        ...(isCodex
          ? [
              {
                role: "user",
                content: system.join("\n\n"),
              } as ModelMessage,
            ]
          : system.map(
              (x): ModelMessage => ({
                role: "system",
                content: x,
              }),
            )),
        ...input.messages,
      ],
      model: wrapLanguageModel({
        model: language,
        middleware: [
          {
            async transformParams(args) {
              if (args.type === "stream") {
                // @ts-expect-error
                args.params.prompt = ProviderTransform.message(args.params.prompt, input.model, options)
              }
              return args.params
            },
          },
          extractReasoningMiddleware({ tagName: "think", startWithReasoning: false }),
        ],
      }),
      experimental_telemetry: { isEnabled: cfg.experimental?.openTelemetry },
    })
  }

  async function resolveTools(input: Pick<StreamInput, "tools" | "agent" | "user">) {
    const disabled = PermissionNext.disabled(Object.keys(input.tools), input.agent.permission)
    for (const tool of Object.keys(input.tools)) {
      if (input.user.tools?.[tool] === false || disabled.has(tool)) {
        delete input.tools[tool]
      }
    }
    return input.tools
  }

  // Check if messages contain any tool-call content
  // Used to determine if a dummy tool should be added for LiteLLM proxy compatibility
  export function hasToolCalls(messages: ModelMessage[]): boolean {
    for (const msg of messages) {
      if (!Array.isArray(msg.content)) continue
      for (const part of msg.content) {
        if (part.type === "tool-call" || part.type === "tool-result") return true
      }
    }
    return false
  }
}
