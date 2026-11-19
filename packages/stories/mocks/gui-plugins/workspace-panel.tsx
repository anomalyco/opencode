import { QueryClient, QueryClientProvider } from "@tanstack/solid-query"
import { File } from "@opencode/session-ui/file"
import { FileComponentProvider } from "@opencode/ui/context/file"
import { Show, createMemo, createSignal, type Accessor } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { PluginHostProvider, usePluginHost } from "@/runtime/plugin/host"
import { Contribution, PluginStyles } from "@/runtime/plugin/render"
import { persistedHandle } from "@/runtime/plugin/stores"
import { builtins } from "../../../gui-plugins/src/renderer"
import { fileTabId } from "../../../gui-plugins/src/file/path"
import { BuiltinPanel, type BuiltinLayout } from "../../../plugin/src/gui/builtin"
import { PanelContext } from "../../../plugin/src/gui/host"
import type { Layout, PanelFrame, Storage } from "../../../plugin/src/gui"
import { createStoryHostApis } from "../../src/plugin"
import { createWorkspace, type ChangesScenario } from "./workspace"

export type { ChangesScenario } from "./workspace"

const plugins = builtins.filter((plugin) => ["file", "review", "microsoft-office"].includes(plugin.id))

// Each story owns one window and one session. The host opens each declared store once; every write stays in memory.
const storage: Storage = {
  store(_key, options) {
    const [store, set] = createStore(structuredClone(options.initial))

    return persistedHandle({ store, set, init: undefined })
  },
  memory(_key, options) {
    const [store, set] = createStore(structuredClone(options.initial))

    return [store, (mutate) => set(produce(mutate))]
  },
  remove() {},
}

/** Mounts the panels contributed by the built-ins with their normal cross-plugin contracts and lazy viewers. */
export default function WorkspacePanel(props: {
  plugin: "file" | "review"
  path?: string
  scenario?: ChangesScenario
}) {
  const workspace = createWorkspace(props.scenario ?? "Changes")

  if (props.path?.includes("/")) workspace.screen.file.tree.expand(props.path.slice(0, props.path.lastIndexOf("/")))

  const apis = createStoryHostApis("web")

  const [tab, setTab] = createSignal(
    props.plugin === "review" ? "changes" : props.path ? fileTabId(workspace.screen.file, props.path) : "open",
  )

  const [width, setWidth] = createSignal(280)

  const [opened, setOpened] = createSignal(true)

  const frame: PanelFrame = {
    visible: () => true,
    present: () => true,
    placement: () => "side",
    reserve: () => false,
    animate: () => false,
    sidebar: { opened, width, resize: setWidth, toggle: () => setOpened((value) => !value), transition: () => false },
    open: () => [tab()],
  }

  const scroll = new Map<string, ReturnType<Layout["scroll"]["get"]>>()

  const layout: BuiltinLayout = {
    narrow: () => false,
    ready: () => true,
    open: (key) => setTab(key.slice(key.indexOf(":") + 1)),
    state: (key) => (key === `${props.plugin}:${tab()}` ? "active" : "closed"),
    stored: frame.open,
    sidebar: frame.sidebar,
    side: { opened: () => true, toggle() {}, menu: () => [], width: () => undefined, resize() {} },
    scroll: { get: (_session, key) => scroll.get(key), set: (_session, key, value) => scroll.set(key, value) },
    close() {},
    toggle() {},
    hide() {},
    settings() {},
    project() {},
    draft() {},
    command() {},
  }

  const query = new QueryClient()

  return (
    <QueryClientProvider client={query}>
      <PluginHostProvider
        definitions={() => plugins}
        apis={{
          ...apis,
          desktop: () => undefined,
          layout: () => layout,
          storage: () => storage,
          sessions: () => ({ current: () => workspace.session, list: () => [workspace.session] }),
          screen: () => ({ current: () => workspace.screen }),
          system: () => ({
            copy: (text) => navigator.clipboard.writeText(text),
            save: async () => false,
            openExternal() {},
          }),
          embeds: () => ({ View: () => null, capture: async () => undefined }),
          tabs: () => ({ list: () => [], open() {}, focus() {}, move() {}, close() {} }),
        }}
        whenMounted={(run) => {
          run()
          return () => {}
        }}
      >
        <PluginStyles />
        <PanelContext.Provider value={frame}>
          <FileComponentProvider component={File}>
            <div class="h-screen w-full overflow-hidden bg-v2-background-bg-base">
              <MountedPanel plugin={props.plugin} tab={tab} workspace={workspace} />
            </div>
          </FileComponentProvider>
        </PanelContext.Provider>
      </PluginHostProvider>
    </QueryClientProvider>
  )
}

function MountedPanel(props: { plugin: string; tab: Accessor<string>; workspace: ReturnType<typeof createWorkspace> }) {
  const host = usePluginHost()

  const panel = createMemo(() => host.items(BuiltinPanel).find((item) => item.plugin === props.plugin)?.value)

  return (
    <Show when={panel()} keyed>
      {(panel) => {
        const tab = createMemo(() =>
          panel.list({ ...props.workspace, open: [props.tab()] }).find((item) => item.id === props.tab()),
        )

        return (
          <Show when={tab()}>
            {(tab) => (
              <Contribution plugin={props.plugin}>
                {() =>
                  panel.render({
                    ...props.workspace,
                    get tab() {
                      return tab()
                    },
                  })
                }
              </Contribution>
            )}
          </Show>
        )
      }}
    </Show>
  )
}
