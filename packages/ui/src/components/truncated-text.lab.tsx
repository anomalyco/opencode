import { TruncatedText } from "./truncated-text"

const args = { text: "Workspace tools for shared development environments", width: 216, rtl: false }

function Preview(props: typeof args) {
  return (
    <div class="grid w-96 max-w-full gap-2 text-sm">
      <div class="font-medium">Extension name</div>
      <p class="text-xs text-v2-text-text-muted">
        Hover or focus a clipped name to read it. On touch screens the name wraps.
      </p>
      <div
        dir={props.rtl ? "rtl" : undefined}
        style={{ width: `${props.width}px` }}
        class="flex max-w-full rounded-md border border-v2-border-border-base p-2"
      >
        <TruncatedText text={props.text} />
      </div>
    </div>
  )
}

export default {
  title: "UI/TruncatedText",
  id: "ui-truncated-text",
  component: Preview,
  args,
  argTypes: { width: { control: { type: "range", min: 96, max: 384, step: 8 } } },
}

export const Truncated = {}

export const Fits = { args: { text: "Workspace tools" } }

export const Unbroken = { args: { text: "workspace-development-environment-configuration-tools", width: 136 } }

export const MixedDirection = { args: { rtl: true, text: "أدوات المشروع — Workspace tools v2", width: 160 } }
