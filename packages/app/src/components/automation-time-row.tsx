import { IconButton } from "@opencode-ai/ui/icon-button"
import { Select } from "@opencode-ai/ui/select"
import { createMemo, type Component } from "solid-js"

interface TimeRowProps {
  index: number
  value: string
  hours: string[]
  minutes: string[]
  removeLabel: string
  onChange: (value: string) => void
  onRemove: () => void
}

export const AutomationTimeRow: Component<TimeRowProps> = (props) => {
  const parts = createMemo(() => props.value.split(":"))
  const hour = () => (parts()[0] ?? "00").padStart(2, "0")
  const minute = () => (parts()[1] ?? "00").padStart(2, "0")

  const setHour = (value?: string) => {
    if (!value) return
    props.onChange(`${value}:${minute()}`)
  }

  const setMinute = (value?: string) => {
    if (!value) return
    props.onChange(`${hour()}:${value}`)
  }

  return (
    <div class="group flex items-center gap-2 rounded-md bg-surface-base px-2.5 py-2 transition-colors hover:bg-surface-base-hover">
      <div class="size-6 rounded-full border border-border-weak-base bg-surface-raised-base text-11-medium text-text-weak flex items-center justify-center">
        {props.index + 1}
      </div>
      <div class="flex-1 flex items-center gap-2">
        <Select
          options={props.hours}
          current={hour()}
          value={(value) => value}
          label={(value) => value}
          onSelect={setHour}
          size="small"
          variant="secondary"
          valueClass="font-mono text-12-medium"
          triggerStyle={{ "min-width": "72px" }}
          portal={false}
        />
        <span class="text-12-medium text-text-weak">:</span>
        <Select
          options={props.minutes}
          current={minute()}
          value={(value) => value}
          label={(value) => value}
          onSelect={setMinute}
          size="small"
          variant="secondary"
          valueClass="font-mono text-12-medium"
          triggerStyle={{ "min-width": "72px" }}
          portal={false}
        />
      </div>
      <IconButton
        type="button"
        icon="trash"
        variant="ghost"
        onClick={props.onRemove}
        aria-label={props.removeLabel}
        class="shrink-0 opacity-70 group-hover:opacity-100"
      />
    </div>
  )
}
