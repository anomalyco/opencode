export * as ConfigUsername from "./username"

import os from "os"
import * as Log from "@opencode-ai/core/util/log"

const log = Log.create({ service: "config" })

export function get() {
  try {
    return os.userInfo().username || "user"
  } catch (err) {
    log.warn("failed to read system username, using fallback", { err })
    return "user"
  }
}
