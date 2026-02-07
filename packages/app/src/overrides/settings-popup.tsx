import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { Popover } from "@opencode-ai/ui/popover"

export function SettingsPopup(props: { onRun: () => void }) {
  return (
    <Popover
      title="Settings"
      description="Custom settings for your fork."
      gutter={6}
      placement="bottom-end"
      class="rounded-xl [&_[data-slot=popover-close-button]]:hidden"
      triggerAs={Button}
      triggerProps={{
        variant: "secondary",
        class: "rounded-sm h-[24px] w-[24px] p-0",
        style: { scale: 1 },
        "aria-label": "Settings",
        onClick: props.onRun,
      }}
      trigger={<Icon name="settings-gear" size="small" class="text-icon-base" />}
    >
      <div class="flex flex-col gap-2 text-12-regular text-text-strong">
        <div class="flex items-center gap-2">
          <Icon name="settings-gear" size="small" class="text-icon-base" />
          <span>Settings popup content goes here.</span>
        </div>
      </div>
    </Popover>
  )
}
