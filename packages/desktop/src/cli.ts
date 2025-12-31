import { invoke } from "@tauri-apps/api/core"
import { message } from "@tauri-apps/plugin-dialog"

export async function isCliInstalled(): Promise<boolean> {
  return invoke<boolean>("is_cli_installed")
}

export async function getInstalledCliPath(): Promise<string | null> {
  return invoke<string | null>("get_installed_cli_path")
}

export async function installCli(): Promise<void> {
  try {
    const path = await invoke<string>("install_cli")
    await message(`CLI installed to ${path}\n\nRestart your terminal to use the 'opencode' command.`, {
      title: "CLI Installed",
    })
  } catch (e) {
    await message(`Failed to install CLI: ${e}`, { title: "Installation Failed" })
  }
}

export async function syncCli(): Promise<void> {
  try {
    await invoke("sync_cli")
  } catch (e) {
    console.error("Failed to sync CLI:", e)
  }
}
