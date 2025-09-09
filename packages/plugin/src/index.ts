import type {
  Event,
  createOpencodeClient,
  Project,
  Model,
  Provider,
  Permission,
  UserMessage,
  Part,
  Auth,
  Config,
} from "@opencode-ai/sdk"
import type { BunShell } from "./shell"

export type PluginInput = {
  client: ReturnType<typeof createOpencodeClient>
  project: Project
  directory: string
  worktree: string
  $: BunShell
  Tool: {
    define(
      id: string,
      init: any | (() => Promise<any>)
    ): any
  }
  z: any // Zod instance for creating schemas
}
export type Plugin = (input: PluginInput) => Promise<Hooks>

// Lightweight schema spec for HTTP-registered tools
export type HttpParamSpec = {
  type: "string" | "number" | "boolean" | "array"
  description?: string
  optional?: boolean
  items?: "string" | "number" | "boolean"
}
export type HttpToolRegistration = {
  id: string
  description: string
  parameters: {
    type: "object"
    properties: Record<string, HttpParamSpec>
  }
  callbackUrl: string
  headers?: Record<string, string>
}

export interface Hooks {
  event?: (input: { event: Event }) => Promise<void>
  config?: (input: Config) => Promise<void>
  auth?: {
    provider: string
    loader?: (auth: () => Promise<Auth>, provider: Provider) => Promise<Record<string, any>>
    methods: (
      | {
          type: "oauth"
          label: string
          authorize(): Promise<
            { url: string; instructions: string } & (
              | {
                  method: "auto"
                  callback(): Promise<
                    | ({
                        type: "success"
                      } & (
                        | {
                            refresh: string
                            access: string
                            expires: number
                          }
                        | { key: string }
                      ))
                    | {
                        type: "failed"
                      }
                  >
                }
              | {
                  method: "code"
                  callback(code: string): Promise<
                    | ({
                        type: "success"
                      } & (
                        | {
                            refresh: string
                            access: string
                            expires: number
                          }
                        | { key: string }
                      ))
                    | {
                        type: "failed"
                      }
                  >
                }
            )
          >
        }
      | { type: "api"; label: string }
    )[]
  }
  /**
   * Called when a new message is received
   */
  "chat.message"?: (input: {}, output: { message: UserMessage; parts: Part[] }) => Promise<void>
  /**
   * Modify parameters sent to LLM
   */
  "chat.params"?: (
    input: { model: Model; provider: Provider; message: UserMessage },
    output: { temperature: number; topP: number; options: Record<string, any> },
  ) => Promise<void>
  "permission.ask"?: (input: Permission, output: { status: "ask" | "deny" | "allow" }) => Promise<void>
  "tool.execute.before"?: (
    input: { tool: string; sessionID: string; callID: string },
    output: { args: any },
  ) => Promise<void>
  "tool.execute.after"?: (
    input: { tool: string; sessionID: string; callID: string },
    output: {
      title: string
      output: string
      metadata: any
    },
  ) => Promise<void>
  /**
   * Allow plugins to register additional tools with the server.
   * Use registerHTTP to add a tool that calls back to your plugin/service.
   * Use register to add a native/local tool with direct function execution.
   */
  "tool.register"?: (
    input: {},
    output: {
      registerHTTP: (tool: HttpToolRegistration) => void | Promise<void>
      register: (tool: any) => void | Promise<void>  // Tool.Info type from opencode
    },
  ) => Promise<void>
}
