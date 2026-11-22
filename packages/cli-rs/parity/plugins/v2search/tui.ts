// A V2 `{ id, setup }` plugin (FT-12): `/find` opens a select whose own search matches the options' descriptions. TS
// loads it as a local plugin; the Rust client runs it unmodified on the JS host through the V2 compatibility layer. A picked row's value shows as a toast; a line in the home footer says it loaded.
import { createElement, insert, setProp } from "@opentui/solid"

const turns = [
  { title: "10:00 · build · first", value: "t1", description: "one fish", category: "Morning" },
  { title: "10:05 · plan · second", value: "t2", description: "two fish", category: "Morning" },
  { title: "10:10 · build · third", value: "t3", description: "red fish" },
  { title: "10:15 · build · fourth", value: "t4", description: "someone else", category: "Noon" },
]

export default {
  id: "parity.v2search",
  setup(context: any) {
    context.ui.slot({
      append: "home.footer",
      render: () => {
        const line = createElement("text")
        setProp(line, "fg", context.theme.text.muted)
        insert(line, "v2search loaded")
        return line
      },
    })
    context.keymap.layer(() => ({
      mode: "global",
      commands: [
        {
          id: "parity.v2search.find",
          title: "Find a turn",
          slash: { name: "find" },
          async run() {
            const selection = context.ui.dialog.select({
              title: "Find a turn",
              options: turns,
              search: (query: string, options: typeof turns) =>
                options.filter((option) =>
                  `${option.title} ${option.description}`.toLowerCase().includes(query.toLowerCase()),
                ),
            })
            // The select is sized right after it opens.
            context.ui.dialog.set({ size: "xlarge" })
            const picked = await selection
            context.ui.toast.show({ message: `picked ${picked}` })
          },
        },
      ],
    }))
  },
}
