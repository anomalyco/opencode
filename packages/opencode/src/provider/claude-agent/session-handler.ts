import { MessageV2 } from "@/session/message-v2"
import { Session } from "@/session"
import { Identifier } from "@/id/id"
import { Instance } from "@/project/instance"
import { Config } from "@/config/config"
import { Bus } from "@/bus"
import { Log } from "@/util/log"
import { BunProc } from "@/bun"
import { ClaudeAgentAdapter } from "./adapter"
import { ClaudeAgentProvider } from "./index"
import type { ClaudeAgentConfig, SDKMcpServerConfig } from "./types"
import { DEFAULT_ALLOWED_TOOLS } from "./types"
import type { Config as ConfigNamespace } from "@/config/config"
import { PermissionBridge } from "./permission-bridge"
import { QuestionBridge } from "./question-bridge"
import { Question } from "@/question"
import { ToolMCPBridge } from "./tool-mcp-bridge"

const log = Log.create({ service: "claude-agent.session" })

/**
 * Session handler for Claude Agent SDK
 *
 * This module handles the integration between opencode's session system
 * and the Claude Agent SDK. When a user selects the claude-agent provider,
 * this handler takes over the session processing.
 */
export namespace ClaudeAgentSession {
  /**
   * Process a session turn using Claude Agent SDK
   */
  export async function process(input: {
    sessionID: string
    user: MessageV2.User
    messages: MessageV2.WithParts[]
    config: ClaudeAgentConfig
    abort: AbortSignal
    session: Session.Info
  }): Promise<MessageV2.WithParts> {
    const { sessionID, user, messages, config, abort, session } = input

    // Create assistant message
    const assistantMessage = (await Session.updateMessage({
      id: Identifier.ascending("message"),
      role: "assistant",
      parentID: user.id,
      sessionID,
      mode: user.agent,
      agent: user.agent,
      path: {
        cwd: Instance.directory,
        root: Instance.worktree,
      },
      cost: 0,
      tokens: {
        input: 0,
        output: 0,
        reasoning: 0,
        cache: { read: 0, write: 0 },
      },
      modelID: user.model.modelID,
      providerID: user.model.providerID,
      time: {
        created: Date.now(),
      },
    })) as MessageV2.Assistant

    const parts: MessageV2.Part[] = []

    try {
      // Import Claude Agent SDK - installed at runtime for compiled binaries
      let query: typeof import("@anthropic-ai/claude-agent-sdk")["query"]
      try {
        const sdkPath = await BunProc.install("@anthropic-ai/claude-agent-sdk")
        const sdk = await import(sdkPath)
        query = sdk.query
      } catch (importError) {
        log.error("failed to load claude agent sdk", { error: importError })
        throw new Error(
          "Failed to load Claude Agent SDK (@anthropic-ai/claude-agent-sdk). " +
            "Error: " + (importError instanceof Error ? importError.message : String(importError)),
        )
      }

      // Create permission and question bridges for this session
      const permissionBridge = PermissionBridge.create(sessionID)
      const questionBridge = QuestionBridge.create(sessionID)

      // Create OpenCode tools MCP server
      const opencodeToolsServer = await ToolMCPBridge.create(sessionID, permissionBridge)
      log.info("opencode tools mcp server ready", {
        serverName: opencodeToolsServer.name,
        sessionID,
      })

      // Build SDK options
      const sdkOptions = await buildSDKOptions(config, session, sessionID, abort, permissionBridge, questionBridge, opencodeToolsServer)

      // Extract prompt from messages
      const prompt = ClaudeAgentAdapter.toSDKPrompt(messages)

      log.info("starting claude agent query", {
        sessionID,
        prompt: prompt.substring(0, 100),
        model: config.model,
        permissionMode: config.permissionMode,
      })

      // Create message context for adapter
      const ctx = {
        sessionID,
        messageID: assistantMessage.id,
        partIndex: 0,
      }

      // Track SDK session ID for resume capability
      let sdkSessionId: string | undefined

      // Call Claude Agent SDK and iterate through results
      const queryResult = query({
        prompt,
        options: sdkOptions,
      })

      for await (const sdkMsg of queryResult) {
        if (abort.aborted) {
          log.info("query aborted", { sessionID })
          break
        }

        // Capture SDK session ID from init message
        if (sdkMsg.type === "system" && sdkMsg.subtype === "init") {
          sdkSessionId = sdkMsg.session_id
          log.info("sdk session initialized", { sdkSessionId })
        }

        // Convert SDK message to opencode parts
        const newParts = ClaudeAgentAdapter.fromSDKMessage(sdkMsg, ctx)
        if (newParts) {
          const partsArray = Array.isArray(newParts) ? newParts : [newParts]
          for (const part of partsArray) {
            parts.push(part)
            await Session.updatePart(part)
            Bus.publish(MessageV2.Event.PartUpdated, { part })
            ctx.partIndex++
          }
        }

        // Extract usage from result messages
        if (sdkMsg.type === "result") {
          const usage = ClaudeAgentAdapter.extractUsage(sdkMsg)
          assistantMessage.tokens = {
            input: usage.input,
            output: usage.output,
            reasoning: 0,
            cache: usage.cache,
          }
          assistantMessage.cost = usage.cost

          // Determine finish reason
          if (sdkMsg.subtype === "success") {
            assistantMessage.finish = "stop"
          } else {
            assistantMessage.finish = "error"
            // Add error info
            if ("errors" in sdkMsg && sdkMsg.errors?.length) {
              assistantMessage.error = {
                name: "UnknownError",
                data: { message: sdkMsg.errors.join(", ") },
              }
            }
          }
        }
      }

      // Store SDK session ID for potential resume
      if (sdkSessionId) {
        log.info("saving sdk session id", { sdkSessionId, sessionID })
        await Session.update(sessionID, (sess) => {
          sess.metadata = sess.metadata ?? {}
          sess.metadata["claudeAgentSessionId"] = sdkSessionId
        })
      }
    } catch (error) {
      log.error("claude agent query failed", {
        sessionID,
        error: error instanceof Error ? error.message : String(error),
      })

      assistantMessage.finish = "error"
      assistantMessage.error = MessageV2.fromError(error, { providerID: ClaudeAgentProvider.ID })

      // Add error message as text part
      parts.push({
        id: Identifier.ascending("part"),
        sessionID,
        messageID: assistantMessage.id,
        type: "text",
        text: `Error: ${error instanceof Error ? error.message : String(error)}`,
      })
      await Session.updatePart(parts[parts.length - 1])
    }

    // Mark message as completed
    assistantMessage.time.completed = Date.now()
    if (!assistantMessage.finish) {
      assistantMessage.finish = abort.aborted ? "cancelled" : "stop"
    }
    await Session.updateMessage(assistantMessage)

    return {
      info: assistantMessage,
      parts,
    }
  }

