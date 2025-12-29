import type {
  Event,
  createOpencodeClient,
  Project,
  Model,
  Provider,
  Permission,
  UserMessage,
  Message,
  Part,
  Auth,
  Config,
} from "@opencode-ai/sdk"

import type { BunShell } from "./shell"
import { type ToolDefinition } from "./tool"

export * from "./tool"

export type ProviderContext = {
  source: "env" | "config" | "custom" | "api"
  info: Provider
  options: Record<string, any>
}

export type PluginInput = {
  client: ReturnType<typeof createOpencodeClient>
  project: Project
  directory: string
  worktree: string
  $: BunShell
}

export type Plugin = (input: PluginInput) => Promise<Hooks>

export type AuthHook = {
  provider: string
  loader?: (auth: () => Promise<Auth>, provider: Provider) => Promise<Record<string, any>>
  methods: (
    | {
        type: "oauth"
        label: string
        prompts?: Array<
          | {
              type: "text"
              key: string
              message: string
              placeholder?: string
              validate?: (value: string) => string | undefined
              condition?: (inputs: Record<string, string>) => boolean
            }
          | {
              type: "select"
              key: string
              message: string
              options: Array<{
                label: string
                value: string
                hint?: string
              }>
              condition?: (inputs: Record<string, string>) => boolean
            }
        >
        authorize(inputs?: Record<string, string>): Promise<AuthOuathResult>
      }
    | {
        type: "api"
        label: string
        prompts?: Array<
          | {
              type: "text"
              key: string
              message: string
              placeholder?: string
              validate?: (value: string) => string | undefined
              condition?: (inputs: Record<string, string>) => boolean
            }
          | {
              type: "select"
              key: string
              message: string
              options: Array<{
                label: string
                value: string
                hint?: string
              }>
              condition?: (inputs: Record<string, string>) => boolean
            }
        >
        authorize?(inputs?: Record<string, string>): Promise<
          | {
              type: "success"
              key: string
              provider?: string
            }
          | {
              type: "failed"
            }
        >
      }
  )[]
}

export type AuthOuathResult = { url: string; instructions: string } & (
  | {
      method: "auto"
      callback(): Promise<
        | ({
            type: "success"
            provider?: string
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
            provider?: string
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

export interface Hooks {
  event?: (input: { event: Event }) => Promise<void>
  config?: (input: Config) => Promise<void>
  tool?: {
    [key: string]: ToolDefinition
  }
  auth?: AuthHook
  /**
   * Called when a new message is received
   */
  "chat.message"?: (
    input: { sessionID: string; agent?: string; model?: { providerID: string; modelID: string }; messageID?: string },
    output: { message: UserMessage; parts: Part[] },
  ) => Promise<void>
  /**
   * Modify parameters sent to LLM
   */
  "chat.params"?: (
    input: { sessionID: string; agent: string; model: Model; provider: ProviderContext; message: UserMessage },
    output: { temperature: number; topP: number; topK: number; options: Record<string, any> },
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
  "experimental.chat.messages.transform"?: (
    input: {},
    output: {
      messages: {
        info: Message
        parts: Part[]
      }[]
    },
  ) => Promise<void>
  "experimental.chat.system.transform"?: (
    input: {},
    output: {
      system: string[]
    },
  ) => Promise<void>
  /**
   * Called before session compaction starts. Allows plugins to customize
   * the compaction prompt.
   *
   * - `context`: Additional context strings appended to the default prompt
   * - `prompt`: If set, replaces the default compaction prompt entirely
   */
  "experimental.session.compacting"?: (
    input: { sessionID: string },
    output: { context: string[]; prompt?: string },
  ) => Promise<void>
  "experimental.text.complete"?: (
    input: { sessionID: string; messageID: string; partID: string },
    output: { text: string },
  ) => Promise<void>
}

// View primitive types for plugins
export type TreeNode = {
  id: string
  label: string
  icon?: string
  children: TreeNode[]
  expanded?: boolean
  metadata?: Record<string, any>
}

export type TreeView = {
  type: "tree"
  id: string
  title: string
  nodes: TreeNode[]
  selectedID?: string
}

export type ListItem = {
  id: string
  label: string
  description?: string
  icon?: string
  metadata?: Record<string, any>
}

export type ListView = {
  type: "list"
  id: string
  title: string
  items: ListItem[]
  searchable?: boolean
  selectedID?: string
}

export type TextView = {
  type: "text"
  id: string
  title: string
  content: string
  filetype?: string
}

export type FormField =
  | { id: string; type: "text"; label: string; value?: string; placeholder?: string }
  | { id: string; type: "toggle"; label: string; value?: boolean }
  | { id: string; type: "select"; label: string; options: string[]; value?: string }
  | { id: string; type: "number"; label: string; value?: number; min?: number; max?: number }

export type FormView = {
  type: "form"
  id: string
  title: string
  fields: FormField[]
}

export type PluginView = TreeView | ListView | TextView | FormView

// Window API for plugins
export type WindowAPI = {
  // Window operations
  createSplit(options: { direction: "horizontal" | "vertical"; size?: number; viewID: string }): string
  closeWindow(windowID?: string): boolean
  focusWindow(windowID: string): void
  getCurrentWindow(): { id: string; viewID: string } | undefined
  getAllWindows(): Array<{ id: string; viewID: string }>

  // View operations
  registerView(view: PluginView): void
  updateView(viewID: string, view: Partial<PluginView>): void
  unregisterView(viewID: string): void

  // Float operations
  openFloat(options: { viewID: string; x?: number; y?: number; width: number; height: number }): string
  closeFloat(floatID: string): void
}

// Keybind registration for plugins
export type KeybindAPI = {
  register(options: { key: string; description: string; scope?: "global" | "window"; handler: () => void }): () => void
}

// Extended plugin input with window API
export type PluginInputWithWindow = PluginInput & {
  window: WindowAPI
  keybind: KeybindAPI
}

// Extended hooks with window events
export interface WindowHooks {
  "window.focused"?: (input: { windowID: string; viewID: string }) => Promise<void>
  "window.closed"?: (input: { windowID: string }) => Promise<void>
  "view.action"?: (input: {
    viewID: string
    action: string
    itemID?: string
    data?: Record<string, any>
  }) => Promise<void>
}
