/**
 * Config Settings Page
 *
 * Cloud-specific configuration management page.
 * Accessible via /config route.
 */

import { SettingsGeneral } from "@/components/settings-general"

export default function ConfigPage() {
  return (
    <div class="p-8 max-w-4xl mx-auto">
      <SettingsGeneral />
    </div>
  )
}
