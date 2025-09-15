import { For } from "solid-js"
import { Icon, Link, Logo, Tooltip } from "@/ui"
import { useLocation } from "@solidjs/router"

const navigation = [
  { name: "Sessions", href: "/sessions", icon: "dashboard" as const },
  { name: "Commands", href: "/commands", icon: "slash" as const },
  { name: "Agents", href: "/agents", icon: "bolt" as const },
  { name: "Providers", href: "/providers", icon: "cloud" as const },
  { name: "Tools (MCP)", href: "/tools", icon: "hammer" as const },
  { name: "LSP", href: "/lsp", icon: "code" as const },
  { name: "Settings", href: "/settings", icon: "settings" as const },
]

export default function SidebarNav() {
  const location = useLocation()
  return (
    <div class="hidden md:fixed md:inset-y-0 md:left-0 md:z-50 md:block md:w-16 md:overflow-y-auto md:bg-background-panel md:pb-4">
      <div class="flex h-16 shrink-0 items-center justify-center">
        <Logo variant="mark" size={28} />
      </div>
      <nav class="mt-5">
        <ul role="list" class="flex flex-col items-center space-y-1">
          <For each={navigation}>
            {(item) => (
              <li>
                <Tooltip placement="right" value={item.name}>
                  <Link
                    href={item.href}
                    classList={{
                      "bg-background-element text-text": location.pathname.startsWith(item.href),
                      "text-text-muted hover:bg-background-element hover:text-text": location.pathname !== item.href,
                      "flex gap-x-3 rounded-md p-3 text-sm font-semibold": true,
                      "focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-border-active": true,
                    }}
                  >
                    <Icon name={item.icon} size={20} />
                    <span class="sr-only">{item.name}</span>
                  </Link>
                </Tooltip>
              </li>
            )}
          </For>
        </ul>
      </nav>
    </div>
  )
}
