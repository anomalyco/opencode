import { Show } from "solid-js"
import { DropdownMenu } from "@opencode-ai/ui/dropdown-menu"
import { useAuth } from "../context/auth"

/**
 * 用户菜单组件
 * 显示用户头像和登出选项
 */
export const UserMenu = () => {
  const auth = useAuth()

  return (
    <Show when={auth.isAuthenticated && auth.user}>
      <DropdownMenu placement="right">
        <DropdownMenu.Trigger
          class="w-10 h-10 rounded-full bg-surface-raised-base flex items-center justify-center text-14-semibold text-text-strong cursor-pointer hover:bg-surface-raised-base-hover transition-colors"
          aria-label="User menu"
        >
          {auth.user!.username.charAt(0).toUpperCase()}
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content class="min-w-48 p-1">
            <div class="px-3 py-2 text-14-regular text-text-base border-b border-border-base mb-1">
              <div class="font-medium text-text-strong">{auth.user!.username}</div>
              <Show when={auth.user!.workspace}>
                <div class="text-12-regular text-text-weak truncate">{auth.user!.workspace}</div>
              </Show>
            </div>
            <DropdownMenu.Item
              class="flex items-center gap-2 px-3 py-2 text-14-regular text-danger-base hover:bg-danger-surface rounded-md cursor-pointer"
              onSelect={() => {
                auth.logout()
                window.location.reload()
              }}
            >
              <span class="i-opencode-log-out w-4 h-4" />
              Sign out
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu>
    </Show>
  )
}
