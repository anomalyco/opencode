import { createMemo, createSignal, onMount, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { DialogSelect, type DialogSelectOption } from "@tui/ui/dialog-select"
import { useDialog } from "@tui/ui/dialog"
import { useTheme } from "@tui/context/theme"
import { Keybind } from "@/util/keybind"
import { TextAttributes } from "@opentui/core"
import { useToast } from "@tui/ui/toast"
import type { Marketplace } from "@/marketplace"

// Types matching server API response
interface MarketplaceAgent {
  source: {
    repo: string
    ref?: string
    path?: string
    private?: boolean
    enabled?: boolean
    name?: string
  }
  agent: {
    path: string
    name: string
    description?: string
    mode?: "subagent" | "primary" | "all"
    color?: string
    tags?: string[]
    version?: string
    author?: string
  }
  installed: boolean
  installedPath?: string
}

function InstallStatus(props: { installed: boolean; installing?: boolean }) {
  const { theme } = useTheme()
  if (props.installing) {
    return <span style={{ fg: theme.textMuted }}>⋯ Installing</span>
  }
  if (props.installed) {
    return <span style={{ fg: theme.success, attributes: TextAttributes.BOLD }}>✓ Installed</span>
  }
  return <span style={{ fg: theme.textMuted }}>○ Not installed</span>
}

export function DialogMarketplace() {
  const dialog = useDialog()
  const { theme } = useTheme()
  const toast = useToast()

  const [store, setStore] = createStore({
    loading: true,
    agents: [] as MarketplaceAgent[],
    error: null as string | null,
    installing: null as string | null,
  })

  onMount(async () => {
    await refreshAgents()
  })

  async function refreshAgents(forceRefresh = false) {
    setStore("loading", true)
    setStore("error", null)
    try {
      const url = new URL("/marketplace/agents", "http://localhost:4096")
      if (forceRefresh) {
        url.searchParams.set("refresh", "true")
      }
      const response = await fetch(url.toString())
      if (!response.ok) {
        throw new Error(`Failed to fetch agents: ${response.statusText}`)
      }
      const agents = (await response.json()) as MarketplaceAgent[]
      setStore("agents", agents)
    } catch (error) {
      setStore("error", error instanceof Error ? error.message : "Unknown error")
    } finally {
      setStore("loading", false)
    }
  }

  async function installAgent(agent: MarketplaceAgent, scope: "global" | "project") {
    const key = `${agent.source.repo}:${agent.agent.path}`
    setStore("installing", key)
    try {
      const response = await fetch("/marketplace/agents/install", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source: agent.source,
          agentPath: agent.agent.path,
          scope,
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.message || `Failed to install: ${response.statusText}`)
      }

      toast.show({
        title: "Agent installed",
        message: `${agent.agent.name} installed to ${scope} scope`,
        variant: "success",
      })

      // Refresh the list to update installed status
      await refreshAgents()
    } catch (error) {
      toast.show({
        title: "Installation failed",
        message: error instanceof Error ? error.message : "Unknown error",
        variant: "error",
      })
    } finally {
      setStore("installing", null)
    }
  }

  const options = createMemo(() => {
    if (store.loading) {
      return [
        {
          title: "Loading...",
          value: null,
          description: "Fetching agents from marketplace sources",
          disabled: true,
        },
      ]
    }

    if (store.error) {
      return [
        {
          title: "Error",
          value: null,
          description: store.error,
          disabled: true,
        },
      ]
    }

    if (store.agents.length === 0) {
      return [
        {
          title: "No agents found",
          value: null,
          description: "Configure marketplace sources in opencode.jsonc",
          disabled: true,
        },
      ]
    }

    return store.agents.map((agent) => {
      const key = `${agent.source.repo}:${agent.agent.path}`
      const sourceName = agent.source.name || agent.source.repo
      return {
        title: agent.agent.name,
        value: agent,
        description: agent.agent.description || "No description",
        category: sourceName,
        footer: <InstallStatus installed={agent.installed} installing={store.installing === key} />,
      }
    })
  })

  const keybinds = createMemo(() => [
    {
      keybind: Keybind.parse("ctrl+r")[0],
      title: "refresh",
      onTrigger: async () => {
        await refreshAgents(true)
      },
    },
    {
      keybind: Keybind.parse("i")[0],
      title: "install (project)",
      onTrigger: async (option: DialogSelectOption<MarketplaceAgent | null>) => {
        if (!option.value || option.value.installed) return
        await installAgent(option.value, "project")
      },
    },
    {
      keybind: Keybind.parse("shift+i")[0],
      title: "install (global)",
      onTrigger: async (option: DialogSelectOption<MarketplaceAgent | null>) => {
        if (!option.value || option.value.installed) return
        await installAgent(option.value, "global")
      },
    },
    {
      keybind: Keybind.parse("return")[0],
      title: "details",
      onTrigger: (option: DialogSelectOption<MarketplaceAgent | null>) => {
        if (!option.value) return
        dialog.replace(() => <DialogMarketplaceDetail agent={option.value!} onBack={() => dialog.replace(() => <DialogMarketplace />)} />)
      },
    },
  ])

  return (
    <DialogSelect
      title="Marketplace"
      placeholder="Search agents..."
      options={options()}
      keybind={keybinds()}
      onSelect={(option) => {
        if (!option.value) return
        dialog.replace(() => <DialogMarketplaceDetail agent={option.value!} onBack={() => dialog.replace(() => <DialogMarketplace />)} />)
      }}
    />
  )
}

