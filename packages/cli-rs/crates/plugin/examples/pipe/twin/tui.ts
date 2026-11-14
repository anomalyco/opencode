// The twin of `../twin.rs` on the JS host (P7, `carrier-equal`): a V2 `{ id, setup }` module whose route surface is a
// board of cards, each a value and a patch by content handle, memoized on its value, below a header with their total.
// Its commands come through `keymap.layer` as a V2 plugin's do; its surface and effects through the carrier.

const CARDS = 6

export default {
  id: "example.twin",
  setup(api: any) {
    const carrier = api[Symbol.for("opencode.carrier")]
    const values = Array.from({ length: CARDS }, () => 0)
    api.keymap.layer(() => ({
      commands: [
        {
          id: "twin.bump",
          title: "twin.bump",
          run(input?: string) {
            values[(Number(input) || 0) % CARDS] += 1
          },
        },
        { id: "twin.toast", title: "twin.toast", run: () => api.ui.toast.show({ message: "the twin says hi" }) },
        {
          id: "twin.throw",
          title: "twin.throw",
          run() {
            throw new Error("the twin's command threw")
          },
        },
      ],
    }))
    carrier.surface("twin", { type: "route", name: "twin" }, (cx: any) => {
      const cards = values.map((value, index) =>
        cx.memo(`card-${index}`, value, () => ({
          type: "box",
          children: [
            { type: "text", spans: [{ text: `card ${index}: ${value}` }], fg: "text.muted" },
            { type: "diff", content: { content: cx.content(`@@ -1 +1 @@\n-card ${index}\n+card ${index} is ${value}\n`) } },
          ],
        })),
      )
      const total = values.reduce((sum, value) => sum + value, 0)
      return {
        type: "box",
        id: "twin",
        layout: { grow: true },
        children: [
          { type: "text", id: "header", spans: [{ text: `twin ${total} · ${cx.input.width}` }] },
          { type: "scroll", id: "cards", layout: { grow: true }, children: cards },
        ],
      }
    })
  },
}
