interface ImportMetaEnv {
  readonly VITE_OPENCODE_SERVER_HOST: string
  readonly VITE_OPENCODE_SERVER_PORT: string
  readonly VITE_OPENCODE_CHANNEL?: "dev" | "beta" | "prod"

  readonly VITE_SENTRY_DSN?: string
  readonly VITE_SENTRY_ENVIRONMENT?: string
  readonly VITE_SENTRY_RELEASE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

export declare module "solid-js" {
  namespace JSX {
    interface Directives {
      sortable: true
    }
  }
}

// Fork extensions: opencode core in this fork exposes additional VCS metadata
// (worktrees, branches) and UserMessage variants. Augment the upstream SDK types
// so business code can continue using these fields without weakening type safety.
declare module "@opencode-ai/sdk/v2/gen/types.gen" {
  interface VcsInfo {
    branches?: Array<string>
    worktrees?: Array<{
      path: string
      branch?: string
      head?: string
      bare?: boolean
      detached?: boolean
      locked?: string
      prunable?: string
    }>
  }

  interface UserMessage {
    variant?: string
  }
}
