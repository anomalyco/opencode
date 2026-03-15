import { List } from "@opencode-ai/ui/list"
import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { ProviderIcon } from "@opencode-ai/ui/provider-icon"
import { Tag } from "@opencode-ai/ui/tag"
import { showToast } from "@opencode-ai/ui/toast"
import { useNavigate } from "@solidjs/router"
import { createMemo, createSignal, type Component } from "solid-js"
import { DialogSelectProvider } from "./dialog-select-provider"
import { ModelList, type ModelListState } from "./dialog-select-model"
import { useLanguage } from "@/context/language"
import { useLocal, type ModelKey } from "@/context/local"
import { useGlobalSync } from "@/context/global-sync"
import { useProviders, popularProviders } from "@/hooks/use-providers"
import { useSync } from "@/context/sync"
import { useSDK } from "@/context/sdk"

type Step =
  | { type: "subagent" }
  | { type: "provider"; agent: string }
  | { type: "model"; agent: string; provider: string }
  | { type: "scope"; agent: string; provider: string; model: ModelKey }

type ProviderStep = Extract<Step, { type: "provider" }>
type ModelStep = Extract<Step, { type: "model" }>
type ScopeStep = Extract<Step, { type: "scope" }>

export const DialogAssignSubagentModel: Component = () => {
  const dialog = useDialog()
  const globalSync = useGlobalSync()
  const language = useLanguage()
  const local = useLocal()
  const navigate = useNavigate()
  const providers = useProviders()
  const sync = useSync()
  const sdk = useSDK()

  const subagents = createMemo(() => sync.data.agent.filter((agent) => agent.mode !== "primary" && !agent.hidden))
  const connectedProviders = createMemo(() => providers.connected())

  const [step, setStep] = createSignal<Step>({ type: "subagent" })
  const providerStep = createMemo<ProviderStep | undefined>(() => {
    const current = step()
    return current.type === "provider" ? current : undefined
  })
  const modelStep = createMemo<ModelStep | undefined>(() => {
    const current = step()
    return current.type === "model" ? current : undefined
  })
  const scopeStep = createMemo<ScopeStep | undefined>(() => {
    const current = step()
    return current.type === "scope" ? current : undefined
  })

  const assignment = (agent: string): ModelKey | undefined => {
    const value = globalSync.data.config.subagent_model_assignments?.[agent]
    if (!value) return
    const [providerID, modelID] = value.split("/")
    if (!providerID || !modelID) return
    return { providerID, modelID }
  }

  const assignedModel = createMemo(() => {
    const current = step()
    if (current.type === "subagent") return
    return assignment(current.agent)
  })

  const assignedProvider = createMemo(() => {
    const model = assignedModel()
    if (!model) return
    return connectedProviders().find((provider) => provider.id === model.providerID)
  })

  const providerTitle = createMemo(() => {
    if (!providerStep()) return language.t("dialog.assignModel.provider.title")
    return language.t("dialog.assignModel.provider.titleForAgent", { agent: providerStep()!.agent })
  })

  const modelTitle = createMemo(() => {
    const current = modelStep()
    if (!current) return language.t("dialog.assignModel.model.title")
    const provider = connectedProviders().find((item) => item.id === current.provider)
    return language.t("dialog.assignModel.model.titleForAgent", {
      agent: current.agent,
      provider: provider?.name ?? current.provider,
    })
  })

  const scopeTitle = createMemo(() => {
    return language.t("dialog.assignModel.scope.title")
  })

  const title = createMemo(() => {
    const current = step()
    if (current.type === "subagent") return language.t("command.model.assign")
    return (
      <div class="flex items-center gap-2 -ml-2">
        <IconButton
          icon="arrow-left"
          variant="ghost"
          onClick={() => {
            if (current.type === "scope") {
              setStep({ type: "model", agent: current.agent, provider: current.model.providerID })
              return
            }
            if (current.type === "model") {
              setStep({ type: "provider", agent: current.agent })
              return
            }
            setStep({ type: "subagent" })
          }}
          aria-label={language.t("common.goBack")}
        />
        <span>
          {current.type === "provider"
            ? providerTitle()
            : current.type === "model"
              ? modelTitle()
              : scopeTitle()}
        </span>
      </div>
    )
  })

  const assignModelGlobal = async (agent: string, model: ModelKey | undefined) => {
    const before = globalSync.data.config.subagent_model_assignments ?? {}
    const next = { ...before }
    if (model) next[agent] = `${model.providerID}/${model.modelID}`
    else delete next[agent]

    globalSync.set("config", "subagent_model_assignments", next)
    await globalSync.updateConfig({ subagent_model_assignments: next }).catch((err: unknown) => {
      globalSync.set("config", "subagent_model_assignments", before)
      const message = err instanceof Error ? err.message : String(err)
      showToast({ title: language.t("common.requestFailed"), description: message })
      throw err
    })
  }

  const assignModelProject = async (agent: string, model: ModelKey | undefined) => {
    const before = sync.data.config.subagent_model_assignments ?? {}
    const next = { ...before }
    if (model) next[agent] = `${model.providerID}/${model.modelID}`
    else delete next[agent]

    // Optimistic update
    // Note: sync doesn't have a direct set method for config like globalSync
    // We need to update via the SDK
    await sdk.client.config
      .update({
        config: { subagent_model_assignments: next },
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err)
        showToast({ title: language.t("common.requestFailed"), description: message })
        throw err
      })
  }

  const handleModelSelect = (item: ModelKey | undefined) => {
    const current = step()
    if (current.type !== "model" || !item) return
    setStep({ type: "scope", agent: current.agent, provider: current.provider, model: item })
  }

  const handleScopeSelect = async (scope: "global" | "project") => {
    const current = scopeStep()
    if (!current) return

    const assignFn = scope === "global" ? assignModelGlobal : assignModelProject
    await assignFn(current.agent, current.model)
      .then(() => {
        local.session.reset()
        navigate(`/${local.slug()}/session`)
        dialog.close()
      })
      .catch(() => undefined)
  }

  const modelState = createMemo<ModelListState>(() => ({
    list: local.model.list,
    visible: local.model.visible,
    current() {
      const item = assignedModel()
      if (!item) return undefined
      return local
        .model
        .list()
        .find((entry) => entry.provider.id === item.providerID && entry.id === item.modelID)
    },
    set: handleModelSelect,
  }))

  return (
    <Dialog
      title={title()}
      action={
        step().type !== "subagent" && step().type !== "scope" ? (
          <Button
            class="h-7 -my-1 text-14-medium"
            icon="plus-small"
            tabIndex={-1}
            onClick={() => dialog.show(() => <DialogSelectProvider />)}
          >
            {language.t("command.provider.connect")}
          </Button>
        ) : undefined
      }
    >
      {step().type === "subagent" ? (
        <List
          search={{ placeholder: language.t("dialog.assignModel.subagent.search.placeholder"), autofocus: true }}
          emptyMessage={language.t("dialog.assignModel.subagent.empty")}
          key={(agent) => agent.name}
          items={subagents}
          filterKeys={["name", "description"]}
          sortBy={(a, b) => a.name.localeCompare(b.name)}
          onSelect={(agent) => {
            if (!agent) return
            setStep({ type: "provider", agent: agent.name })
          }}
        >
          {(agent) => (
            <div class="w-full flex items-center gap-2 text-13-regular">
              <span class="truncate">{agent.name}</span>
              {agent.description ? <span class="text-text-weak truncate">{agent.description}</span> : null}
            </div>
          )}
        </List>
      ) : null}

      {providerStep() ? (
        <List
          search={{ placeholder: language.t("dialog.assignModel.provider.search.placeholder"), autofocus: true }}
          emptyMessage={language.t("dialog.assignModel.provider.empty")}
          key={(provider) => provider.id}
          items={connectedProviders}
          current={assignedProvider()}
          filterKeys={["id", "name"]}
          groupBy={(provider) =>
            popularProviders.includes(provider.id)
              ? language.t("dialog.provider.group.popular")
              : language.t("dialog.provider.group.other")
          }
          sortBy={(a, b) => {
            if (popularProviders.includes(a.id) && popularProviders.includes(b.id)) {
              return popularProviders.indexOf(a.id) - popularProviders.indexOf(b.id)
            }
            if (popularProviders.includes(a.id)) return -1
            if (popularProviders.includes(b.id)) return 1
            return a.name.localeCompare(b.name)
          }}
          sortGroupsBy={(a, b) => {
            const popular = language.t("dialog.provider.group.popular")
            if (a.category === popular && b.category !== popular) return -1
            if (b.category === popular && a.category !== popular) return 1
            return 0
          }}
          onSelect={(provider) => {
            if (!provider) return
            setStep({ type: "model", agent: providerStep()!.agent, provider: provider.id })
          }}
        >
          {(provider) => (
            <div class="px-1.25 w-full flex items-center gap-x-3">
              <ProviderIcon data-slot="list-item-extra-icon" id={provider.id} />
              <span>{provider.name}</span>
              <Tag>{language.t("dialog.assignModel.provider.connected")}</Tag>
            </div>
          )}
        </List>
      ) : null}

      {modelStep() ? (
        <ModelList
          provider={modelStep()!.provider}
          model={modelState()}
          onSelect={() => {}}
        />
      ) : null}

      {scopeStep() ? (
        <List
          search={false}
          key={(item) => item.id}
          items={[
            {
              id: "project",
              title: language.t("dialog.assignModel.scope.project"),
              description: language.t("dialog.assignModel.scope.project.description"),
            },
            {
              id: "global",
              title: language.t("dialog.assignModel.scope.global"),
              description: language.t("dialog.assignModel.scope.global.description"),
            },
          ]}
          onSelect={(item) => {
            if (!item) return
            void handleScopeSelect(item.id as "global" | "project")
          }}
        >
          {(item) => (
            <div class="w-full flex items-center gap-2 text-13-regular">
              <span class="truncate">{item.title}</span>
              <span class="text-text-weak truncate">{item.description}</span>
            </div>
          )}
        </List>
      ) : null}
    </Dialog>
  )
}
