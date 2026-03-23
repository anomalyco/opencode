import { execSync, exec } from "child_process"
import { existsSync } from "fs"
import path from "path"
import os from "os"

const APP_PATH = path.join(os.homedir(), "Applications", "OpenCodeReveal.app")
const SCHEME = "opencode-reveal"

let provisioned: boolean | undefined

export function revealScheme(absolute: string) {
  if (process.platform !== "darwin") return `file://${absolute}`
  if (provisioned === undefined) provisioned = existsSync(APP_PATH)
  if (!provisioned) return `file://${absolute}`
  return `${SCHEME}://${absolute}`
}

export function provisionRevealHandler() {
  if (process.platform !== "darwin") return
  if (existsSync(APP_PATH)) {
    provisioned = true
    return
  }
  try {
    execSync(
      `osacompile -o ${JSON.stringify(APP_PATH)} -e 'on open location input' -e 'set filePath to text 21 thru -1 of input' -e 'do shell script "open -R " & quoted form of filePath' -e 'end open location'`,
      { stdio: "ignore" },
    )
    execSync(
      `defaults write ${JSON.stringify(APP_PATH + "/Contents/Info")} CFBundleURLTypes -array '{ CFBundleURLName = "OpenCode Reveal"; CFBundleURLSchemes = ("${SCHEME}"); }'`,
      { stdio: "ignore" },
    )
    exec(
      `/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f ${JSON.stringify(APP_PATH)}`,
    )
    provisioned = true
  } catch {
    provisioned = false
  }
}
