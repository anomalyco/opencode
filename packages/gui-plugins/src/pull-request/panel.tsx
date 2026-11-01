import { For, Show, createMemo } from "solid-js"
import { createQuery } from "@tanstack/solid-query"
import { usePlugin, type IconName, type MountedSession } from "@opencode/plugin/gui"
import { PullRequest } from "@opencode/schema/pull-request"
import { Button } from "@opencode/ui/button"
import { Icon } from "@opencode/ui/icon"
import { Loader } from "@opencode/ui/loader"
import type definition from "./index"

export default function PullRequestPanel(props: { session: MountedSession }) {
  const ctx = usePlugin<typeof definition>()

  const branch = () =>
    props.session.server.data.location.vcs.info({ directory: props.session.directory })?.branch.current

  const key = () => `${props.session.server.id}\u0000${props.session.directory}\u0000${branch() ?? ""}`

  const request = createQuery(() => ({
    queryKey: [ctx.id, key()],
    enabled: props.session.server.connected,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: "always" as const,
    gcTime: 0,
    queryFn: async (input) => {
      const current = key()

      const result = await props.session.server.client.rpc(PullRequest.Definition).get(
        {},
        {
          location: { directory: props.session.directory },
          signal: input.signal,
        },
      )

      return { key: current, result }
    },
  }))

  const value = () => (request.data?.key === key() ? request.data.result : undefined)

  const snapshot = createMemo(() => {
    const current = value()

    return current?.status === "available" ? current : undefined
  })

  const unavailable = () => {
    const current = value()

    return current?.status === "unavailable" ? ctx.t(`unavailable.${current.reason}`) : undefined
  }

  const reviewState = (state: string) => {
    if (
      state === "APPROVED" ||
      state === "CHANGES_REQUESTED" ||
      state === "COMMENTED" ||
      state === "DISMISSED" ||
      state === "PENDING"
    )
      return ctx.t(`review.${state}`)

    return ctx.t("review.unknown")
  }

  return (
    <section
      class="h-full min-h-0 overflow-y-auto p-4 flex flex-col gap-4 text-13-regular"
      data-scrollable
      aria-label={ctx.t("title")}
    >
      <div class="flex items-center justify-between gap-3">
        <h2 class="font-medium">{ctx.t("title")}</h2>
        <Button
          size="small"
          variant="ghost"
          icon="refresh"
          disabled={request.isFetching || !props.session.server.connected}
          onClick={() => void request.refetch()}
        >
          {ctx.t("refresh")}
        </Button>
      </div>
      <p class="text-v2-text-text-muted">{ctx.t("snapshot")}</p>
      <Show when={!props.session.server.connected}>
        <p role="status">{ctx.t("disconnected")}</p>
      </Show>
      <Show when={request.isFetching}>
        <p role="status" class="flex items-center gap-2">
          <Loader />
          {ctx.t(snapshot() ? "refreshing" : "loading")}
        </p>
      </Show>
      <Show when={request.isError}>
        <p role="alert">{ctx.t(snapshot() ? "stale" : "failed")}</p>
      </Show>
      <Show when={unavailable()}>{(message) => <p role="status">{message()}</p>}</Show>
      <Show when={snapshot()}>
        {(pr) => (
          <>
            <div class="flex flex-col gap-2">
              <h3 class="font-medium break-words">
                <bdi>
                  #{pr().number} {pr().title}
                </bdi>
              </h3>
              <p>{ctx.t(pr().state === "OPEN" && pr().draft ? "draft" : `state.${pr().state}`)}</p>
              <Button size="small" variant="ghost" onClick={() => ctx.system.openExternal(pr().url)}>
                {ctx.t("open")}
              </Button>
            </div>
            <dl class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2">
              <dt>{ctx.t("branch")}</dt>
              <dd class="break-all">
                <bdi dir="ltr">
                  <code>{pr().branch}</code>
                </bdi>
              </dd>
              <dt>{ctx.t("base")}</dt>
              <dd class="break-all">
                <bdi dir="ltr">
                  <code>{pr().base}</code>
                </bdi>
              </dd>
              <dt>{ctx.t("localHead")}</dt>
              <dd>
                <bdi dir="ltr">
                  <code title={pr().localHead}>{pr().localHead.slice(0, 7)}</code>
                </bdi>
              </dd>
              <dt>{ctx.t("head")}</dt>
              <dd>
                <bdi dir="ltr">
                  <code title={pr().head}>{pr().head.slice(0, 7)}</code>
                </bdi>
              </dd>
            </dl>
            <Show when={pr().localHead !== pr().head}>
              <p role="status">{ctx.t("differentHead")}</p>
            </Show>
            <Show when={pr().incomplete}>
              <p role="status">{ctx.t("incomplete")}</p>
            </Show>
            <section class="flex flex-col gap-2" aria-label={ctx.t("checks")}>
              <h3 class="font-medium">{ctx.t("checks")}</h3>
              <Show when={pr().checksCommit === pr().head} fallback={<p>{ctx.t("oldChecks")}</p>}>
                <For each={pr().checks} fallback={<p class="text-v2-text-text-muted">{ctx.t("noChecks")}</p>}>
                  {(check) => (
                    <div class="flex items-start gap-2">
                      <Icon name={checkIcon(check.state)} class="shrink-0" />
                      <div class="min-w-0 flex-1 break-words">
                        <Show when={check.url} fallback={<bdi>{check.name}</bdi>}>
                          {(url) => (
                            <a href={url()} target="_blank" rel="noreferrer">
                              <bdi>{check.name}</bdi>
                            </a>
                          )}
                        </Show>
                        <span class="block text-v2-text-text-muted">{ctx.t(`check.${check.state}`)}</span>
                      </div>
                    </div>
                  )}
                </For>
              </Show>
            </section>
            <section class="flex flex-col gap-2" aria-label={ctx.t("reviews")}>
              <h3 class="font-medium">{ctx.t("reviews")}</h3>
              <Show when={!pr().reviews.some((review) => review.commit === pr().head)}>
                <p class="text-v2-text-text-muted">{ctx.t("noReviews")}</p>
              </Show>
              <For each={pr().reviews}>
                {(review) => (
                  <div class="flex flex-col gap-1">
                    <a href={review.url} target="_blank" rel="noreferrer">
                      <bdi>{review.author || ctx.t("unknownAuthor")}</bdi>: {reviewState(review.state)}
                    </a>
                    <span class="text-v2-text-text-muted">
                      {ctx.t(
                        review.commit === null
                          ? "unknownCommit"
                          : review.commit === pr().head
                            ? "currentCommit"
                            : "earlierCommit",
                      )}
                    </span>
                  </div>
                )}
              </For>
            </section>
            <section class="flex flex-col gap-2" aria-label={ctx.t("threads")}>
              <h3 class="font-medium">{ctx.t("threads")}</h3>
              <For each={pr().threads} fallback={<p class="text-v2-text-text-muted">{ctx.t("noThreads")}</p>}>
                {(thread) => (
                  <article class="flex flex-col gap-1 border-t border-v2-border-border-base pt-2">
                    <a href={thread.url} target="_blank" rel="noreferrer" class="break-all">
                      <bdi dir="ltr">
                        <code>
                          {thread.path}
                          {thread.line === null ? "" : `:${thread.line}`}
                        </code>
                      </bdi>
                    </a>
                    <span class="text-v2-text-text-muted">
                      <bdi>{thread.author || ctx.t("unknownAuthor")}</bdi>
                    </span>
                    <Show when={thread.outdated}>
                      <span class="text-v2-text-text-muted">{ctx.t("outdated")}</span>
                    </Show>
                    <p class="whitespace-pre-wrap break-words">
                      <bdi>{thread.body}</bdi>
                    </p>
                  </article>
                )}
              </For>
            </section>
          </>
        )}
      </Show>
    </section>
  )
}

function checkIcon(state: PullRequest.Check["state"]): IconName {
  if (state === "success") return "circle-check"

  if (state === "failure") return "circle-x"

  return "circle-exclamation"
}
