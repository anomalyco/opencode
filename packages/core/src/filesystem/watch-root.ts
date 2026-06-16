import os from "os"
import { FSUtil } from "../fs-util"

/** Directories that are unsafe to inotify-watch (entire home, filesystem root). */
export function isBroadWatchRoot(directory: string): boolean {
  const resolved = FSUtil.resolve(directory)
  if (resolved === FSUtil.resolve("/")) return true
  return resolved === FSUtil.resolve(os.homedir())
}
