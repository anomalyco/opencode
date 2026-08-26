import type { PluginInfo, PluginUpdateInfo, PluginUpdateResult } from "@opencode-ai/client"
import type { Plugin } from "@opencode-ai/plugin/tui"
import { useTerminalDimensions } from "@opentui/solid"
import { onMount } from "solid-js"
import { PluginsDialog, type PluginRegistry } from "../plugins"
import type { Story } from "./index"
import { StoryFooter } from "./footer"

const server: PluginInfo[] = [
  {
    id: "fixture.analytics",
    source: { type: "package", package: "@fixture/analytics@latest" },
    status: "active",
    tui: false,
  },
  {
    id: "fixture.theme",
    source: { type: "package", package: "@fixture/theme@2.4.0" },
    status: "active",
    tui: false,
  },
  {
    id: "fixture.local",
    source: { type: "local", path: "/fixture/plugins/local.ts" },
    status: "active",
    tui: false,
  },
  {
    source: { type: "package", package: "@fixture/broken@latest" },
    status: "failed",
    error: "Plugin entrypoint could not be loaded",
    tui: false,
  },
]

const initial = (): PluginUpdateInfo[] => [
  {
    name: "@fixture/analytics@latest",
    source: { type: "package", package: "@fixture/analytics@latest" },
    status: "available",
    currentVersion: "1.8.0",
    latestVersion: "1.9.0",
  },
  {
    name: "@fixture/theme@2.4.0",
    source: { type: "package", package: "@fixture/theme@2.4.0" },
    status: "pinned",
    currentVersion: "2.4.0",
  },
  {
    name: "/fixture/plugins/local.ts",
    source: { type: "local", path: "/fixture/plugins/local.ts" },
    status: "not-updateable",
  },
  {
    name: "@fixture/broken@latest",
    source: { type: "package", package: "@fixture/broken@latest" },
    status: "failed",
    error: "Registry request failed with status 503",
  },
]

const plugins: PluginRegistry = {
  registered: () => [{ id: "fixture.ui", source: "builtin", active: true }],
  list: () => [],
  activate: async () => true,
  deactivate: async () => true,
}

function PluginUpdatesStory(props: { context: Plugin.Context }) {
  const dimensions = useTerminalDimensions()
  const theme = props.context.theme.contextual.elevated
  let fixture = initial()

  const wait = () => new Promise<void>((resolve) => setTimeout(resolve, 500))
  const open = () =>
    props.context.ui.dialog.show(() => (
      <PluginsDialog
        context={props.context}
        plugins={plugins}
        server={() => server}
        updates={{
          async check() {
            await wait()
            return fixture
          },
          async update(name) {
            await wait()
            const current = fixture.find((entry) => entry.name === name)
            const result: PluginUpdateResult = {
              name,
              source: current?.source ?? { type: "package", package: name },
              status: "updated",
              previousVersion: current?.currentVersion,
              version: current?.latestVersion,
            }
            fixture = fixture.map((entry) => (entry.name === name ? { ...entry, status: "up-to-date" } : entry))
            return result
          },
          async updateAll() {
            await wait()
            const results: PluginUpdateResult[] = fixture.map((entry) =>
              entry.status === "available"
                ? {
                    name: entry.name,
                    source: entry.source,
                    status: "updated",
                    previousVersion: entry.currentVersion,
                    version: entry.latestVersion,
                  }
                : {
                    name: entry.name,
                    source: entry.source,
                    status: entry.status,
                    version: entry.currentVersion,
                    error: entry.error,
                  },
            )
            fixture = initial().map((entry) =>
              entry.status === "available"
                ? { ...entry, status: "up-to-date", currentVersion: entry.latestVersion }
                : entry,
            )
            return results
          },
        }}
      />
    ))

  props.context.keymap.layer(() => ({
    commands: [
      {
        bind: "escape",
        title: "Back to storybook",
        group: "Storybook",
        run: () => props.context.ui.router.navigate({ type: "plugin", name: "storybook" }),
      },
      { bind: "return", title: "Open plugin controls", group: "Storybook", run: open },
      {
        bind: "r",
        title: "Reset plugin controls",
        group: "Storybook",
        run() {
          fixture = initial()
          open()
        },
      },
    ],
  }))

  onMount(open)

  return (
    <box
      width={dimensions().width}
      height={dimensions().height}
      flexDirection="column"
      backgroundColor={theme.background.default}
    >
      <box flexGrow={1} paddingLeft={2} paddingTop={1}>
        <text fg={theme.text.default}>Plugin update controls fixture</text>
        <text fg={theme.text.subdued}>The production Plugins dialog opens automatically.</text>
      </box>
      <StoryFooter
        context={props.context}
        title="storybook / plugin updates"
        status="fixture API · 500ms operations"
        controls={[
          { shortcut: "enter", label: "open" },
          { shortcut: "r", label: "reset" },
          { shortcut: "esc", label: "back" },
        ]}
      />
    </box>
  )
}

export const pluginUpdatesStory: Story = {
  id: "plugin-updates",
  title: "Plugin update controls",
  render: (context) => <PluginUpdatesStory context={context} />,
}
