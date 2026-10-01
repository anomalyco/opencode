import { createEffect, createMemo, Match, onCleanup, Show, Switch } from "solid-js"
import { Tabs } from "@opencode/ui/tabs"
import type { ChangeKind } from "../review/contract"
import { useExtension, type SessionView } from "../sdk"
import { useShared } from "./context"
import FileTree from "./tree"

/** The file tree beside the side panel: the session's changed files, or every workspace file. */
export default function FileSidebar(props: { session: SessionView }) {
  const ctx = useExtension()
  const shared = useShared()
  const file = props.session.file
  const empty = new Map<string, ChangeKind>()

  // The host mounts this only while the tree is open, which is when its changes should stay loaded.
  createEffect(() => {
    const changes = shared.changes()
    if (!changes) return
    onCleanup(changes.watch(props.session, "tree"))
  })

  createEffect(() => {
    const directory = file.root
    if (!props.session.server.connected) return
    shared.tree.tab()
    const refresh = shared.tree.directory !== directory
    shared.tree.directory = directory
    void file.tree.sync("", refresh ? { force: true } : undefined)
  })

  // Without the review extension only the workspace files can show.
  const tab = createMemo(() => (shared.changes() ? shared.tree.tab() : "all"))
  const count = createMemo(() => shared.changes()?.diffs(props.session).length ?? 0)
  const ready = createMemo(() => shared.changes()?.ready(props.session) ?? false)
  const diffFiles = createMemo(() =>
    (shared.changes()?.diffs(props.session) ?? []).flatMap((diff) =>
      typeof diff.file === "string" ? [diff.file] : [],
    ),
  )
  const kinds = createMemo(() => shared.changes()?.kinds(props.session) ?? empty)

  const nofiles = createMemo(() => {
    const state = file.tree.state("")
    if (!state?.loaded) return false
    return file.tree.list("").length === 0
  })

  const emptyState = (message: string) => (
    <div class="h-full flex flex-col">
      <div class="h-6 shrink-0" aria-hidden />
      <div class="flex-1 pb-64 flex items-center justify-center text-center">
        <div class="text-12-regular text-text-weak">{message}</div>
      </div>
    </div>
  )

  return (
    <Tabs
      variant="surface"
      value={tab()}
      onChange={(value) => {
        if (value !== "changes" && value !== "all") return
        shared.tree.setTab(value)
      }}
      class="h-full"
      data-scope="filetree"
    >
      <Tabs.List>
        <Show when={shared.changes()}>
          <Tabs.Trigger value="changes" class="flex-1" classes={{ button: "w-full" }}>
            {ctx.plural("tree.changes", count())}
          </Tabs.Trigger>
        </Show>
        <Tabs.Trigger value="all" class="flex-1" classes={{ button: "w-full" }}>
          {ctx.t("tree.all")}
        </Tabs.Trigger>
      </Tabs.List>
      <Show when={tab() === "changes"}>
        <Tabs.Content value="changes" class="bg-background-stronger px-3 py-0">
          <Switch>
            <Match when={count() > 0 || !ready()}>
              <Show
                when={ready()}
                fallback={
                  <div class="px-2 py-2 text-12-regular text-text-weak">
                    {ctx.t("common.loading")}
                    {ctx.t("common.loading.ellipsis")}
                  </div>
                }
              >
                <FileTree
                  session={props.session}
                  path=""
                  class="pt-3"
                  allowed={diffFiles()}
                  kinds={kinds()}
                  draggable={false}
                  active={shared.changes()?.active(props.session)}
                  onFileClick={(node) => shared.changes()?.focus(props.session, node.path)}
                />
              </Show>
            </Match>
          </Switch>
        </Tabs.Content>
      </Show>
      <Show when={tab() === "all"}>
        <Tabs.Content value="all" class="bg-background-stronger px-3 py-0">
          <Switch>
            <Match when={nofiles()}>{emptyState(ctx.t("tree.empty"))}</Match>
            <Match when={true}>
              <FileTree
                session={props.session}
                path=""
                class="pt-3"
                modified={diffFiles()}
                kinds={kinds()}
                onFileClick={(node) => shared.open(props.session, node.path)}
              />
            </Match>
          </Switch>
        </Tabs.Content>
      </Show>
    </Tabs>
  )
}
