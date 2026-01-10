import type { McpSdkServerConfigWithInstance } from "@anthropic-ai/claude-agent-sdk"
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk"
import { ToolRegistry } from "../../tool/registry"
import { Log } from "../../util/log"
import { PermissionNext } from "../../permission/next"
import { PermissionBridge } from "./permission-bridge"
import z from "zod"

const log = Log.create({ service: "claude-agent.tool-mcp" })

const TOOL_NAME_MAPPING: Record<string, string> = {
  read: "opencoderead",
  write: "opencodewrite",
  edit: "opencodeedit",
  bash: "opencodebash",
  glob: "opencodeglob",
  greptool: "opencodegrep",
  websearch: "opencodewebsearch",
  webfetch: "opencodewebfetch",
  task: "opencodetask",
  todowrite: "opencodetodowrite",
  todoread: "opencodetodoread",
  question: "opencodequestion",
  lsp: "opencodelsp",
  ls: "opencodels",
  codesearch: "opencodecodesearch",
  skill: "opencodeskill",
  multiedit: "opencodemultiedit",
  patch: "opencodepatch",
  batch: "opencodebatch",
}

function toSDKToolName(opencodeToolId: string): string {
  return TOOL_NAME_MAPPING[opencodeToolId] || opencodeToolId.charAt(0).toUpperCase() + opencodeToolId.slice(1)
}

export namespace ToolMCPBridge {
  export async function create(sessionID: string, permissionBridge?: ReturnType<typeof PermissionBridge.create>): Promise<McpSdkServerConfigWithInstance> {
    try {
      const tools = await ToolRegistry.tools("claude-agent", undefined)
      log.info("creating mcp server for opencode tools", {
        toolCount: Object.keys(tools).length,
        sessionID,
      })

      const sdkTools = []

      for (const toolInfo of tools) {
        try {
          const sdkToolName = toSDKToolName(toolInfo.id)

          log.debug("preparing tool for sdk", {
            toolID: toolInfo.id,
            sdkToolName,
            sessionID,
          })

          const sdkTool = tool(
            sdkToolName,
            toolInfo.description,
            convertSchema(toolInfo.parameters) as any,
            async (args: unknown) => {
              try {
                log.info("sdk executing opencode tool", {
                  toolID: sdkToolName,
                  opencodeToolID: toolInfo.id,
                  sessionID,
                })

                const ctx = {
                  sessionID,
                  messageID: "sdk-tool-call",
                  agent: "claude-sdk",
                  abort: new AbortController().signal,
                  metadata: () => {},
                  ask: async (input: Omit<PermissionNext.Request, "id" | "sessionID" | "tool"> & { ruleset?: PermissionNext.Ruleset }) => {
                    if (permissionBridge) {
                      const reply = await permissionBridge.ask(
                        input.permission,
                        input.patterns,
                        new AbortController().signal,
                      )
                      if (reply === "reject") {
                        throw new Error("Permission rejected")
                      }
                      return
                    }
                    await PermissionNext.ask({
                      permission: input.permission,
                      patterns: input.patterns,
                      always: input.always,
                      metadata: input.metadata,
                      sessionID,
                      ruleset: input.ruleset ?? [],
                    })
                  },
                }

                const result = await toolInfo.execute(args as Record<string, unknown>, ctx)

                log.debug("tool execution completed", {
                  toolID: sdkToolName,
                  resultSize: result.output.length,
                  sessionID,
                })

                return {
                  content: [
                    {
                      type: "text",
                      text: result.output,
                    },
                  ],
                }
              } catch (error) {
                log.error("tool execution failed", {
                  toolID: sdkToolName,
                  error: error instanceof Error ? error.message : String(error),
                  sessionID,
                })

                return {
                  content: [
                    {
                      type: "text",
                      text: `Error: ${error instanceof Error ? error.message : String(error)}`,
                    },
                  ],
                  isError: true,
                }
              }
            },
          )

          sdkTools.push(sdkTool)

          log.debug("prepared tool for sdk", {
            toolID: sdkToolName,
            opencodeToolID: toolInfo.id,
            totalTools: sdkTools.length,
            sessionID,
          })
        } catch (error) {
          const sdkToolName = toSDKToolName(toolInfo.id)
          log.warn("failed to prepare tool", {
            toolID: sdkToolName,
            opencodeToolID: toolInfo.id,
            error: error instanceof Error ? error.message : String(error),
            sessionID,
          })
        }
      }

      const server = createSdkMcpServer({
        name: "tools",
        version: "1.0.0",
        tools: sdkTools,
      })

      log.info("mcp server created successfully", {
        toolCount: sdkTools.length,
        sessionID,
        tools: sdkTools.map((t) => t.name),
      })

      return server as McpSdkServerConfigWithInstance
    } catch (error) {
      log.error("failed to create mcp server", {
        error: error instanceof Error ? error.message : String(error),
        sessionID,
      })
      throw error
    }
  }

  function convertSchema(zodSchema: z.ZodType): unknown {
    try {
      return z.toJSONSchema(zodSchema)
    } catch {
      log.warn("failed to convert schema to json schema", {})
      return { type: "object" }
    }
  }

  function extractPatterns(toolName: string, args: unknown): string[] {
    if (!args || typeof args !== "object") return ["*"]

    const input = args as Record<string, unknown>

    switch (toolName) {
      case "read":
      case "write":
      case "edit":
        return typeof input.filePath === "string" ? [input.filePath] : ["*"]

      case "bash":
        return typeof input.command === "string" ? [input.command] : ["bash *"]

      case "webfetch":
        return typeof input.url === "string" ? [input.url] : ["webfetch *"]

      case "websearch":
        return typeof input.query === "string" ? [input.query] : ["websearch *"]

      case "greptool":
      case "glob": {
        const patterns: string[] = []
        if (typeof input.pattern === "string") patterns.push(input.pattern)
        if (typeof input.path === "string") patterns.push(input.path)
        return patterns.length > 0 ? patterns : ["*"]
      }

      default:
        return ["*"]
    }
  }
}