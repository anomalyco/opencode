import { AppBaseProviders, AppInterface } from "../../src/app"
import { PlatformProvider } from "../../src/runtime/platform/platform"
import { createWebPlatform } from "../../src/runtime/platform/web"
import { ServerConnection } from "../../src/runtime/server/registry"
import { Plugin } from "@opencode/plugin/desktop"
import { Panel } from "@opencode/plugin/desktop/solid"
import { Button } from "@opencode/ui/button"
import { TextInput } from "@opencode/ui/text-input"
import { Stack, Text } from "@opencode/ui/layout"
import { createMemoryHistory, MemoryRouter } from "@solidjs/router"
import { createStore } from "solid-js/store"
import { render } from "solid-js/web"
import { base64Encode } from "@opencode/util/encode"
import { fixture } from "../performance/timeline/session-timeline-stress.fixture"

const plugin = Plugin.define({
  id: "test.panels",
  setup(ctx) {
    const [state, setState] = createStore({ available: true, closed: 0 })
    const [draft, saveDraft] = ctx.storage.memory("draft", { initial: { text: "" } })
    ctx.ui.slot({
      append: "titlebar.actions",
      render: () => (
        <>
          <Button
            onClick={() => {
              const session = ctx.sessions.current()
              if (session) ctx.ui.panel.open("notes", session)
            }}
          >
            Open notes
          </Button>
          <Button onClick={() => setState("available", !state.available)}>Toggle contribution</Button>
        </>
      ),
    })
    ctx.ui.slot({
      append: "session.panel",
      when: () => state.available,
      render: () => (
        <>
          <Panel id="notes" title="Notes" onClose={() => setState("closed", (count) => count + 1)}>
            <Stack padding="medium">
              <TextInput
                aria-label="Notes draft"
                value={draft.text}
                onInput={(event) =>
                  saveDraft((draft) => {
                    draft.text = event.currentTarget.value
                  })
                }
              />
            </Stack>
          </Panel>
          <Panel id="results" title="Results">
            <Stack padding="medium">
              <Text>Closed notes: {state.closed}</Text>
            </Stack>
          </Panel>
        </>
      ),
    })
  },
})
const web = createWebPlatform("test")
const history = createMemoryHistory()
history.set({ value: `/server/${base64Encode(web.currentServerUrl!)}/session/${fixture.sourceID}` })
render(
  () => (
    <PlatformProvider value={{ ...web.platform, extensionPlugins: [plugin] }}>
      <AppBaseProviders>
        <AppInterface
          servers={[{ type: "http", http: { url: web.currentServerUrl! } }]}
          defaultServer={ServerConnection.Key.make(web.currentServerUrl!)}
          router={(props) => <MemoryRouter {...props} history={history} />}
        />
      </AppBaseProviders>
    </PlatformProvider>
  ),
  document.getElementById("root")!,
)
