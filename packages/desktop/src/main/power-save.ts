import { powerSaveBlocker } from "electron"
import { createKeepAwakeController } from "./power-save-controller"
import { getStore } from "./store"
import { KEEP_AWAKE_ENABLED_KEY } from "./store-keys"

const controller = createKeepAwakeController(powerSaveBlocker, {
  get: () => getStore().get(KEEP_AWAKE_ENABLED_KEY) === true,
  set: (value) => getStore().set(KEEP_AWAKE_ENABLED_KEY, value),
})

export const initializeKeepAwake = () => controller.initialize()
export const getKeepAwakeEnabled = () => controller.getEnabled()
export const setKeepAwakeEnabled = (enabled: boolean) => controller.setEnabled(enabled)
export const stopKeepAwake = () => controller.stop()
