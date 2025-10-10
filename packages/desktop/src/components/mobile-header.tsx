import { Icon, IconButton } from "@/ui"
import { Show } from "solid-js"

interface MobileHeaderProps {
  title: string
  showBack?: boolean
  onBack?: () => void
  onMenuClick?: () => void
  actions?: Array<{
    icon: string
    label: string
    onClick: () => void
  }>
}

export default function MobileHeader(props: MobileHeaderProps) {
  return (
    <header
      class="sticky top-0 z-40 bg-background-panel backdrop-blur-xl border-b border-border-subtle/30 shadow-sm"
      style={{
        "padding-top": "var(--safe-area-inset-top)",
      }}
    >
      <div class="flex items-center justify-between h-14 px-4">
        <div class="flex items-center gap-2 flex-1 min-w-0">
          <Show
            when={props.showBack}
            fallback={
              <Show when={props.onMenuClick}>
                <IconButton size="sm" variant="ghost" onClick={props.onMenuClick}>
                  <Icon name="menu" size={24} />
                </IconButton>
              </Show>
            }
          >
            <IconButton size="sm" variant="ghost" onClick={props.onBack}>
              <Icon name="arrow-left" size={24} />
            </IconButton>
          </Show>
          <h1 class="text-base font-semibold text-text truncate">{props.title}</h1>
        </div>
        <Show when={props.actions}>
          <div class="flex items-center gap-1">
            {props.actions?.map((action) => (
              <IconButton size="sm" variant="ghost" onClick={action.onClick} title={action.label}>
                <Icon name={action.icon as any} size={24} />
              </IconButton>
            ))}
          </div>
        </Show>
      </div>
    </header>
  )
}
