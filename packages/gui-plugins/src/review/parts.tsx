import { Match, Show, Switch } from "solid-js"
import { SessionReviewEmptyChangesV2 } from "@opencode/session-ui/v2/session-review-empty-changes-v2"
import { SessionReviewEmptyNoGitV2 } from "@opencode/session-ui/v2/session-review-empty-no-git-v2"
import { Button } from "@opencode/ui/button"
import { Select } from "@opencode/ui/select"
import { usePlugin } from "@opencode/plugin/gui"
import type Review from "./index"
import type { ReviewDiffFailure } from "./machine"
import type { ChangeMode, ReviewModel } from "./model"

export function ReviewTitle(props: { review: ReviewModel }) {
  const ctx = usePlugin()

  const label = (option: ChangeMode) => {
    if (option === "git") return ctx.t("ui.sessionReview.title.git")

    if (option === "branch") return ctx.t("ui.sessionReview.title.branch")

    return ctx.t("ui.sessionReview.title.lastTurn")
  }

  return (
    <Show when={props.review.canReview() && props.review.options().length > 0}>
      <Show
        when={props.review.options().length === 1 && props.review.options()[0]}
        fallback={
          <Select
            options={props.review.options()}
            current={props.review.mode()}
            label={label}
            placement="bottom-start"
            gutter={6}
            onSelect={(option) => option && props.review.setMode(option)}
          />
        }
      >
        {(only) => (
          <span class="inline-flex h-6 items-center ps-2 pe-1 text-[13px] leading-[var(--line-height-compact)] font-[530] tracking-[-0.04px] text-v2-text-text-base">
            {label(only())}
          </span>
        )}
      </Show>
    </Show>
  )
}

export function ReviewEmpty(props: { review: ReviewModel; loadingClass: string }) {
  const ctx = usePlugin()

  const text = () => {
    if (props.review.mode() === "git") return ctx.t("empty.git")

    if (props.review.mode() === "branch") return ctx.t("empty.branch")

    return ctx.t("noChanges")
  }

  return (
    <Switch>
      <Match when={props.review.diff().status === "loading"}>
        <div class={props.loadingClass}>{ctx.t("loadingChanges")}</div>
      </Match>
      <Match when={props.review.diff().status === "no-vcs"}>
        <div class="h-full flex flex-col">
          <SessionReviewEmptyNoGitV2 pending={props.review.initializingGit()} onInitGit={props.review.initializeGit} />
        </div>
      </Match>
      <Match when={props.review.diff().status === "offline" || props.review.diff().status === "error"}>
        <div class="h-full pb-64 -mt-4 flex flex-col items-center justify-center">
          <ReviewUnavailable review={props.review} />
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
  const ctx = usePlugin()

  return (
    <Switch>
      <Match when={props.review.diff().status === "loading"}>
        <div class="px-6 py-4 text-text-weak">{ctx.t("loadingChanges")}</div>
      </Match>
      <Match when={props.review.diff().status === "no-vcs"}>
        <SessionReviewEmptyNoGitV2 pending={props.review.initializingGit()} onInitGit={props.review.initializeGit} />
      </Match>
      <Match when={props.review.diff().status === "offline" || props.review.diff().status === "error"}>
        <div class="h-full flex flex-col items-center justify-center">
          <ReviewUnavailable review={props.review} />
        </div>
      </Match>
      <Match when={true}>
        <SessionReviewEmptyChangesV2 />
      </Match>
    </Switch>
  )
}

/** Why the changes cannot show: the server is unreachable, or their request failed and can be retried. */
function ReviewUnavailable(props: { review: ReviewModel }) {
  const failure = () => {
    const current = props.review.diff()

    return current.status === "error" ? current.failure : undefined
  }

  return <ReviewFailure failure={failure()} onRetry={() => props.review.retry()} />
}

/** A failed request with Try again, or without `failure` that the server is unreachable. */
export function ReviewFailure(props: { failure: ReviewDiffFailure | undefined; onRetry: () => void }) {
  const ctx = usePlugin<typeof Review>()

  return (
    <Show
      when={props.failure}
      keyed
      fallback={<div class="px-4 text-center text-14-regular text-text-weak max-w-56">{ctx.t("offline")}</div>}
    >
      {(failure) => (
        <div role="alert" class="flex flex-col items-center gap-3 px-4 text-center">
          <div class="flex flex-col gap-1">
            <div class="text-13-regular text-text-strong">{ctx.t("load.failed")}</div>
            <div class="text-12-regular text-text-weak break-words">
              {failure.type === "timeout" ? ctx.t("load.timeout") : failure.message}
            </div>
          </div>
          <Button size="small" variant="outline" onClick={() => props.onRetry()}>
            {ctx.t("common.retry")}
          </Button>
        </div>
      )}
    </Show>
  )
}
