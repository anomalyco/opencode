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
  /**
   * Sticky session title header. Set to `hidden` at build time to omit the bar.
   * @example VITE_SESSION_HEADER=hidden
   */
  readonly VITE_SESSION_HEADER: string
  /**
   * Set exactly to the string `true` to use the production/minimal app layout unless devMode is enabled.
   * @example VITE_PRODUCTION_LAYOUT=true
   */
  readonly VITE_PRODUCTION_LAYOUT?: string
  /**
   * Set exactly to the string `true` to disable @ mention / file popover, / slash-command popover,
   * and the leading `!` shell shortcut in the prompt input.
   * @example VITE_DISABLE_PROMPT_TRIGGERS=true
   */
  readonly VITE_DISABLE_PROMPT_TRIGGERS?: string
  /**
   * Hide the prompt dock auto-accept permissions control.
   * @example VITE_DISABLE_PROMPT_PERMISSIONS=true
   */
  readonly VITE_DISABLE_PROMPT_PERMISSIONS?: string
  /**
   * Hide the prompt dock footer (agent, model, variant, permissions).
   * @example VITE_DISABLE_PROMPT_FOOTER=true
   */
  readonly VITE_DISABLE_PROMPT_FOOTER?: string
  /**
   * Hide prompt mode selection controls.
   * @example VITE_DISABLE_WYSIWYG_ONLY=true
   */
  readonly VITE_DISABLE_WYSIWYG_ONLY?: string
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
