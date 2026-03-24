export type InternalTuiPlugin = {
  name: string
  module: Record<string, unknown>
  root?: string
}

export const INTERNAL_TUI_PLUGINS: InternalTuiPlugin[] = []
