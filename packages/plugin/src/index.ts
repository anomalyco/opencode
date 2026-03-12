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

import type { BunShell } from "./shell.js"
import { type ToolDefinition } from "./tool.js"

export * from "./tool.js"

export type ProviderContext = {
  source: "env" | "config" | "custom" | "api"
  info: Provider
  options: Record<string, any>
}

export type WorkspaceAdaptorInfo = {
  id: string
  type: string
  branch: string | null
  name: string | null
  directory: string | null
  extra: unknown | null
  projectID: string
  /**
   * The root directory of the project this workspace belongs to.
   * Use this instead of the plugin-load-time `directory` when the
   * adaptor needs to run commands in the project root (e.g., VCS
   * operations). This is set at call time and reflects the currently
   * active project, not the project that was active when the plugin
   * loaded.
   */
  projectDirectory?: string
}

export type WorkspaceAdaptor = {
  detect?(directory: string): boolean | Promise<boolean>
  configure(info: WorkspaceAdaptorInfo): WorkspaceAdaptorInfo | Promise<WorkspaceAdaptorInfo>
  create(info: WorkspaceAdaptorInfo): Promise<void>
  remove(info: WorkspaceAdaptorInfo): Promise<void>
  reset?(info: WorkspaceAdaptorInfo): Promise<void>
  fetch(info: WorkspaceAdaptorInfo, input: RequestInfo | URL, init?: RequestInit): Promise<Response>
}

export type PluginInput = {
  client: ReturnType<typeof createOpencodeClient>
  project: Project
  directory: string
  worktree: string
  serverUrl: URL
  workspaceFetch: (directory: string, input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
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
                accountId?: string
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
                accountId?: string
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
    input: {
      sessionID: string
      agent?: string
      model?: { providerID: string; modelID: string }
      messageID?: string
      variant?: string
    },
    output: { message: UserMessage; parts: Part[] },
  ) => Promise<void>
  /**
   * Modify parameters sent to LLM
   */
  "chat.params"?: (
    input: { sessionID: string; agent: string; model: Model; provider: ProviderContext; message: UserMessage },
    output: { temperature: number; topP: number; topK: number; options: Record<string, any> },
  ) => Promise<void>
  "chat.headers"?: (
    input: { sessionID: string; agent: string; model: Model; provider: ProviderContext; message: UserMessage },
    output: { headers: Record<string, string> },
  ) => Promise<void>
  "permission.ask"?: (input: Permission, output: { status: "ask" | "deny" | "allow" }) => Promise<void>
  "command.execute.before"?: (
    input: { command: string; sessionID: string; arguments: string },
    output: { parts: Part[] },
  ) => Promise<void>
  "tool.execute.before"?: (
    input: { tool: string; sessionID: string; callID: string },
    output: { args: any },
  ) => Promise<void>
  "shell.env"?: (
    input: { cwd: string; sessionID?: string; callID?: string },
    output: { env: Record<string, string> },
  ) => Promise<void>
  "tool.execute.after"?: (
    input: { tool: string; sessionID: string; callID: string; args: any },
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
    input: { sessionID?: string; model: Model },
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
  /**
   * Modify tool definitions (description and parameters) sent to LLM
   */
  "tool.definition"?: (input: { toolID: string }, output: { description: string; parameters: any }) => Promise<void>
  /**
   * Register workspace adaptors. Each key is a workspace type name
   * (e.g. "jj") and the value implements the adaptor interface.
   *
   * ```ts
   * "workspace.adaptor": {
   *   jj: {
   *     detect(dir) { return existsSync(join(dir, ".jj")) },
   *     configure(info) { ... },
   *     async create(info) { ... },
   *     async remove(info) { ... },
   *     fetch(info, input, init) { ... },
   *   }
   * }
   * ```
   */
  "workspace.adaptor"?: {
    [type: string]: WorkspaceAdaptor
  }
  /**
   * Called to detect the current VCS branch. Plugins can set
   * `output.branch` to provide branch info for non-git VCS systems
   * or when git is in a detached HEAD state.
   *
   * ```ts
   * async "vcs.branch"(input, output) {
   *   output.branch = "my-branch"
   * }
   * ```
   */
  "vcs.branch"?: (input: { directory: string; vcs?: string }, output: { branch?: string }) => Promise<void>
}
