import path from "path"
import { Global } from "@opencode-ai/core/global"
import { Filesystem } from "./util/filesystem"

export namespace QuickAssistant {
  export function root() {
    return path.join(Global.Path.config, "quick-assistant")
  }

  export function active(dir: string) {
    const base = Filesystem.resolve(root())
    const next = Filesystem.resolve(dir)
    return next === base || Filesystem.contains(base, next)
  }
}
