import { createComponent, createContext, createSignal, useContext, type ParentProps } from "solid-js"
import { createStore } from "solid-js/store"
import { useModels } from "@/providers/models/models"
import { useWorkspaceLocation } from "@/workspaces/location"
import type { ModelKey, ModelSelection } from "../../../../app/src/providers/models/selection"

export type { ModelKey, ModelSelection } from "../../../../app/src/providers/models/selection"

const defaultModel = {
  id: "claude-3-7-sonnet",
  providerID: "anthropic",
  api: { id: "claude-3-7-sonnet", url: "https://api.anthropic.com", npm: "@ai-sdk/anthropic" },
  name: "Claude 3.7 Sonnet",
  family: "claude-sonnet",
  capabilities: {
    temperature: true,
    reasoning: true,
    attachment: true,
    toolcall: true,
    input: { text: true, audio: false, image: true, video: false, pdf: true },
    output: { text: true, audio: false, image: false, video: false, pdf: false },
    interleaved: true,
  },
  cost: { input: 3, output: 15, cache: { read: 0, write: 0 } },
  limit: { context: 200_000, output: 64_000 },
  status: "active" as const,
  options: {},
  headers: {},
  release_date: "2026-09-01",
  variants: { fast: {}, thinking: {} },
  provider: {
    id: "anthropic",
    name: "Anthropic",
    source: "custom" as const,
    env: [],
    options: {},
    models: {},
  },
  latest: true,
}

const agents = [{ name: "build" }, { name: "review" }, { name: "plan" }]

const [agent, setAgent] = createSignal(agents[0].name)

const [variant, setVariant] = createSignal<string | undefined>(undefined)

const fallbackModel: ModelSelection = {
  ready: Object.assign(() => true, { promise: undefined }),
  key: () => ({ providerID: defaultModel.provider.id, modelID: defaultModel.id }),
  current: () => defaultModel,
  recent: () => [defaultModel],
  favorite: { list: () => [], toggle() {} },
  list: () => [defaultModel],
  cycle() {},
  set() {},
  visible: () => true,
  setVisibility() {},
  variant: {
    configured: () => undefined,
    selected: variant,
    current: variant,
    list: () => Object.keys(defaultModel.variants),
    set: setVariant,
    cycle() {},
  },
}

function makeDefaultLocal() {
  return {
    slug: () => "c3Rvcnk=",
    agent: {
      list: () => agents,
      visible: () => true,
      current: () => agents.find((item) => item.name === agent()) ?? agents[0],
      set(value?: string) {
        if (!value) {
          setAgent(agents[0].name)

          return
        }

        const hit = agents.find((item) => item.name === value)
        setAgent(hit?.name ?? agents[0].name)
      },
      move() {},
    },
    model: fallbackModel,
  }
}

type LocalValue = ReturnType<typeof makeDefaultLocal>

const LocalContext = createContext<LocalValue>()

export function LocalProvider(props: ParentProps) {
  const models = useModels()

  const location = useWorkspaceLocation()

  const [selected, setSelected] = createStore<{ key?: ModelKey; variant?: string }>({})

  const current = () => {
    if (selected.key) return models.find(selected.key)

    return models.list()[0]
  }

  const value: LocalValue = {
    ...makeDefaultLocal(),
    slug: () => btoa(location().directory),
    model: {
      ready: models.ready,
      key: () => {
        const item = current()

        return item ? { providerID: item.provider.id, modelID: item.id } : undefined
      },
      current: () => current(),
      recent: () => models.recent.list().flatMap((item) => models.find(item) ?? []),
      favorite: {
        list: () => models.favorite.list().flatMap((item) => models.find(item) ?? []),
        toggle: models.favorite.toggle,
      },
      list: () => models.list(),
      cycle() {},
      set(next?: ModelKey) {
        setSelected("key", next)
      },
      visible: models.visible,
      setVisibility: models.setVisibility,
      variant: {
        configured: () => undefined,
        selected: () => selected.variant,
        current: () => selected.variant,
        list: () => Object.keys(current()?.variants ?? {}),
        set(next?: string) {
          setSelected("variant", next)
        },
        cycle() {},
      },
    },
  }

  return createComponent(LocalContext.Provider, {
    value,
    get children() {
      return props.children
    },
  })
}

export function useLocal() {
  return useContext(LocalContext) ?? makeDefaultLocal()
}
