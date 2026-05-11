import "solid-js"

interface ImportMetaEnv {
  readonly VITE_OPENCODE_SERVER_HOST: string
  readonly VITE_OPENCODE_SERVER_PORT: string
  /**
   * @example VITE_MODEL_PIN=anthropic/claude-opus-4.1
   */
  readonly VITE_MODEL_PIN: string
  /**
   * @example VITE_MODEL_PIN_TIER=high
   */
  readonly VITE_MODEL_PIN_TIER: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare module "solid-js" {
  namespace JSX {
    interface Directives {
      sortable: true
    }
  }
}
