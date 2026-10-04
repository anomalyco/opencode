// @ts-nocheck
import { Show } from "solid-js"
import { createStore } from "solid-js/store"
import { LayoutRetirementNotice, LayoutTransitionToggle } from "./interface-transition"

const copy = {
  title: "New layout",
  badge: "New",
  description: "Use the new tabs and home layout. Switch between layouts for a limited time.",
  noticeTitle: "You're now using new layout",
  noticeDescription: "The previous layout is no longer available",
  dismiss: "Dismiss",
}

function Frame(props) {
  return <div class="w-[640px] max-w-full">{props.children}</div>
}

function ToggleExample(props) {
  const [state, setState] = createStore({ checked: props.checked })
  return (
    <Frame>
      <LayoutTransitionToggle
        title={copy.title}
        badge={copy.badge}
        description={copy.description}
        checked={state.checked}
        onChange={(checked) => setState("checked", checked)}
      />
    </Frame>
  )
}

function NoticeExample() {
  const [state, setState] = createStore({ dismissed: false })
  return (
    <Frame>
      <Show when={!state.dismissed} fallback={<span class="text-v2-text-text-muted">Notice dismissed</span>}>
        <LayoutRetirementNotice
          title={copy.noticeTitle}
          description={copy.noticeDescription}
          dismiss={copy.dismiss}
          onDismiss={() => setState("dismissed", true)}
        />
      </Show>
    </Frame>
  )
}

export default {
  title: "App/Settings/Layout transition",
  id: "app-settings-layout-transition",
  component: LayoutTransitionToggle,
}

export const NewLayoutEnabled = {
  render: () => <ToggleExample checked />,
}

export const PreviousLayoutEnabled = {
  render: () => <ToggleExample checked={false} />,
}

export const PreviousLayoutRetired = {
  render: () => <NoticeExample />,
}

export const AllStates = {
  render: () => (
    <div class="flex flex-col gap-8">
      <ToggleExample checked />
      <ToggleExample checked={false} />
      <NoticeExample />
    </div>
  ),
}
