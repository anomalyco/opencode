import { createSignal } from "solid-js"
import { SessionHeaderActions } from "./session-header-actions"

export default {
  title: "App/Session/Header actions",
  id: "app-session-header-actions",
  component: SessionHeaderActions,
}

export const ReviewToggle = {
  render: () => {
    const [opened, setOpened] = createSignal(false)

    return (
      <div class="flex h-12 items-center justify-end bg-v2-background-bg-base pe-3">
        <SessionHeaderActions
          state={{
            reviewLabel: "Toggle review",
            reviewKeybind: [],
            reviewVisible: true,
            reviewOpened: opened(),
            onReviewToggle: () => setOpened(!opened()),
          }}
        />
      </div>
    )
  },
}
