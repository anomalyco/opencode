import HomeFooter from "../feature-plugins/home/footer"
import SidebarContext from "../feature-plugins/sidebar/context"
import SidebarFooter from "../feature-plugins/sidebar/footer"
import SidebarLsp from "../feature-plugins/sidebar/lsp"
import SidebarMcp from "../feature-plugins/sidebar/mcp"
import DiffViewer from "../feature-plugins/system/diff-viewer"
import Notifications from "../feature-plugins/system/notifications"
import Plugins from "../feature-plugins/system/plugins"
import Scrap from "../feature-plugins/system/scrap"

export const builtins = [
  HomeFooter,
  SidebarContext,
  SidebarMcp,
  SidebarLsp,
  SidebarFooter,
  Notifications,
  Plugins,
  Scrap,
  DiffViewer,
]
