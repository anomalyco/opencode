import { Button } from "@opencode/ui/button"
import { useDialog } from "@opencode/ui/context/dialog"
import { onMount } from "solid-js"
import { createStore } from "solid-js/store"
import type { ModelSelection } from "./selection"
import { DialogSelectModel } from "./select-dialog"

const chatgpt = {
  id: "gpt-5.6-sol",
  providerID: "openai",
  api: { id: "gpt-5.6-sol", url: "https://api.openai.com/v1", npm: "@opencode/ai/providers/openai" },
  name: "GPT-5.6 Sol",
  family: "gpt",
  capabilities: {
    temperature: true,
    reasoning: true,
    attachment: true,
    toolcall: true,
    input: { text: true, audio: false, image: true, video: false, pdf: false },
    output: { text: true, audio: false, image: false, video: false, pdf: false },
    interleaved: true,
  },
  cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
  limit: { context: 400_000, output: 64_000 },
  status: "active",
  options: {},
  headers: {},
  release_date: "2026-09-01",
  variants: {},
  provider: {
    id: "openai",
    name: "OpenAI",
    source: "custom",
    env: [],
    options: {},
    models: {},
  },
  latest: true,
} satisfies NonNullable<ReturnType<ModelSelection["current"]>>

const models = [
  chatgpt,
  {
    ...chatgpt,
    id: "gpt-5.6-terra",
    api: { ...chatgpt.api, id: "gpt-5.6-terra" },
    name: "GPT-5.6 Terra",
    latest: false,
  },
]

function SelectorStory(props: { favorite?: boolean }) {
  const dialog = useDialog()

  const [store, setStore] = createStore<{ current: string; favorite: string[]; variant?: string }>({
    current: models[0].id,
    favorite: props.favorite ? [models[1].id] : [],
  })

  const find = (id: string) => models.find((model) => model.id === id)

  const selection = {
    ready: Object.assign(() => true, { promise: undefined }),
    key: () => ({ providerID: "openai", modelID: store.current }),
    current: () => find(store.current),
    recent: () => [find(store.current)].filter((model) => !!model),
    favorite: {
      list: () => store.favorite.flatMap((id) => find(id) ?? []),
      toggle: (key: { modelID: string }) =>
        setStore("favorite", (ids) =>
          ids.includes(key.modelID) ? ids.filter((id) => id !== key.modelID) : [key.modelID, ...ids],
        ),
    },
    list: () => models,
    cycle() {},
    set: (key: { modelID: string } | undefined) => key && setStore("current", key.modelID),
    visible: () => true,
    setVisibility() {},
    variant: {
      configured: () => undefined,
      selected: () => store.variant,
      current: () => store.variant,
      list: () => [],
      set: (variant: string | undefined) => setStore("variant", variant),
      cycle() {},
    },
  } satisfies ModelSelection

  const open = () => dialog.show(() => <DialogSelectModel model={selection} />)

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

export const Dialog = { render: () => <SelectorStory /> }

export const Favorites = { render: () => <SelectorStory favorite /> }