  /**
   * Build Claude Agent SDK options from opencode config
   */
  async function buildSDKOptions(
    config: ClaudeAgentConfig,
    session: Session.Info,
    sessionID: string,
    abort: AbortSignal,
    permissionBridge: ReturnType<typeof PermissionBridge.create>,
    questionBridge: ReturnType<typeof QuestionBridge.create>,
    opencodeToolsServer: Awaited<ReturnType<typeof ToolMCPBridge.create>>,
  ): Promise<Record<string, unknown>> {
    const mcpServers = await getMcpServersForSDK(config)

    // Add OpenCode's tools via MCP server
    mcpServers["tools"] = opencodeToolsServer

    const options: Record<string, unknown> = {
      // Permission mode
      permissionMode: config.permissionMode ?? "default",

      // Disable SDK's built-in tools to only use OpenCode MCP tools
      disableBuiltInTools: true,

      // Allowed tools - empty since we're disabling built-in tools
      allowedTools: [],

      // Working directory
      cwd: config.cwd ?? Instance.directory,

      // System prompt
      systemPrompt: config.systemPrompt,

      // Model selection
      model: config.model,

      // MCP servers (merged from opencode config + plugin config)
      mcpServers,

      // Hooks for permission and question bridging
      hooks: {
        PermissionRequest: [
          {
            hooks: [
              async (
                input: {
                  hook_event_name: string
                  tool_name: string
                  tool_input: unknown
                  session_id: string
                  transcript_path: string
                  cwd: string
                  permission_suggestions?: unknown[]
                },
                toolUseID: string | null,
                context: { signal: AbortSignal },
              ) => {
                // Skip OpenCode's permission system if SDK is in bypass mode
                if (config.permissionMode === "bypassPermissions") {
                  return {
                    hookSpecificOutput: {
                      hookEventName: "PermissionRequest",
                      permissionDecision: "allow" as const,
                      permissionDecisionReason: "Bypass mode enabled",
                    },
                  }
                }

                // Handle AskUserQuestion specially - bridge to OpenCode's question system
                if (input.tool_name === "AskUserQuestion") {
                  const toolInput = input.tool_input as {
                    questions: Array<{
                      question: string
                      header: string
                      options: Array<{ label: string; description: string }>
                      multiSelect: boolean
                    }>
                  }

                  // Convert SDK format to OpenCode format
                  const questions: Question.Info[] = toolInput.questions.map((q) => ({
                    question: q.question,
                    header: q.header,
                    options: q.options.map((o) => ({
                      label: o.label,
                      description: o.description,
                    })),
                    multiple: q.multiSelect,
                  }))

                  try {
                    // Ask OpenCode's question system
                    const answers = await questionBridge.ask(questions, context.signal)

                    // Convert answers back to SDK format (map question text to answer label)
                    const answersMap: Record<string, string> = {}
                    answers.forEach((answer, index) => {
                      if (answer.length > 0 && questions[index]) {
                        answersMap[questions[index].question] = answer.join(", ")
                      }
                    })

                    return {
                      hookSpecificOutput: {
                        hookEventName: "PermissionRequest",
                        permissionDecision: "allow" as const,
                        permissionDecisionReason: "User answered questions",
                        updatedInput: {
                          ...toolInput,
                          answers: answersMap,
                        },
                      },
                    }
                  } catch (error) {
                    log.error("question handling failed", {
                      error: error instanceof Error ? error.message : String(error),
                      sessionID,
                    })
                    return {
                      hookSpecificOutput: {
                        hookEventName: "PermissionRequest",
                        permissionDecision: "deny" as const,
                        permissionDecisionReason: error instanceof Error ? error.message : "Question rejected",
                      },
                    }
                  }
                }

                // Regular permission handling - bridge to OpenCode's permission system
                try {
                  const reply = await permissionBridge.ask(input.tool_name, input.tool_input, context.signal)

                  if (reply === "reject") {
                    return {
                      hookSpecificOutput: {
                        hookEventName: "PermissionRequest",
                        permissionDecision: "deny" as const,
                        permissionDecisionReason: "User rejected permission",
                      },
                    }
                  } else {
                    return {
                      hookSpecificOutput: {
                        hookEventName: "PermissionRequest",
                        permissionDecision: "allow" as const,
                        permissionDecisionReason: "User approved permission",
                      },
                    }
                  }
                } catch (error) {
                  log.error("permission handling failed", {
                    error: error instanceof Error ? error.message : String(error),
                    sessionID,
                    toolName: input.tool_name,
                  })
                  return {
                    hookSpecificOutput: {
                      hookEventName: "PermissionRequest",
                      permissionDecision: "deny" as const,
                      permissionDecisionReason: error instanceof Error ? error.message : "Permission error",
                    },
                  }
                }
              },
            ],
          },
        ],
      },
    }

    log.info("built sdk options", {
      mcpServerCount: Object.keys(mcpServers).length,
      mcpServers: Object.keys(mcpServers),
      permissionMode: config.permissionMode,
      hooksEnabled: Boolean(options.hooks),
    })

    // Resume previous SDK session if available
    const sdkSessionId = session.metadata?.["claudeAgentSessionId"] as string | undefined
    if (sdkSessionId) {
      options.resume = sdkSessionId
      log.info("resuming sdk session", { sdkSessionId })
    }

    // For bypassPermissions, we need to explicitly allow it
    if (config.permissionMode === "bypassPermissions") {
      options.allowDangerouslySkipPermissions = true
    }

    return options
  }

