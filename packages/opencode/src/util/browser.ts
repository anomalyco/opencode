import open from "open"
import { spawn } from "child_process"
import { isTermux } from "@opencode-ai/core/global"

export function openUrl(url: string): Promise<import("child_process").ChildProcess> {
  if (isTermux()) {
    const proc = spawn("termux-open-url", [url], { stdio: "ignore", detached: true })
    proc.unref()
    return Promise.resolve(proc)
  }
  return open(url)
}

export * as Browser from "./browser"
