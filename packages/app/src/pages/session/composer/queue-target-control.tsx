import { MenuV2 } from "@opencode-ai/ui/v2/menu-v2"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { Icon } from "@opencode-ai/ui/icon"
import { TooltipV2 } from "@opencode-ai/ui/v2/tooltip-v2"
import { useLanguage } from "@/context/language"
import type { FollowupTarget } from "@/components/prompt-input/submit"

const TARGETS: FollowupTarget[] = ["steer", "current-stream", "followup", "sub-session"]

export function QueueTargetControl(props: {
  target: FollowupTarget
  onChange: (target: FollowupTarget) => void
}) {
  const language = useLanguage()
  const labels: Record<FollowupTarget, string> = {
    steer: language.t("prompt.queue.target.steer"),
    "current-stream": language.t("prompt.queue.target.current-stream"),
    followup: language.t("prompt.queue.target.followup"),
    "sub-session": language.t("prompt.queue.target.sub-session"),
  }

  return (
    <MenuV2 gutter={6} modal={false} placement="top-start">
      <MenuV2.Trigger
        as={ButtonV2}
        variant="ghost-muted"
        size="normal"
        class="max-w-[175px] justify-start ![font-weight:440]"
      >
        <span class="truncate leading-5">{labels[props.target]}</span>
        <span class="-ml-0.5 -mr-1 flex shrink-0">
          <Icon name="chevron-down" size="small" />
        </span>
      </MenuV2.Trigger>
      <MenuV2.Portal>
        <MenuV2.Content>
          <MenuV2.RadioGroup
            value={props.target}
            onChange={(value) => props.onChange(value as FollowupTarget)}
          >
            {TARGETS.map((value) => (
              <TooltipV2
                placement="right"
                value={language.t(`prompt.queue.target.${value}.description`)}
              >
                <MenuV2.RadioItem value={value}>{labels[value]}</MenuV2.RadioItem>
              </TooltipV2>
            ))}
          </MenuV2.RadioGroup>
        </MenuV2.Content>
      </MenuV2.Portal>
    </MenuV2>
  )
}
