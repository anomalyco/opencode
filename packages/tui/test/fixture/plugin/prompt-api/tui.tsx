import { Plugin } from "@opencode/plugin/tui"

const generation = "generation 1"

export default Plugin.define({
  id: "fixture.prompt-api",
  setup(context) {
    const prompt = context.ui.prompt
    const report = (label: string, value: boolean) => context.ui.toast.show({ message: `${label} ${value}` })
    const initial: { append?: (text: string) => boolean } = {}
    const [firstGeneration, setFirstGeneration] = context.storage.memory("first", { initial })
    if (!firstGeneration.append)
      setFirstGeneration((draft) => {
        draft.append = (text) => prompt.append(text)
      })
    context.ui.router.register({ name: "away", render: () => <text>Away route</text> })
    context.ui.slot({ append: "app", render: () => <text>draft {JSON.stringify(prompt.current() ?? null)}</text> })
    context.keymap.layer(() => ({
      mode: "global",
      commands: [
        { bind: "f3", run: () => report("append", prompt.append("[x]")) },
        { bind: "f4", run: () => report("empty", prompt.append("")) },
        { bind: "f12", run: () => report("lines", prompt.append("\r\nsecond\rthird")) },
        {
          bind: "f1",
          run() {
            try {
              prompt.append(context.options.missing)
            } catch (error) {
              context.ui.toast.show({ message: `untyped threw ${error instanceof TypeError ? "TypeError" : error}` })
            }
          },
        },
        {
          bind: "f5",
          run() {
            prompt.append(" kept")
            context.ui.router.navigate({ type: "plugin", name: "away" })
            context.ui.router.navigate({ type: "home" })
          },
        },
        {
          bind: "f6",
          run() {
            context.ui.router.navigate({ type: "plugin", name: "away" })
            report("away", prompt.append("[x]"))
          },
        },
        { bind: "f7", run: () => context.ui.router.navigate({ type: "home" }) },
        { bind: "f8", run: () => context.keymap.dispatch("prompt.clear") },
        { bind: "f9", run: () => context.keymap.dispatch("prompt.submit") },
        {
          bind: "f10",
          run() {
            prompt.append(" now")
            context.keymap.dispatch("prompt.submit")
          },
        },
        { bind: "f11", run: () => report("first", firstGeneration.append?.("[x]") ?? false) },
      ],
    }))
    context.ui.toast.show({ message: `Prompt fixture ready ${generation}` })
  },
})
