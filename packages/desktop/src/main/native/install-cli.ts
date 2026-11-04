import { dialog } from "electron"
import { Effect } from "effect"
import { DesktopCli } from "../service/desktop-cli"
import { nativeT } from "./translations"

export function showCliInstaller(desktopCli: DesktopCli.Interface) {
  return desktopCli.install.pipe(
    Effect.tap((path) =>
      Effect.promise(() =>
        dialog.showMessageBox({
          type: "info",
          message: nativeT("desktop.cli.installed.message", { path }),
          title: nativeT("desktop.cli.installed.title"),
        }),
      ),
    ),
    Effect.catch((error) =>
      Effect.promise(() =>
        dialog.showMessageBox({
          type: "error",
          message: nativeT("desktop.cli.failed.message", { error: error.message }),
          title: nativeT("desktop.cli.failed.title"),
        }),
      ),
    ),
    Effect.asVoid,
  )
}
