import type { TuiPluginApi } from "@opencode-ai/plugin/tui"

export function sidebarSlot(api: TuiPluginApi): any {
  return {
    slots: {
      sidebar_content: {
        render: (props: { session_id: string }, ctx: any) => {
          return `Team Sidebar` as any
        },
      },
    },
  }
}
