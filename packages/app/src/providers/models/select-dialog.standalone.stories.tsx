import { Button } from "@opencode/ui/button"
import { useDialog } from "@opencode/ui/context/dialog"
import { onMount } from "solid-js"
import { createStore } from "solid-js/store"
import { DialogStoryRuntime } from "@/components-lab/dialog-story-runtime"
import type { ModelSelection } from "./selection"
import { DialogSelectModel } from "./select-dialog"

type StoryModel = NonNullable<ReturnType<ModelSelection["current"]>>

function makeModel(input: {
  id: string
  name: string
  providerID: string
  providerName: string
  family: string
  inputCost: number
  outputCost: number
  latest?: boolean
  variants?: StoryModel["variants"]
}): StoryModel {
  return {
    id: input.id,
    providerID: input.providerID,
    api: {
      id: input.id,
      url: `https://api.${input.providerID}.example/v1`,
      npm: `@opencode/ai/providers/${input.providerID}`,
    },
    name: input.name,
    family: input.family,
    capabilities: {
      temperature: true,
      reasoning: true,
      attachment: true,
      toolcall: true,
      input: { text: true, audio: false, image: true, video: false, pdf: false },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: true,
    },
    cost: { input: input.inputCost, output: input.outputCost, cache: { read: 0, write: 0 } },
    limit: { context: 200_000, output: 64_000 },
    status: "active",
    options: {},
    headers: {},
    release_date: "2026-09-01",
    variants: input.variants ?? {},
    provider: {
      id: input.providerID,
      name: input.providerName,
      source: "custom",
      env: [],
      options: {},
      models: {},
    },
    latest: input.latest ?? false,
  }
}

const models: StoryModel[] = [
  makeModel({
    id: "kimi-k3",
    name: "Kimi K3",
    providerID: "opencode-go",
    providerName: "OpenCode Go",
    family: "kimi",
    inputCost: 1,
    outputCost: 3,
    variants: { fast: {}, thinking: {} },
  }),
  makeModel({
    id: "big-pickle",
    name: "Big Pickle",
    providerID: "opencode",
    providerName: "OpenCode Zen",
    family: "pickle",
    inputCost: 0,
    outputCost: 0,
  }),
  makeModel({
    id: "claude-opus-5-5",
    name: "Claude Opus 5.5",
    providerID: "opencode",
    providerName: "OpenCode Zen",
    family: "claude-opus",
    inputCost: 5,
    outputCost: 25,
    variants: { high: {}, max: {} },
  }),
  makeModel({
    id: "claude-sonnet-5",
    name: "Claude Sonnet 5",
    providerID: "anthropic",
    providerName: "Anthropic",
    family: "claude-sonnet",
    inputCost: 3,
    outputCost: 15,
    variants: { thinking: {} },
  }),
]

const keyOf = (model: StoryModel) => `${model.provider.id}:${model.id}`

function SelectorStory(props: { favorite?: boolean }) {
  const dialog = useDialog()

  const [store, setStore] = createStore<{ current: string; favorite: string[]; variant?: string }>({
    current: "opencode:claude-opus-5-5",
    favorite: props.favorite ? ["anthropic:claude-sonnet-5"] : [],
  })

  const find = (key: string) => models.find((model) => keyOf(model) === key)

  const selection = {
    ready: Object.assign(() => true, { promise: undefined }),
    key: () => {
      const item = find(store.current)

      return item ? { providerID: item.provider.id, modelID: item.id } : undefined
    },
    current: () => find(store.current),
    recent: () => (props.favorite ? [find(store.current)].filter((model) => !!model) : []),
    favorite: {
      list: () => store.favorite.flatMap((key) => find(key) ?? []),
      toggle: (key: { providerID: string; modelID: string }) => {
        const id = `${key.providerID}:${key.modelID}`

        setStore("favorite", (ids) => (ids.includes(id) ? ids.filter((entry) => entry !== id) : [id, ...ids]))
      },
    },
    list: () => models,
    cycle() {},
    set: (key: { providerID: string; modelID: string } | undefined) => {
      if (key) setStore("current", `${key.providerID}:${key.modelID}`)
    },
    visible: () => true,
    setVisibility() {},
    variant: {
      configured: () => undefined,
      selected: () => store.variant,
      current: () => store.variant,
      list: () => Object.keys(find(store.current)?.variants ?? {}),
      set: (variant: string | undefined) => setStore("variant", variant),
      cycle() {},
    },
  } satisfies ModelSelection

  const open = () => void dialog.show(() => <DialogSelectModel model={selection} />)

  onMount(open)

  return (
    <div class="flex min-h-[280px] items-end justify-center">
      <Button variant="ghost-muted" onClick={open}>
        {find(store.current)?.name}
      </Button>
    </div>
  )
}

export default {
  title: "App/Dialogs/Model Selector",
  id: "app-dialog-model-selector",
}

export const Dialog = {
  render: () => (
    <DialogStoryRuntime>
      <SelectorStory />
    </DialogStoryRuntime>
  ),
}

export const Favorites = {
  render: () => (
    <DialogStoryRuntime>
      <SelectorStory favorite />
    </DialogStoryRuntime>
  ),
}
