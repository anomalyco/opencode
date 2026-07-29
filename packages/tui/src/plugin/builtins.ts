import HomeFooter from "../feature-plugins/home/footer"
import PromptFooter from "../feature-plugins/prompt/footer"
import SidebarContext from "../feature-plugins/sidebar/context"
import SidebarFooter from "../feature-plugins/sidebar/footer"
import SidebarLsp from "../feature-plugins/sidebar/lsp"
import SidebarMcp from "../feature-plugins/sidebar/mcp"
import DiffViewer from "../feature-plugins/system/diff-viewer"
import Notifications from "../feature-plugins/system/notifications"
import Plugins from "../feature-plugins/system/plugins"
import Storybook from "../feature-plugins/system/storybook"

export const builtins = [
  HomeFooter,
  PromptFooter,
  SidebarContext,
  SidebarMcp,
  SidebarLsp,
  SidebarFooter,
  Notifications,
  Plugins,
  Storybook,
  DiffViewer,
]
