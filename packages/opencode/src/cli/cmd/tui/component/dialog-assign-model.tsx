import { createMemo } from "solid-js"
import { map, pipe, sortBy } from "remeda"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useDialog } from "@tui/ui/dialog"
import { useSync } from "@tui/context/sync"
import { useSDK } from "@tui/context/sdk"
import { useToast } from "../ui/toast"
import { useRoute } from "@tui/context/route"
import { Provider } from "@/provider/provider"

const PROVIDER_PRIORITY: Record<string, number> = {
  opencode: 0,
  "opencode-go": 1,
  openai: 2,
  "github-copilot": 3,
  anthropic: 4,
  google: 5,
}

function getAssignedModel(sync: ReturnType<typeof useSync>, agent: string) {
  const value = sync.data.config.subagent_model_assignments?.[agent]
  if (!value) return
  return Provider.parseModel(value)
}

async function saveAssignment(input: {
  sdk: ReturnType<typeof useSDK>
  sync: ReturnType<typeof useSync>
  toast: ReturnType<typeof useToast>
  agent: string
  model: { providerID: string; modelID: string }
  scope: "global" | "project"
}) {
  const before = input.sync.data.config.subagent_model_assignments ?? {}
  const next = {
    ...before,
    [input.agent]: `${input.model.providerID}/${input.model.modelID}`,
  }

  input.sync.set("config", "subagent_model_assignments", next)

  try {
    if (input.scope === "global") {
      await input.sdk.client.global.config.update({
        config: {
          subagent_model_assignments: next,
        },
      })
    } else {
      await input.sdk.client.config.update({
        config: {
          subagent_model_assignments: next,
        },
      })
    }
    await input.sdk.client.instance.dispose()
    await input.sync.bootstrap()
  } catch (error) {
    input.sync.set("config", "subagent_model_assignments", before)
    input.toast.show({
      message: error instanceof Error ? error.message : "Failed to assign model",
      variant: "error",
    })
    throw error
  }
}

export function DialogAssignModel() {
  const dialog = useDialog()
  const sync = useSync()

  const options = createMemo(() =>
    sync.data.agent
      .filter((agent) => agent.mode !== "primary" && !agent.hidden)
      .toSorted((a, b) => a.name.localeCompare(b.name))
      .map((agent) => ({
        value: agent.name,
        title: agent.name,
        description: agent.native ? "native" : agent.description,
        onSelect() {
          dialog.replace(
            () => <DialogAssignModelProvider agent={agent.name} />,
            () => dialog.replace(() => <DialogAssignModel />),
          )
        },
      })),
  )

  return <DialogSelect title="Assign model" placeholder="Search subagents" options={options()} />
}

function DialogAssignModelProvider(props: { agent: string }) {
  const dialog = useDialog()
  const sync = useSync()
  const assigned = createMemo(() => getAssignedModel(sync, props.agent))

  const options = createMemo(() =>
    pipe(
      sync.data.provider,
      sortBy((provider) => PROVIDER_PRIORITY[provider.id] ?? 99, (provider) => provider.name),
      map((provider) => ({
        value: provider.id,
        title: provider.name,
        description: "Connected",
        category: provider.id in PROVIDER_PRIORITY ? "Popular" : "Other",
        onSelect() {
          dialog.replace(
            () => <DialogAssignModelModel agent={props.agent} providerID={provider.id} />,
            () => dialog.replace(() => <DialogAssignModelProvider agent={props.agent} />),
          )
        },
      })),
    ),
  )

  return (
    <DialogSelect
      title={`Select provider for ${props.agent}`}
      placeholder="Search providers"
      options={options()}
      current={assigned()?.providerID}
      onSelect={() => {}}
    />
  )
}

function DialogAssignModelModel(props: { agent: string; providerID: string }) {
  const dialog = useDialog()
  const sync = useSync()
  const sdk = useSDK()
  const toast = useToast()
  const assigned = createMemo(() => getAssignedModel(sync, props.agent))
  const provider = createMemo(() => sync.data.provider.find((item) => item.id === props.providerID))

  const options = createMemo(() => {
    const currentProvider = provider()
    if (!currentProvider) return []

    return pipe(
      currentProvider.models,
      Object.entries,
      (entries) => entries.filter(([_, info]) => info.status !== "deprecated"),
      (entries) =>
        entries.map(([modelID, info]) => ({
          value: { providerID: currentProvider.id, modelID },
          title: info.name ?? modelID,
          description: info.cost?.input === 0 && currentProvider.id === "opencode" ? "Free" : undefined,
          onSelect: () => {
            dialog.replace(
              () => (
                <DialogAssignModelScope
                  agent={props.agent}
                  model={{ providerID: currentProvider.id, modelID }}
                  modelName={info.name ?? modelID}
                />
              ),
              () => dialog.replace(() => <DialogAssignModelModel agent={props.agent} providerID={props.providerID} />),
            )
          },
        })),
      (entries) =>
        entries.toSorted((a, b) => {
          if (a.description === "Free" && b.description !== "Free") return -1
          if (b.description === "Free" && a.description !== "Free") return 1
          return a.title.localeCompare(b.title)
        }),
    )
  })

  return (
    <DialogSelect
      title={`Select model for ${props.agent}`}
      placeholder={`Search ${provider()?.name ?? props.providerID} models`}
      options={options()}
      current={
        assigned()?.providerID === props.providerID
          ? { providerID: props.providerID, modelID: assigned()!.modelID }
          : undefined
      }
    />
  )
}

function DialogAssignModelScope(props: {
  agent: string
  model: { providerID: string; modelID: string }
  modelName: string
}) {
  const dialog = useDialog()
  const sync = useSync()
  const sdk = useSDK()
  const toast = useToast()
  const route = useRoute()

  const options = createMemo(() => [
    {
      value: "project",
      title: "Project",
      description: "Applies only to this project",
      onSelect: async () => {
        await saveAssignment({
          sdk,
          sync,
          toast,
          agent: props.agent,
          model: props.model,
          scope: "project",
        }).then(() => {
          const workspaceID =
            route.data.type === "session" ? sync.session.get(route.data.sessionID)?.workspaceID : undefined
          route.navigate({ type: "home", workspaceID })
          toast.show({
            message: `Assigned ${props.modelName} to ${props.agent} (project)`,
            variant: "success",
          })
          dialog.clear()
        })
      },
    },
    {
      value: "global",
      title: "Global",
      description: "Applies to all projects",
      onSelect: async () => {
        await saveAssignment({
          sdk,
          sync,
          toast,
          agent: props.agent,
          model: props.model,
          scope: "global",
        }).then(() => {
          const workspaceID =
            route.data.type === "session" ? sync.session.get(route.data.sessionID)?.workspaceID : undefined
          route.navigate({ type: "home", workspaceID })
          toast.show({
            message: `Assigned ${props.modelName} to ${props.agent} (global)`,
            variant: "success",
          })
          dialog.clear()
        })
      },
    },
  ])

  return <DialogSelect title="Save to" placeholder="Search options" options={options()} />
}