function DialogMarketplaceDetail(props: { agent: MarketplaceAgent; onBack: () => void }) {
  const { theme } = useTheme()
  const dialog = useDialog()
  const toast = useToast()
  const [installing, setInstalling] = createSignal(false)

  async function handleInstall(scope: "global" | "project") {
    setInstalling(true)
    try {
      const response = await fetch("/marketplace/agents/install", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source: props.agent.source,
          agentPath: props.agent.agent.path,
          scope,
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.message || `Failed to install: ${response.statusText}`)
      }

      toast.show({
        title: "Agent installed",
        message: `${props.agent.agent.name} installed to ${scope} scope`,
        variant: "success",
      })
      props.onBack()
    } catch (error) {
      toast.show({
        title: "Installation failed",
        message: error instanceof Error ? error.message : "Unknown error",
        variant: "error",
      })
    } finally {
      setInstalling(false)
    }
  }

  const options = createMemo(() => {
    const opts: DialogSelectOption<string>[] = []

    if (!props.agent.installed) {
      opts.push({
        title: "Install to project",
        value: "install-project",
        description: "Install agent to .opencode/agent/ in current project",
      })
      opts.push({
        title: "Install globally",
        value: "install-global",
        description: "Install agent to ~/.config/opencode/agent/",
      })
    } else {
      opts.push({
        title: "Already installed",
        value: "installed",
        description: props.agent.installedPath || "Agent is already installed",
        disabled: true,
      })
    }

    opts.push({
      title: "Back to list",
      value: "back",
      description: "Return to marketplace list",
    })

    return opts
  })

  const header = createMemo(() => {
    const agent = props.agent.agent
    const source = props.agent.source
    return (
      <box flexDirection="column" gap={0} paddingBottom={1}>
        <text style={{ fg: theme.text, attributes: TextAttributes.BOLD }}>{agent.name}</text>
        <text style={{ fg: theme.textMuted }}>{agent.description || "No description"}</text>
        <box flexDirection="row" gap={2} paddingTop={1}>
          <text style={{ fg: theme.textMuted }}>Source:</text>
          <text style={{ fg: theme.text }}>{source.name || source.repo}</text>
        </box>
        <Show when={agent.author}>
          <box flexDirection="row" gap={2}>
            <text style={{ fg: theme.textMuted }}>Author:</text>
            <text style={{ fg: theme.text }}>{agent.author}</text>
          </box>
        </Show>
        <Show when={agent.tags && agent.tags.length > 0}>
          <box flexDirection="row" gap={2}>
            <text style={{ fg: theme.textMuted }}>Tags:</text>
            <text style={{ fg: theme.accent }}>{agent.tags!.join(", ")}</text>
          </box>
        </Show>
        <Show when={agent.mode}>
          <box flexDirection="row" gap={2}>
            <text style={{ fg: theme.textMuted }}>Mode:</text>
            <text style={{ fg: theme.text }}>{agent.mode}</text>
          </box>
        </Show>
      </box>
    )
  })

  return (
    <box flexDirection="column" paddingLeft={2} paddingRight={2}>
      {header()}
      <DialogSelect
        title={`${props.agent.agent.name} - Actions`}
        options={options()}
        onSelect={async (option) => {
          if (installing()) return
          switch (option.value) {
            case "install-project":
              await handleInstall("project")
              break
            case "install-global":
              await handleInstall("global")
              break
            case "back":
              props.onBack()
              break
          }
        }}
      />
    </box>
  )
}
