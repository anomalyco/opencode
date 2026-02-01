import { createEffect, createSignal, Show } from "solid-js"
import { DropdownMenu } from "@opencode-ai/ui/dropdown-menu"
import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useSession } from "@/context/session"
import { useServer } from "@/context/server"
import { ManageTwoFactorDialog } from "@/components/2fa/manage-2fa-dialog"

/**
 * Get CSRF token from cookie.
 */
function getCsrfToken(): string | undefined {
  const match = document.cookie.match(/opencode_csrf=([^;]+)/)
  return match ? match[1] : undefined
}

/**
 * Device trust status from the server.
 */
interface DeviceTrustStatus {
  twoFactorEnabled: boolean
  twoFactorConfigured: boolean
  twoFactorOptedOut: boolean
  deviceTrusted: boolean
}

/**
 * Session indicator component that shows the logged-in username
 * with a dropdown menu for logout.
 *
 * Only renders when user is authenticated.
 */
export function SessionIndicator() {
  const session = useSession()
  const server = useServer()
  const dialog = useDialog()
  const [deviceTrustStatus, setDeviceTrustStatus] = createSignal<DeviceTrustStatus | null>(null)

  // Fetch device trust status on mount
  const fetchDeviceTrustStatus = async () => {
    if (!session.isAuthenticated()) return

    const url = server.url
    if (!url) return

    try {
      const res = await fetch(`${url}/auth/device-trust/status`, {
        credentials: "include",
      })
      const data = (await res.json()) as DeviceTrustStatus
      setDeviceTrustStatus(data)
    } catch {
      // Silently fail - device trust features will just not show
      setDeviceTrustStatus(null)
    }
  }

  createEffect(() => {
    void fetchDeviceTrustStatus()
  })

  /**
   * Handle logout by POSTing to /auth/logout endpoint.
   */
  async function handleLogout(): Promise<void> {
    try {
      const url = server.url
      if (!url) return

      const csrfToken = getCsrfToken()
      const headers: Record<string, string> = {}
      if (csrfToken) {
        headers["X-CSRF-Token"] = csrfToken
      }

      const res = await fetch(`${url}/auth/logout`, {
        method: "POST",
        credentials: "include",
        headers,
      })

      // Logout endpoint returns 302 redirect, but fetch doesn't follow redirects
      // from cross-origin POST requests automatically. Redirect manually.
      if (res.status === 302 || res.ok) {
        window.location.href = `${url}/auth/login`
      }
    } catch (err) {
      console.error("Logout failed:", err)
    }
  }

  /**
   * Handle logout all sessions by POSTing to /auth/logout/all endpoint.
   * This also clears device trust as a security measure.
   */
  async function handleLogoutAll(): Promise<void> {
    try {
      const url = server.url
      if (!url) return

      const csrfToken = getCsrfToken()
      const headers: Record<string, string> = {}
      if (csrfToken) {
        headers["X-CSRF-Token"] = csrfToken
      }

      const res = await fetch(`${url}/auth/logout/all`, {
        method: "POST",
        credentials: "include",
        headers,
      })

      if (res.status === 302 || res.ok) {
        window.location.href = `${url}/auth/login`
      }
    } catch (err) {
      console.error("Logout all failed:", err)
    }
  }

  /**
   * Revoke device trust, requiring 2FA on next login.
   */
  async function handleForgetDevice(): Promise<void> {
    try {
      const url = server.url
      if (!url) return

      const csrfToken = getCsrfToken()
      const headers: Record<string, string> = {}
      if (csrfToken) {
        headers["X-CSRF-Token"] = csrfToken
      }

      const res = await fetch(`${url}/auth/device-trust/revoke`, {
        method: "POST",
        credentials: "include",
        headers,
      })

      if (res.ok) {
        // Update local state to reflect that device is no longer trusted
        setDeviceTrustStatus((prev) => (prev ? { ...prev, deviceTrusted: false } : null))
      }
    } catch (err) {
      console.error("Forget device failed:", err)
    }
  }

  /**
   * Navigate to 2FA setup page.
   */
  function handleSetup2FA(): void {
    const url = server.url
    if (!url) return
    // Open 2FA setup in new tab (could be external documentation or setup page)
    window.open(`${url}/auth/2fa/setup`, "_blank")
  }

  function handleManage2FA(): void {
    dialog.show(() => <ManageTwoFactorDialog onUpdate={fetchDeviceTrustStatus} />)
  }

  const showDeviceTrustOptions = () => {
    const status = deviceTrustStatus()
    return status && status.twoFactorEnabled
  }

  const isTwoFactorConfigured = () => deviceTrustStatus()?.twoFactorConfigured ?? false
  const isTwoFactorOptedOut = () => deviceTrustStatus()?.twoFactorOptedOut ?? false

  const isDeviceTrusted = () => {
    const status = deviceTrustStatus()
    return status?.deviceTrusted ?? false
  }

  return (
    <Show when={session.isAuthenticated()}>
      <DropdownMenu>
        <DropdownMenu.Trigger
          as={Button}
          variant="ghost"
          size="small"
          class="text-text-base hover:bg-surface-base-active flex items-center gap-1"
        >
          {session.username()}
          <Icon name="chevron-down" size="small" />
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content class="mt-1">
            <DropdownMenu.Group>
              <DropdownMenu.GroupLabel class="text-text-muted px-2 py-1.5 text-xs">
                {session.username()}
              </DropdownMenu.GroupLabel>
            </DropdownMenu.Group>
            <Show when={showDeviceTrustOptions()}>
              <DropdownMenu.Separator />
              <Show when={isDeviceTrusted()}>
                <DropdownMenu.Item onSelect={handleForgetDevice}>
                  <DropdownMenu.ItemLabel>Forget this device (require 2FA)</DropdownMenu.ItemLabel>
                </DropdownMenu.Item>
              </Show>
              <DropdownMenu.Item onSelect={isTwoFactorConfigured() ? handleManage2FA : handleSetup2FA}>
                <DropdownMenu.ItemLabel>
                  {isTwoFactorConfigured() ? "Manage 2FA" : isTwoFactorOptedOut() ? "Enable 2FA" : "Set up 2FA"}
                </DropdownMenu.ItemLabel>
              </DropdownMenu.Item>
            </Show>
            <DropdownMenu.Separator />
            <DropdownMenu.Item onSelect={handleLogout}>
              <DropdownMenu.ItemLabel>Log out</DropdownMenu.ItemLabel>
            </DropdownMenu.Item>
            <DropdownMenu.Item onSelect={handleLogoutAll}>
              <DropdownMenu.ItemLabel>Log out all sessions</DropdownMenu.ItemLabel>
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu>
    </Show>
  )
}
