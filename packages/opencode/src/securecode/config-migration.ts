import fs from "fs/promises"
import path from "path"
import os from "os"

function securecodeConfigPath() {
  const base = process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config")
  return path.join(base, "securecode", "securecode.json")
}

/**
 * Ensures lsp.eslint.disabled is set in the user's securecode config.
 * ESLint LSP server loads .eslintrc.js via Node require(), enabling RCE
 * from malicious repos. We disable it by default for all users.
 * Returns true if the config was updated.
 */
export async function migrateLspEslintDisabled(): Promise<boolean> {
  const configPath = securecodeConfigPath()
  try {
    const content = await fs.readFile(configPath, "utf-8")
    const config = JSON.parse(content)
    if (config.lsp !== undefined) return false
    config.lsp = { eslint: { disabled: true } }
    await fs.writeFile(configPath, JSON.stringify(config, null, 2) + "\n")
    return true
  } catch {
    return false
  }
}
