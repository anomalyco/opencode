import { Show } from "solid-js"
import { Tabs } from "@opencode-ai/ui/tabs"

export function SessionMobileTabs(props: {
  open: boolean
  mobileTab: "session" | "changes"
  hasReview: boolean
  reviewCount: number
  onSession: () => void
  onChanges: () => void
  t: (key: string, vars?: Record<string, string | number | boolean>) => string
}) {
  return (
    <Show when={props.open}>
      <Tabs value={props.mobileTab} class="h-auto">
        <Tabs.List>
          <Tabs.Trigger
            value="session"
            class="!w-1/2 !max-w-none"
            classes={{ button: "w-full" }}
            onClick={props.onSession}
          >
            {props.t("session.tab.session")}
          </Tabs.Trigger>
          <Tabs.Trigger
            value="changes"
            class="!w-1/2 !max-w-none !border-r-0"
            classes={{ button: "w-full" }}
            onClick={props.onChanges}
          >
            {props.hasReview
              ? props.t("session.review.filesChanged", { count: props.reviewCount })
              : props.t("session.review.change.other")}
          </Tabs.Trigger>
        </Tabs.List>
      </Tabs>
    </Show>
  )
}
