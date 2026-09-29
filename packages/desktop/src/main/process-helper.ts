import { join } from "node:path"

export function processWin32HelperPath(input: {
  appIsPackaged: boolean
  resourcesPath: string
  developmentResourcesPath: string
}) {
  return join(input.appIsPackaged ? input.resourcesPath : input.developmentResourcesPath, "opencode-process-win32.exe")
}
