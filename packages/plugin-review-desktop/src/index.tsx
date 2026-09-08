import { For, Show, createEffect, createMemo, onCleanup, type ParentProps } from "solid-js"
import { createStore } from "solid-js/store"
import { Plugin, usePlugin, type SessionContext } from "@opencode/plugin/desktop"
import { Panel } from "@opencode/plugin/desktop/solid"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { Tooltip } from "@opencode/ui/tooltip"
import { FileIcon } from "@opencode/ui/file-icon"
import { Menu } from "@opencode/ui/menu"
import { Tabs } from "@opencode/ui/tabs"
import { SessionReviewV2SidebarToggle } from "@opencode/session-ui/v2/session-review-v2"
import { getFilename } from "@opencode/util/path"
import { Environment, useEnvironment } from "./environment"
import { createSessionReview, type SessionReviewModel } from "./review/model"
import { ReviewContent } from "./review/view"
import { SessionFileBrowserTab } from "./files/session-file-browser-tab"
import FileTree from "./files/file-tree"
import { OpenInAppButton } from "./files/open-in-app-button"
import { SessionMobileFiles } from "./files/session-mobile-files"
import { MobileReview } from "./review/mobile"

const openFileReference = "open-file"

export const ReviewDesktop = Plugin.define({
  id: "opencode.review",
  setup(ctx) {
    const [models, setModels] = createStore<Record<string, SessionReviewModel | undefined>>({})
    ctx.commands.register(() => {
      const session = ctx.sessions.current()
      return [
        {
          id: "open-file",
          reference: "file.open",
          title: ctx.i18n.t("command.file.open"),
          bind: "mod+p",
          enabled: !!session?.services,
          run() {
            if (session) ctx.ui.panel.open("files", session)
          },
        },
      ]
    })
    ctx.ui.slot({
      append: "session.panel",
      render: ({ session }) => (
        <SessionEnvironment session={session}>
          <Declarations setModel={(model) => setModels(session.key, () => model)} />
        </SessionEnvironment>
      ),
    })
    ctx.ui.slot({
      append: "session.panel.actions",
      render: ({ session }) => (
        <Menu.Item onSelect={() => ctx.ui.panel.open("files", session)}>
          <Icon name="open-file" size="small" />
          {ctx.i18n.t("command.file.open")}
        </Menu.Item>
      ),
    })
    ctx.ui.slot({
      append: "session.panel.toolbar",
      render: ({ session }) => (
        <Show when={models[session.key]}>
          {(model) => (
            <SessionReviewV2SidebarToggle
              opened={model().panelState.sidebarOpened()}
              disabled={session.services?.view.tabs.active() === openFileReference}
              onToggle={model().panelState.toggleSidebar}
            />
          )}
        </Show>
      ),
    })
    ctx.ui.slot({
      append: "session.panel.tools",
      render: ({ session }) => (
        <SessionEnvironment session={session}>
          <Tooltip value={ctx.i18n.t("command.file.open")}>
            <IconButton
              icon={<Icon name="open-file" />}
              variant="ghost-muted"
              size="large"
              aria-label={ctx.i18n.t("command.file.open")}
              onClick={() => ctx.ui.panel.open("files", session)}
            />
          </Tooltip>
          <OpenInAppButton directory={() => session.services?.files.directory ?? ""} />
        </SessionEnvironment>
      ),
    })
    ctx.ui.slot({
      append: "session.sidebar",
      render: ({ session }) => (
        <SessionEnvironment session={session}>
          <Show when={models[session.key]}>{(model) => <Sidebar review={model()} />}</Show>
        </SessionEnvironment>
      ),
    })
  },
})

function SessionEnvironment(props: ParentProps<{ session: SessionContext }>) {
  return (
    <Show when={props.session.services} keyed>
      {(services) => (
        <Environment.Provider value={{ session: props.session, services }}>{props.children}</Environment.Provider>
      )}
    </Show>
  )
}

function Declarations(props: { setModel(model: SessionReviewModel | undefined): void }) {
  const ctx = usePlugin()
  const environment = useEnvironment()
  const review = createSessionReview()
  props.setModel(review)
  onCleanup(() => props.setModel(undefined))
  const files = environment.services.files
  const view = environment.services.view
  const opened = createMemo(() => view.tabs.all().filter((tab) => !!files.pathFromTab(tab)))
  const fileTab = createMemo<string>((previous) => {
    const active = view.tabs.active()
    return active && (active === openFileReference || files.pathFromTab(active))
      ? active
      : (previous ?? openFileReference)
  })
  const content = () => (
    <Show when={view.desktop()} fallback={<SessionMobileFiles />}>
      <SessionFileBrowserTab
        tab={fileTab()}
        placeholder={fileTab() === openFileReference}
        active={files.pathFromTab(fileTab())}
        kinds={review.kinds()}
        state={review.panelState}
        onSelect={(path) => review.openFile(path, false)}
        onSelectPermanent={review.openFile}
        mobile={!view.desktop()}
      />
    </Show>
  )
  return (
    <>
      <Panel
        id="review"
        reference="review"
        default
        closable={false}
        title={
          !view.desktop()
            ? ctx.i18n.plural("session.review.change", 0)
            : review.diffs().length
              ? ctx.i18n.t("session.review.filesChanged", { count: review.diffs().length })
              : ctx.i18n.t("session.tab.review")
        }
      >
        <Show when={view.desktop()} fallback={<MobileReview review={review} />}>
          <ReviewContent review={review} />
        </Show>
      </Panel>
      <Panel
        id="files"
        reference={openFileReference}
        initial="closed"
        group="files"
        title={ctx.i18n.t(view.desktop() ? "command.file.open" : "session.tab.files")}
        icon={<Icon name="file-tree" size="small" />}
      >
        {content()}
      </Panel>
      <For each={opened()}>
        {(tab) => (
          <Panel
            id={tab}
            reference={tab}
            group="files"
            title={getFilename(files.pathFromTab(tab)!)}
            icon={<FileIcon node={{ path: files.pathFromTab(tab)!, type: "file" }} />}
            temporary={view.tabs.preview() === tab}
            onDoubleClick={() => {
              void view.tabs.open(tab)
            }}
          >
            {content()}
          </Panel>
        )}
      </For>
    </>
  )
}

function Sidebar(props: { review: SessionReviewModel }) {
  const ctx = usePlugin()
  const environment = useEnvironment()
  const sidebar = environment.services.view.sidebar
  return (
    <Tabs
      variant="surface"
      value={sidebar.tab()}
      onChange={(value) => {
        if (value === "changes" || value === "all") sidebar.setTab(value)
      }}
      class="h-full"
      data-scope="filetree"
    >
      <Tabs.List>
        <Tabs.Trigger value="changes">
          {ctx.i18n.t("session.review.filesChanged", { count: props.review.diffs().length })}
        </Tabs.Trigger>
        <Tabs.Trigger value="all">{ctx.i18n.t("session.files.all")}</Tabs.Trigger>
      </Tabs.List>
      <Tabs.Content value="changes" class="bg-background-stronger px-3 py-0">
        <FileTree
          path=""
          allowed={props.review.diffs().map((diff) => diff.file)}
          kinds={props.review.kinds()}
          draggable={false}
          active={props.review.activeFile()}
          onFileClick={(node) => props.review.focusFile(node.path)}
        />
      </Tabs.Content>
      <Tabs.Content value="all" class="bg-background-stronger px-3 py-0">
        <FileTree path="" kinds={props.review.kinds()} onFileClick={(node) => props.review.openFile(node.path)} />
      </Tabs.Content>
    </Tabs>
  )
}
