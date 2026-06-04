/** @jsxImportSource @opentui/solid */
// securecode scode-alias TUI plugin.
//
// Registers the `/scode` slash command.
// - Alias not present → 確認ダイアログ → rc へ追記
// - Alias already present → 「既に設定済み」を info toast で通知して終了
//
// Loaded via INTERNAL_TUI_PLUGINS (packages/opencode/src/cli/cmd/tui/plugin/internal.ts).
// Users can opt out via `plugin_enabled: { "scode-alias": false }` in tui.json.
import { existsSync, appendFileSync, readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui"

const id = "scode-alias"

type RcInfo = { rc: string; line: string }

function detectPowerShellRc(home: string): RcInfo {
  // Prefer PS7 profile dir if it already exists, otherwise fall back to PS5.
  const ps7Dir = join(home, "Documents", "PowerShell")
  const ps5Dir = join(home, "Documents", "WindowsPowerShell")
  const psDir = existsSync(ps7Dir) ? ps7Dir : ps5Dir
  return { rc: join(psDir, "Microsoft.PowerShell_profile.ps1"), line: "Set-Alias scode securecode" }
}

function detectShellRc(): RcInfo | undefined {
  const shell = process.env.SHELL ?? ""
  // Normalise path separators so Windows shell paths (e.g. C:\...\pwsh.exe) parse correctly.
  const shellName = shell.replace(/\\/g, "/").split("/").pop()?.toLowerCase() ?? ""
  const home = process.env.HOME ?? process.env.USERPROFILE
  if (!home) return undefined

  switch (shellName) {
    case "fish":
      return { rc: join(home, ".config", "fish", "config.fish"), line: "alias scode securecode" }
    case "zsh":
      return { rc: join(process.env.ZDOTDIR ?? home, ".zshrc"), line: "alias scode='securecode'" }
    case "bash":
    case "bash.exe":
      return { rc: join(home, ".bashrc"), line: "alias scode='securecode'" }
    case "powershell.exe":
    case "pwsh.exe":
    case "pwsh":
      return detectPowerShellRc(home)
    default:
      // On Windows $SHELL is typically unset; infer PowerShell from platform or env.
      if (process.platform === "win32" || process.env.PSModulePath) {
        return detectPowerShellRc(home)
      }
      return undefined
  }
}

function shortenPath(p: string): string {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? ""
  return home && p.startsWith(home) ? "~" + p.slice(home.length) : p
}

function isAliasInstalled(info: RcInfo): boolean {
  try {
    if (!existsSync(info.rc)) return false
    return readFileSync(info.rc, "utf-8").split("\n").some((l) => l.trim() === info.line)
  } catch {
    return false
  }
}

function writeAlias(api: TuiPluginApi, info: RcInfo): void {
  try {
    if (!existsSync(info.rc)) {
      const sep = info.rc.includes("/") ? "/" : "\\"
      const parent = info.rc.substring(0, info.rc.lastIndexOf(sep))
      if (parent) mkdirSync(parent, { recursive: true })
      writeFileSync(info.rc, "")
    }
    appendFileSync(info.rc, `\n# Acompany SecureCode alias\n${info.line}\n`)
    api.ui.toast({ variant: "success", message: `Added scode alias to ${shortenPath(info.rc)}. Open a new shell to use it.` })
  } catch (e) {
    api.ui.toast({ variant: "error", message: `Failed to add alias: ${e instanceof Error ? e.message : String(e)}` })
  }
}

// Uses props.api.ui.DialogConfirm (via component props, not closure) to match
// the pattern used in plugins.tsx — accessing the dialog component through the
// Solid.js reactive props object avoids TextNodeRenderable rendering errors.
function InstallView(props: { api: TuiPluginApi; info: RcInfo }) {
  const short = shortenPath(props.info.rc)
  return (
    <props.api.ui.DialogConfirm
      title="Add scode alias"
      message={`Append "${props.info.line}" to ${short}`}
      onConfirm={() => writeAlias(props.api, props.info)}
    />
  )
}

const tui: TuiPlugin = async (api) => {
  api.keymap.registerLayer({
    commands: [
      {
        name: "scode.alias.setup",
        title: "Set up scode alias",
        category: "System",
        slashName: "scode",
        namespace: "palette",
        run() {
          const info = detectShellRc()
          if (!info) {
            api.ui.toast({ variant: "error", message: "Unsupported shell. Set $SHELL to bash, zsh, or fish." })
            return
          }
          if (isAliasInstalled(info)) {
            api.ui.toast({ variant: "info", message: `scode alias is already set in ${shortenPath(info.rc)}. To remove it, delete the line manually.` })
            return
          }
          api.ui.dialog.replace(() => <InstallView api={api} info={info} />)
        },
      },
    ],
  })
}

const plugin: TuiPluginModule & { id: string } = {
  id,
  tui,
}

export default plugin
