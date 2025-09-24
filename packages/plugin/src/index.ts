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
import { type ToolDefinition } from "./tool"

export * from "./tool"

export type PluginInput = {
  client: ReturnType<typeof createOpencodeClient>
  project: Project
  directory: string
  worktree: string
  $: BunShell
}

export type Plugin = (input: PluginInput) => Promise<Hooks>

export interface Hooks {
  event?: (input: { event: Event }) => Promise<void>
  config?: (input: Config) => Promise<void>
  tool?: {
    [key: string]: ToolDefinition
  }
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
}