  /**
   * Convert opencode MCP server configurations to Claude Agent SDK format
   */
  async function getMcpServersForSDK(
    config: ClaudeAgentConfig,
  ): Promise<Record<string, SDKMcpServerConfig>> {
    const result: Record<string, SDKMcpServerConfig> = {}

    // Add MCP servers from plugin config
    if (config.mcpServers) {
      for (const [name, server] of Object.entries(config.mcpServers)) {
        result[name] = {
          type: "stdio",
          command: server.command,
          args: server.args,
          env: server.env,
        }
      }
    }

    // Add MCP servers from opencode's global config
    try {
      const appConfig = await Config.get()
      const mcpConfig = appConfig.mcp ?? {}

      for (const [name, mcp] of Object.entries(mcpConfig)) {
        // Skip if already defined in plugin config (plugin takes precedence)
        if (result[name]) continue

        // Skip disabled servers
        if (typeof mcp === "object" && "enabled" in mcp && mcp.enabled === false) {
          continue
        }

        // Handle local MCP servers (stdio-based)
        if (typeof mcp === "object" && "type" in mcp && mcp.type === "local") {
          const [command, ...args] = mcp.command
          result[name] = {
            type: "stdio",
            command,
            args,
            env: mcp.environment,
          }
          log.info("added local mcp server to SDK", { name, command, argsCount: args.length })
        }
        // Handle remote MCP servers (SSE/HTTP-based)
        else if (typeof mcp === "object" && "type" in mcp && mcp.type === "remote") {
          // Determine transport type based on URL path
          const baseUrl = mcp.url.toLowerCase()
          const type = baseUrl.includes("/sse") || baseUrl.endsWith("/sse") ? "sse" : "http"

          result[name] = {
            type,
            url: mcp.url,
            headers: mcp.headers ?? {},
          }

          // Add OAuth headers if configured
          if (mcp.oauth && typeof mcp.oauth === "object") {
            const oauth = mcp.oauth
            if (oauth.clientId) {
              result[name].headers = {
                ...result[name].headers,
                "X-OAuth-Client-ID": oauth.clientId,
              }
            }
            if (oauth.clientSecret) {
              result[name].headers = {
                ...result[name].headers,
                "X-OAuth-Client-Secret": oauth.clientSecret,
              }
            }
            if (oauth.scope) {
              result[name].headers = {
                ...result[name].headers,
                "X-OAuth-Scope": oauth.scope,
              }
            }
          }

          log.info("added remote mcp server to SDK", {
            name,
            type,
            url: mcp.url,
            hasAuth: Object.keys(result[name].headers ?? {}).length > 0,
          })
        }
      }

      log.info("built mcp servers config for SDK", {
        count: Object.keys(result).length,
        servers: Object.keys(result),
        details: result,
      })
    } catch (error) {
      log.warn("failed to get opencode mcp config", { error })
    }

    return result
  }

  /**
   * Get Claude Agent configuration from session/config
   */
  export async function getConfig(session: Session.Info): Promise<ClaudeAgentConfig> {
    const appConfig = await Config.get()
    const providerConfig = appConfig.provider?.[ClaudeAgentProvider.ID]

    // Start with defaults
    const config = ClaudeAgentProvider.getDefaultConfig()

    // Merge with provider-level config
    if (providerConfig && "claudeAgent" in providerConfig) {
      const claudeAgentConfig = providerConfig.claudeAgent as Partial<ClaudeAgentConfig>
      return ClaudeAgentProvider.mergeConfig(claudeAgentConfig)
    }

    return config
  }
}
