import { invoke } from "@tauri-apps/api/core"
import { message } from "@tauri-apps/plugin-dialog"

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
