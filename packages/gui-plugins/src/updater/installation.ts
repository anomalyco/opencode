import { existsSync } from "node:fs"
import { join } from "node:path"

export function disabledReason(resources: string, flatpakID: string | undefined) {
  // The Flathub package retains the update feed from the .deb it unpacks.
  if (flatpakID) return "updates are managed by Flatpak"
  if (!existsSync(join(resources, "app-update.yml"))) return "app-update.yml is missing"
}
