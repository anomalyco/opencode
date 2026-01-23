import { Show } from "solid-js"
import { DropdownMenu } from "@opencode-ai/ui/dropdown-menu"
import { Button } from "@opencode-ai/ui/button"
import { useSession } from "@/context/session"
import { useServer } from "@/context/server"

/**
 * Session indicator component that shows the logged-in username
 * with a dropdown menu for logout.
 *
 * Only renders when user is authenticated.
 */
export function SessionIndicator() {
  const session = useSession()
  const server = useServer()

  /**
   * Handle logout by POSTing to /auth/logout endpoint.
   */
  async function handleLogout(): Promise<void> {
    try {
      const url = server.url
      if (!url) return

      const res = await fetch(`${url}/auth/logout`, {
        method: "POST",
        credentials: "include",
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

  return (
    <Show when={session.isAuthenticated()}>
      <DropdownMenu>
        <DropdownMenu.Trigger
          as={Button}
          variant="ghost"
          size="small"
          class="text-text-base hover:bg-surface-base-active"
        >
          {session.username()}
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content class="mt-1">
            <DropdownMenu.Group>
              <DropdownMenu.GroupLabel class="text-text-muted px-2 py-1.5 text-xs">
                {session.username()}
              </DropdownMenu.GroupLabel>
            </DropdownMenu.Group>
            <DropdownMenu.Separator />
            <DropdownMenu.Item onSelect={handleLogout}>
              <DropdownMenu.ItemLabel>Log out</DropdownMenu.ItemLabel>
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu>
    </Show>
  )
}
