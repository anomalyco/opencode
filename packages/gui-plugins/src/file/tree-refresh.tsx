import { createSignal, onCleanup, untrack } from "solid-js"
import { IconButton } from "@opencode/ui/icon-button"
import { Icon } from "@opencode/ui/icon"
import { showToast } from "@opencode/ui/toast"
import { Tooltip } from "@opencode/ui/tooltip"
import { createKeyed, usePlugin, type MountedSession, type SessionScreen } from "@opencode/plugin/gui"
import { collectRefreshTargets } from "./tree-model"
import {
  INITIAL_TREE_REFRESH_STATE,
  isTreeRefreshPending,
  transitionTreeRefresh,
  treeRefreshConcurrency,
  type TreeRefreshEffect,
  type TreeRefreshEvent,
  type TreeRefreshState,
} from "./tree-refresh-machine"

/**
 * The workspace tree's manual refresh: the sidebar header button that rereads the root and every already-loaded
 * directory, keeping the expansion, selection and scroller the diffed rows leave in place.
 */
export default function TreeRefreshButton(props: { session: MountedSession; screen: SessionScreen }) {
  const ctx = usePlugin()
  const file = props.screen.file
  const [state, setState] = createSignal<TreeRefreshState>(INITIAL_TREE_REFRESH_STATE)

  const dispatch = (event: TreeRefreshEvent) => {
    const previous = untrack(state)
    const next = transitionTreeRefresh(previous, event)

    if (next.state !== previous) setState(() => next.state)
    next.effects.forEach(run)

    return next.state
  }

  const run = (effect: TreeRefreshEffect) => {
    if (effect.type === "report") {
      showToast({
        variant: "error",
        title: ctx.t("tree.refreshFailed"),
        description: effect.errors[0],
      })

      return
    }

    const { attempt, target } = effect

    // A directory pruned while it waited is not reloaded; the root always syncs.
    if (target.dir !== "" && !file.tree.state(target.dir)?.loaded) {
      dispatch({ type: "sync.skipped", attempt, dir: target.dir })

      return
    }

    void file.tree
      .sync(target.original, { force: true })
      .then(
        () => dispatch({ type: "sync.settled", attempt, dir: target.dir }),
        (cause: unknown) =>
          dispatch({
            type: "sync.settled",
            attempt,
            dir: target.dir,
            error: cause instanceof Error ? cause.message : String(cause),
          }),
      )
  }

  const start = () => {
    if (isTreeRefreshPending(untrack(state))) return

    const scope = { serverID: props.session.server.id, root: file.root }
    const targets = untrack(() => collectRefreshTargets((path) => file.tree.list(path), (path) => file.tree.state(path)))

    const next = dispatch({ type: "started", scope, targets })

    // Not the machine's phase: the action never claimed this click.
    if (next.status !== "starting") return

    // The config's outcome belongs to this one action: its attempt is captured once, and a scope change followed by a
    // new action leaves this settlement stale.
    const { attempt } = next

    // The config's value belongs to this whole action; an edit applies to the next one.
    void props.session.server.client.config
      .get({ location: { directory: file.root } }, { signal: ctx.signal })
      .then(
        (entries) => dispatch({ type: "config.settled", attempt, concurrency: treeRefreshConcurrency(entries) }),
        (cause: unknown) =>
          dispatch({
            type: "config.failed",
            attempt,
            error: cause instanceof Error ? cause.message : String(cause),
          }),
      )
  }

  // A new server or workspace owns no action: pending targets drop and settled syncs are stale.
  createKeyed(
    () => ({ serverID: props.session.server.id, root: file.root }),
    () => dispatch({ type: "scope.changed" }),
    {
      equals: (previous, next) => previous.serverID === next.serverID && previous.root === next.root,
    },
  )

  onCleanup(() => dispatch({ type: "disposed" }))

  return (
    <Tooltip placement="bottom" value={ctx.t("tree.refresh")}>
      <IconButton
        variant="ghost-muted"
        size="large"
        icon={<Icon name="refresh" />}
        disabled={isTreeRefreshPending(state())}
        aria-busy={isTreeRefreshPending(state()) || undefined}
        aria-label={ctx.t("tree.refresh")}
        onClick={start}
      />
    </Tooltip>
  )
}
