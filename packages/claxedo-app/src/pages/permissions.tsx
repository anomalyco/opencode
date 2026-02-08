/**
 * Permissions Settings Page
 *
 * Cloud-specific permissions management page.
 * Accessible via /permissions route.
 */

import { SettingsPermissions } from "@/components/settings-permissions"

export default function PermissionsPage() {
  return (
    <div class="p-8 max-w-4xl mx-auto">
      <SettingsPermissions />
    </div>
  )
}
