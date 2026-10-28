import { Plugin } from "@opencode/plugin/tui"
import { batch, createSignal } from "solid-js"

const generation = "generation 1"

export default Plugin.define({
  id: "fixture.setup-keymap",
  async setup(context) {
    const [runs, setRuns] = createSignal(0)
    let syncs = 0
    context.keymap.layer(() => ({
      commands: [
        {
          id: "fixture.sync",
          title: "Sync setup check",
          bind: "f9",
          run: () => context.ui.toast.show({ message: `Sync keymap ran ${++syncs}` }),
        },
      ],
    }))
    await Promise.resolve()
    if (context.options.fail) {
      setTimeout(
        () =>
          context.keymap.layer(() => ({
            commands: [
              {
                id: "fixture.late",
                title: "Late setup check",
                bind: "f10",
                run: () => context.ui.toast.show({ message: "Late keymap ran" }),
              },
            ],
          })),
        20,
      )
      batch(() => context.keymap.layer(() => ({ commands: [{ title: "Invalid", palette: true, run: () => {} }] })))
    }
    context.keymap.layer(() => ({
      mode: "global",
      commands: [
        {
          id: "fixture.setup",
          title: `Setup check ${runs()}`,
          palette: true,
          slash: { name: "setup-check" },
          bind: "ctrl+g",
          run() {
            setRuns((count) => count + 1)
            context.ui.toast.show({ message: `Setup keymap ran ${runs()}` })
          },
        },
        {
          id: "fixture.dialog",
          title: "Open fixture dialog",
          bind: "f8",
          run: () => context.ui.dialog.show(() => <FixtureDialog context={context} />),
        },
      ],
    }))
    context.ui.toast.show({ message: `Fixture ready ${generation}` })
  },
})

function FixtureDialog(props: { context: Plugin.Context }) {
  let presses = 0
  props.context.keymap.layer(() => ({
    mode: "global",
    commands: [{ bind: "f11", run: () => props.context.ui.toast.show({ message: `Dialog keymap ran ${++presses}` }) }],
  }))
  return <text>Fixture dialog</text>
}
