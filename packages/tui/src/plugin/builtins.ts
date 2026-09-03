import HomeFooter from "../feature-plugins/home/footer"
import PromptFooter from "../feature-plugins/prompt/footer"
import SidebarContext from "../feature-plugins/sidebar/context"
import SidebarFooter from "../feature-plugins/sidebar/footer"
import SidebarMcp from "../feature-plugins/sidebar/mcp"
import DiffViewer from "../feature-plugins/system/diff-viewer"
import Notifications from "../feature-plugins/system/notifications"
import Plugins from "../feature-plugins/system/plugins"
import Storybook from "../feature-plugins/system/storybook"
import Stats from "../feature-plugins/system/stats"
import Latex from "@opencode-ai/latex/plugin"
import Merman from "@opencode-ai/merman/plugin"

export const builtins = [
  HomeFooter,
  PromptFooter,
  SidebarContext,
  SidebarMcp,
  SidebarFooter,
  Notifications,
  Plugins,
  Stats,
  Merman,
  Latex,
  // The storybook is a development tool; keep its route and palette commands out of
  // normal launches and register it only for OPENCODE_STORY runs.
  ...(process.env.OPENCODE_STORY ? [Storybook] : []),
  DiffViewer,
]
