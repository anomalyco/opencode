import { Match, Show, Switch } from "solid-js"
import { SessionReviewEmptyChangesV2 } from "@opencode/session-ui/v2/session-review-empty-changes-v2"
import { Select } from "@opencode/ui/select"
import { useExtension } from "../sdk"
import type { ChangeMode, ReviewModel } from "./model"

export function ReviewTitle(props: { review: ReviewModel }) {
  const ctx = useExtension()
  const label = (option: ChangeMode) => {
    if (option === "git") return ctx.t("ui.sessionReview.title.git")
    if (option === "branch") return ctx.t("ui.sessionReview.title.branch")
    return ctx.t("ui.sessionReview.title.lastTurn")
  }
  return (
    <Show when={props.review.canReview()}>
      <Select
        options={props.review.options()}
        current={props.review.mode()}
        label={label}
        placement="bottom-start"
        gutter={6}
        onSelect={(option) => option && props.review.setMode(option)}
      />
    </Show>
  )
}

export function ReviewEmpty(props: { review: ReviewModel; loadingClass: string }) {
  const ctx = useExtension()
  const loading = () => (props.review.mode() === "git" || props.review.mode() === "branch") && !props.review.ready()
  const noGit = () => props.review.noGit()
  const text = () => {
    if (props.review.mode() === "git") return ctx.t("empty.git")
    if (props.review.mode() === "branch") return ctx.t("empty.branch")
    return ctx.t("noChanges")
  }
  return (
    <Switch>
      <Match when={loading()}>
        <div class={props.loadingClass}>{ctx.t("loadingChanges")}</div>
      </Match>
      <Match when={noGit()}>
        <div class="h-full pb-64 -mt-4 flex flex-col items-center justify-center text-center gap-6">
          <div class="flex flex-col gap-3">
            <div class="text-14-medium text-text-strong">{ctx.t("git.title")}</div>
            <div class="text-14-regular text-text-base max-w-md" style={{ "line-height": "var(--line-height-normal)" }}>
              {ctx.t("git.description")}
            </div>
          </div>
        </div>
      </Match>
      <Match when={true}>
        <div class="h-full pb-64 -mt-4 flex flex-col items-center justify-center text-center gap-6">
          <div class="text-14-regular text-text-weak max-w-56">{text()}</div>
        </div>
      </Match>
    </Switch>
  )
}

export function ReviewPanelEmpty(props: { review: ReviewModel }) {
  const ctx = useExtension()
  const loading = () => (props.review.mode() === "git" || props.review.mode() === "branch") && !props.review.ready()
  const noGit = () => props.review.noGit()
  return (
    <Switch>
      <Match when={loading()}>
        <div class="px-6 py-4 text-text-weak">{ctx.t("loadingChanges")}</div>
      </Match>
      <Match when={noGit()}>
        <div class="h-full pb-64 -mt-4 flex flex-col items-center justify-center text-center gap-6">
          <div class="text-14-regular text-text-weak max-w-56">{ctx.t("git.description")}</div>
        </div>
      </Match>
      <Match when={true}>
        <SessionReviewEmptyChangesV2 />
      </Match>
    </Switch>
  )
}
