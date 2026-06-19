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
   * Set exactly to the string `true` to hide the sticky session title header.
   * @example VITE_DISABLE_SESSION_HEADER=true
   */
  readonly VITE_DISABLE_SESSION_HEADER?: string
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
  /**
   * Hide the new-session intro (title, project path, branch, last modified).
   * @example VITE_DISABLE_CHAT_INTRO=true
   */
  readonly VITE_DISABLE_CHAT_INTRO?: string
  /**
   * Prompt submit shortcut (parseKeybind format). Defaults to `enter`.
   * @example VITE_PROMPT_SUBMIT_KEY=mod+enter
   */
  readonly VITE_PROMPT_SUBMIT_KEY?: string
  /**
   * Prompt newline shortcut (parseKeybind format). Defaults to `shift+enter`.
   * @example VITE_PROMPT_NEWLINE_KEY=shift+enter
   */
  readonly VITE_PROMPT_NEWLINE_KEY?: string
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
