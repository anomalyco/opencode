import { Schema } from "effect"
import { Rpc, RpcGroup } from "effect/unstable/rpc"

const DesktopMenuAction = Schema.Literals([
  "app.checkForUpdates",
  "app.installCli",
  "app.relaunch",
  "edit.undo",
  "edit.redo",
  "edit.cut",
  "edit.copy",
  "edit.paste",
  "edit.delete",
  "edit.selectAll",
  "view.reload",
  "view.toggleDevTools",
  "view.resetZoom",
  "view.zoomIn",
  "view.zoomOut",
  "view.toggleFullscreen",
  "window.new",
  "window.close",
  "window.minimize",
  "window.toggleMaximize",
])

export const MenuRunAction = Rpc.make("MenuRunAction", {
  payload: { action: DesktopMenuAction },
})
export const MenuRpcs = RpcGroup.make(MenuRunAction)
