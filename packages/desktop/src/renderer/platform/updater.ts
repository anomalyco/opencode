import type { UpdaterPlatform, UpdaterState } from "@opencode-ai/app/desktop"
import { createSignal } from "solid-js"
import type { ElectronAPI } from "../api-types"

export function startDesktopUpdater(api: ElectronAPI): UpdaterPlatform {
  const [state, setState] = createSignal<UpdaterState>({ status: "disabled" })
  void api.updater.subscribe(setState)
  return {
    state,
    check: () => api.updater.check(),
    install: () => api.updater.install(),
  }
}
