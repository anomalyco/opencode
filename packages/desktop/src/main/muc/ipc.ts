// MUC Harness: muc://connect 深链 + 凭据 IPC。
// 渲染层通过这些通道查询连接状态、发起连接、断开账户。

import { ipcMain } from "electron"
import { MucSecretStore } from "./secret-store"
import { MucConnectController } from "./controller"
import { parseMucUrl } from "./deep-link"
import { isMucExchangeError } from "./controller"

export type MucDeps = {
  getPendingConnectCode: () => string | null
}

export function registerMucIpcHandlers(userDataDir: string, deps: MucDeps): MucConnectController {
  const store = new MucSecretStore(userDataDir)
  const controller = new MucConnectController(store)

  ipcMain.handle("muc:get-state", async () => {
    return controller.restoreToProcessEnv()
  })

  ipcMain.handle("muc:connect", async (_event, code: unknown) => {
    if (typeof code !== "string" || !parseMucUrl(`muc://connect?code=${code}`)) {
      return { ok: false, error: "invalid_code" as const }
    }
    try {
      const { state, modelCount } = await controller.connect(code)
      return { ok: true, state, modelCount }
    } catch (error) {
      if (isMucExchangeError(error)) {
        return { ok: false, error: error.reason }
      }
      return { ok: false, error: "unknown" as const }
    }
  })

  ipcMain.handle("muc:disconnect", async () => {
    return controller.disconnect()
  })

  ipcMain.handle("muc:pending-code", () => deps.getPendingConnectCode())

  return controller
}
