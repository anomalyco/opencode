import * as SidebarTitle from "../feature-plugins/sidebar/title"
import * as SidebarContext from "../feature-plugins/sidebar/context"
import * as SidebarMcp from "../feature-plugins/sidebar/mcp"
import * as SidebarLsp from "../feature-plugins/sidebar/lsp"
import * as SidebarTodo from "../feature-plugins/sidebar/todo"
import * as SidebarFiles from "../feature-plugins/sidebar/files"
import * as SidebarFooter from "../feature-plugins/sidebar/footer"

export type InternalTuiPlugin = {
  name: string
  module: Record<string, unknown>
  root?: string
}

export const INTERNAL_TUI_PLUGINS: InternalTuiPlugin[] = [
  {
    name: "sidebar-title",
    module: SidebarTitle,
  },
  {
    name: "sidebar-content-context",
    module: SidebarContext,
  },
  {
    name: "sidebar-content-mcp",
    module: SidebarMcp,
  },
  {
    name: "sidebar-content-lsp",
    module: SidebarLsp,
  },
  {
    name: "sidebar-content-todo",
    module: SidebarTodo,
  },
  {
    name: "sidebar-content-files",
    module: SidebarFiles,
  },
  {
    name: "sidebar-footer",
    module: SidebarFooter,
  },
]
