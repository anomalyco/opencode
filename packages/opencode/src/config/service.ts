import path from "path"
import { Global } from "../global"

export interface ConfigPaths {
  global: string
  project: string | null
}

export interface ConfigService {
  getConfigPaths(cwd?: string): Promise<ConfigPaths>
  readConfigFile(path: string): Promise<string>
  writeConfigFile(path: string, content: string): Promise<void>
}

async function findConfigFile(startDir: string, filenames: string[]): Promise<string | null> {
  let current = path.resolve(startDir)

  for (let i = 0; i < 20; i++) {
    for (const filename of filenames) {
      const filePath = path.join(current, filename)
      if (await Bun.file(filePath).exists()) {
        return filePath
      }
    }

    const parent = path.dirname(current)
    if (parent === current) break
    current = parent
  }

  return null
}

function getGlobalConfigPath(): string {
  return path.join(Global.Path.config, "opencode.json")
}

export const NodeConfigService: ConfigService = {
  async getConfigPaths(cwd?: string): Promise<ConfigPaths> {
    const globalPath = getGlobalConfigPath()

    let projectPath: string | null = null
    if (cwd) {
      projectPath = await findConfigFile(cwd, ["opencode.jsonc", "opencode.json"])
    }

    return { global: globalPath, project: projectPath }
  },

  async readConfigFile(filePath: string): Promise<string> {
    return Bun.file(filePath).text()
  },

  async writeConfigFile(filePath: string, content: string): Promise<void> {
    const dir = path.dirname(filePath)
    await Bun.write(path.join(dir, path.basename(filePath)), content)
  },
}
