import fs from "fs"
import path from "path"

const OPENTUI_DLL = "opentui.dll"

export function resolveOpenTuiSidecarPath(execPath = process.execPath, platform = process.platform) {
  if (platform !== "win32") return

  const candidate = path.join(path.dirname(execPath), OPENTUI_DLL)
  if (!fs.existsSync(candidate)) return
  return candidate
}

export async function configureOpenTuiNativeLibrary() {
  const libPath = resolveOpenTuiSidecarPath()
  if (!libPath) return

  const { setRenderLibPath } = await import("@opentui/core")
  setRenderLibPath(libPath)
}
