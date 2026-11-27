import { BACKGROUND_NOTICE_SHOWN_KEY, KEEP_SERVICE_RUNNING_KEY } from "../storage/keys"
import { getStore } from "../storage/store"

/** Whether the background service outlives the app when it quits. On unless the user turned it off. */
export function getKeepServiceRunning() {
  return getStore().get(KEEP_SERVICE_RUNNING_KEY) !== false
}

export function setKeepServiceRunning(enabled: boolean) {
  getStore().set(KEEP_SERVICE_RUNNING_KEY, enabled)
}

export function getBackgroundNoticeShown() {
  return getStore().get(BACKGROUND_NOTICE_SHOWN_KEY) === true
}

export function setBackgroundNoticeShown() {
  getStore().set(BACKGROUND_NOTICE_SHOWN_KEY, true)
}
