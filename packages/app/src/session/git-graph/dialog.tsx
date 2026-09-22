import type { Vcs } from "@opencode/schema/vcs"
import { Button } from "@opencode/ui/button"
import { Dialog, DialogBody, DialogHeader, DialogTitle } from "@opencode/ui/dialog"
import { Icon } from "@opencode/ui/icon"
import { Spinner } from "@opencode/ui/spinner"
import { Show, createEffect, on, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/runtime/i18n/language"
import { useServerSDK } from "@/runtime/server/client"
import { GitGraphPane } from "./pane"
import "./git-graph.css"

const PAGE_SIZE = 50

export function GitGraphDialog(props: { directory: string }) {
  const language = useLanguage()
  const server = useServerSDK()
  const [state, setState] = createStore({
    commits: [] as Vcs.GraphCommit[],
    consumed: 0,
    hasMore: false,
    selectedHash: undefined as string | undefined,
    expandedHash: undefined as string | undefined,
    initial: "loading" as "loading" | "ready" | "unsupported" | "error",
    loadingMore: false,
    refreshing: false,
    loadMoreFailed: false,
    refreshFailed: false,
  })
  let pending = false
  let generation = 0
  let controller: AbortController | undefined

  const begin = () => {
    pending = true
    controller?.abort()
    controller = new AbortController()
    return { generation: generation, signal: controller.signal }
  }
  const current = (request: { generation: number }) => request.generation === generation
  const finish = (request: { generation: number }) => {
    if (!current(request)) return
    pending = false
  }
  const request = (skip: number, signal: AbortSignal) =>
    server.api.vcs
      .graph({ location: { directory: props.directory }, skip, limit: PAGE_SIZE }, { signal })
      .then((result) => result.data)

  const loadInitial = async () => {
    generation++
    const active = begin()
    setState({
      commits: [],
      consumed: 0,
      hasMore: false,
      selectedHash: undefined,
      expandedHash: undefined,
      initial: "loading",
      loadingMore: false,
      refreshing: false,
      loadMoreFailed: false,
      refreshFailed: false,
    })
    try {
      const page = await request(0, active.signal)
      if (!current(active)) return
      if (page === null) {
        setState("initial", "unsupported")
        return
      }
      setState({
        commits: [...page.commits],
        consumed: page.commits.length,
        hasMore: page.hasMore,
        selectedHash: page.commits[0]?.hash,
        initial: "ready",
      })
    } catch (error) {
      if (!current(active) || active.signal.aborted) return
      console.warn("[git-graph] initial request failed", { error })
      setState("initial", "error")
    } finally {
      finish(active)
    }
  }

  const refresh = async () => {
    if (pending) return
    const active = begin()
    setState({ refreshing: true, refreshFailed: false, loadMoreFailed: false })
    try {
      const page = await request(0, active.signal)
      if (!current(active)) return
      if (page === null) {
        setState({
          commits: [],
          consumed: 0,
          hasMore: false,
          selectedHash: undefined,
          expandedHash: undefined,
          initial: "unsupported",
        })
        return
      }
      setState({
        commits: [...page.commits],
        consumed: page.commits.length,
        hasMore: page.hasMore,
        selectedHash: page.commits[0]?.hash,
        expandedHash: undefined,
        initial: "ready",
      })
    } catch (error) {
      if (!current(active) || active.signal.aborted) return
      console.warn("[git-graph] refresh failed", { error })
      setState("refreshFailed", true)
    } finally {
      if (current(active)) setState("refreshing", false)
      finish(active)
    }
  }

  const loadMore = async () => {
    if (pending || (!state.hasMore && !state.loadMoreFailed)) return
    const active = begin()
    setState({ loadingMore: true, loadMoreFailed: false, refreshFailed: false })
    try {
      const page = await request(state.consumed, active.signal)
      if (!current(active) || page === null) return
      const seen = new Set(state.commits.map((commit) => commit.hash))
      setState({
        commits: [...state.commits, ...page.commits.filter((commit) => !seen.has(commit.hash))],
        consumed: state.consumed + page.commits.length,
        hasMore: page.hasMore,
      })
    } catch (error) {
      if (!current(active) || active.signal.aborted) return
      console.warn("[git-graph] load more failed", { error })
      setState("loadMoreFailed", true)
    } finally {
      if (current(active)) setState("loadingMore", false)
      finish(active)
    }
  }

  const select = (hash: string) => {
    if (state.selectedHash === hash && state.expandedHash === hash) {
      setState("expandedHash", undefined)
      return
    }
    setState({ selectedHash: hash, expandedHash: hash })
  }

  createEffect(on(() => `${server.scope}\0${props.directory}`, loadInitial))
  onCleanup(() => {
    generation++
    controller?.abort()
  })

  return (
    <Dialog containerClass="git-graph-dialog-container" class="git-graph-dialog">
      <DialogHeader closeLabel={language.t("common.close")}>
        <DialogTitle>{language.t("gitGraph.title")}</DialogTitle>
        <Button
          class="git-graph-refresh"
          size="small"
          variant="ghost-muted"
          icon="refresh"
          disabled={state.initial === "loading" || state.loadingMore || state.refreshing}
          aria-label={language.t("gitGraph.refresh")}
          title={language.t("gitGraph.refresh")}
          onClick={refresh}
        >
          <span>{language.t("gitGraph.refresh")}</span>
        </Button>
      </DialogHeader>
      <DialogBody class="git-graph-body">
        <Show when={state.refreshFailed}>
          <div class="git-graph-notice" role="alert">
            <span>{language.t("gitGraph.error.refresh")}</span>
            <Button size="small" variant="ghost-muted" onClick={refresh}>
              {language.t("gitGraph.retry")}
            </Button>
          </div>
        </Show>
        <Show when={state.initial === "loading"}>
          <div class="git-graph-state" aria-live="polite">
            <Spinner class="size-4" />
            <span>{language.t("gitGraph.loading")}</span>
          </div>
        </Show>
        <Show when={state.initial === "error"}>
          <div class="git-graph-state" role="alert">
            <IconState />
            <strong>{language.t("gitGraph.error.initial.title")}</strong>
            <span>{language.t("gitGraph.error.initial.description")}</span>
            <Button size="small" variant="outline" onClick={loadInitial}>
              {language.t("gitGraph.retry")}
            </Button>
          </div>
        </Show>
        <Show when={state.initial === "unsupported"}>
          <div class="git-graph-state">
            <IconState />
            <strong>{language.t("gitGraph.unsupported.title")}</strong>
            <span>{language.t("gitGraph.unsupported.description")}</span>
          </div>
        </Show>
        <Show when={state.initial === "ready" && state.commits.length === 0}>
          <div class="git-graph-state">
            <IconState />
            <strong>{language.t("gitGraph.empty.title")}</strong>
            <span>{language.t("gitGraph.empty.description")}</span>
          </div>
        </Show>
        <Show when={state.initial === "ready" && state.commits.length > 0}>
          <GitGraphPane
            commits={state.commits}
            selectedHash={state.selectedHash}
            expandedHash={state.expandedHash}
            hasMore={state.hasMore}
            loadingMore={state.loadingMore}
            loadMoreFailed={state.loadMoreFailed}
            onSelect={select}
            onLoadMore={loadMore}
          />
        </Show>
      </DialogBody>
    </Dialog>
  )
}

function IconState() {
  return (
    <span class="git-graph-state-icon" aria-hidden="true">
      <Icon name="branch" size="large" />
    </span>
  )
}
