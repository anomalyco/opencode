import { Match, Show, Switch } from "solid-js"
import { Tabs } from "@opencode-ai/ui/tabs"

export function SessionMobileTabs(props: {
  open: boolean
  hasReview: boolean
  reviewCount: number
  onSession: () => void
  onChanges: () => void
  t: (key: string, vars?: Record<string, string | number | boolean>) => string
}) {
  return (
    <Show when={props.open}>
      <Tabs class="h-auto">
        <Tabs.List>
          <Tabs.Trigger value="session" class="w-1/2" classes={{ button: "w-full" }} onClick={props.onSession}>
            {props.t("session.tab.session")}
          </Tabs.Trigger>
          <Tabs.Trigger
            value="changes"
            class="w-1/2 !border-r-0"
            classes={{ button: "w-full" }}
            onClick={props.onChanges}
          >
            <Switch>
              <Match when={props.hasReview}>
                {props.t("session.review.filesChanged", { count: props.reviewCount })}
              </Match>
              <Match when={true}>{props.t("session.review.change.other")}</Match>
            </Switch>
          </Tabs.Trigger>
        </Tabs.List>
      </Tabs>
    </Show>
  )
}
