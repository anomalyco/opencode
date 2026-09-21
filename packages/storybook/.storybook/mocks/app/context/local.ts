import { createSignal } from "solid-js"

const model = {
  id: "claude-3-7-sonnet",
  name: "Claude 3.7 Sonnet",
  provider: { id: "anthropic" },
  variants: { fast: {}, thinking: {} },
  capabilities: { input: { text: true, audio: false, image: true, video: false, pdf: true } },
}

const agents = [{ name: "build" }, { name: "review" }, { name: "plan" }]

const [agent, setAgent] = createSignal(agents[0].name)
const [variant, setVariant] = createSignal<string | undefined>(undefined)
const ready = Object.assign(() => true, { promise: Promise.resolve() })

export function useLocal() {
  return {
    slug: () => "c3Rvcnk=",
    session: {
      ready: () => true,
      reset() {},
    },
    agent: {
      list: () => agents,
      current: () => agents.find((item) => item.name === agent()) ?? agents[0],
      visible: () => false,
      set(value?: string) {
        if (!value) {
          setAgent(agents[0].name)
          return
        }
        const hit = agents.find((item) => item.name === value)
        setAgent(hit?.name ?? agents[0].name)
      },
    },
    model: {
      ready,
      current: () => model,
      recent: () => [model],
      list: () => [model],
      cycle() {},
      set() {},
      visible: () => true,
      setVisibility() {},
      trackSessionCommit() {},
      variant: {
        list: () => Object.keys(model.variants),
        current: () => variant(),
        configured: () => undefined,
        selected: () => variant(),
        set(next?: string) {
          setVariant(next)
        },
        cycle() {},
      },
    },
  }
}
