import type { Event, createOpencodeClient, App, Model, Provider, Permission, UserMessage, Part } from "@opencode-ai/sdk"
import { $ } from "bun"

export type PluginInput = {
  client: ReturnType<typeof createOpencodeClient>
  app: App
  $: $
}
export type Plugin = (input: PluginInput) => Promise<Hooks>

export interface Hooks {
  event?: (input: { event: Event }) => Promise<void>
  chat?: {
    /**
     * Called when a new message is received
     */
    message?: (input: {}, output: { message: UserMessage; parts: Part[] }) => Promise<void>
    /**
     * Modify parameters sent to LLM
     */
    params?: (
      input: { model: Model; provider: Provider; message: UserMessage },
      output: { temperature: number; topP: number },
    ) => Promise<void>
  }
  permission?: {
    /**
     * Called when a permission is asked
     */
    ask?: (input: Permission, output: { status: "ask" | "deny" | "allow" }) => Promise<void>
  }
  tool?: {
    execute?: {
      /**
       * Called before a tool is executed
       */
      before?: (
        input: { tool: string; sessionID: string; callID: string },
        output: {
          args: any
        },
      ) => Promise<void>
      /**
       * Called after a tool is executed
       */
      after?: (
        input: { tool: string; sessionID: string; callID: string },
        output: {
          title: string
          output: string
          metadata: any
        },
      ) => Promise<void>
    }
  }
}
