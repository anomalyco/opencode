import fs from "fs/promises"
import path from "path"
import { Global } from "../global"

export async function resolveGlobalFile(): Promise<string> {
  await fs.mkdir(Global.Path.config, { recursive: true })
  return path.join(Global.Path.config, "opencode.jsonc")
}
