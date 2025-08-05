import type { Event, createOpencodeClient, App, Model, Provider, Permission, UserMessage, Part } from "@opencode-ai/sdk"
import type { BunShell } from "./shell"

export type PluginInput = {
  client: ReturnType<typeof createOpencodeClient>
  app: App
  $: BunShell
}
export type Plugin = (input: PluginInput) => Promise<Hooks> | Hooks;

export interface Hooks {
  event?: (input: { event: Event }) => Promise<void> | void
  /**
   * Called when a new message is received
   */
  "chat.message"?: (input: {}, output: { message: UserMessage; parts: Part[] }) => Promise<void> | void
  /**
   * Modify parameters sent to LLM
   */
  "chat.params"?: (
    input: { model: Model; provider: Provider; message: UserMessage },
    output: { temperature: number; topP: number },
  ) => Promise<void> | void
  "permission.ask"?: (input: Permission, output: { status: "ask" | "deny" | "allow" }) => Promise<void> | void
  "tool.execute.before"?: (
    input: { tool: string; sessionID: string; callID: string },
    output: { args: any },
  ) => Promise<void> | void
  "tool.execute.after"?: (
    input: { tool: string; sessionID: string; callID: string },
    output: {
      title: string
      output: string
      metadata: any
    },
  ) => Promise<void> | void
}
