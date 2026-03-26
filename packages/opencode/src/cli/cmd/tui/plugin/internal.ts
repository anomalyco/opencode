import HomeTips from "../feature-plugins/home/tips"
import SidebarContext from "../feature-plugins/sidebar/context"
import SidebarMcp from "../feature-plugins/sidebar/mcp"
import SidebarLsp from "../feature-plugins/sidebar/lsp"
import SidebarTodo from "../feature-plugins/sidebar/todo"
import SidebarFiles from "../feature-plugins/sidebar/files"
import SidebarFooter from "../feature-plugins/sidebar/footer"
import PluginManager from "../feature-plugins/system/plugins"
import type { TuiPluginModule } from "@opencode-ai/plugin/tui"

export type InternalTuiPlugin = {
  name: string
  module: TuiPluginModule
  root?: string
}

export const INTERNAL_TUI_PLUGINS: InternalTuiPlugin[] = [
  {
    name: "home-tips",
    module: HomeTips,
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
  {
    name: "plugin-manager",
    module: PluginManager,
  },
]
