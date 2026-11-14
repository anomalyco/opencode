// The twin of `../kept.rs` on the JS host (P6a on the pipe, `carrier-equal`): a V2 `{ id, setup }` module whose route
// hears its mounts begin and end, keeps its root while what it shows is the same, holds a box it can hide, and shows
// what a read of one message gives.

export default {
  id: "example.kept",
  setup(api: any) {
    const carrier = api[Symbol.for("opencode.carrier")]
    const state = { bumps: 0, hidden: false, begun: 0, ended: 0 }
    let shown: string | undefined
    carrier.watch("message", { type: "message", session: "ses_a", message: "msg_1" })
    carrier.command({ name: "kept.bump", title: "kept.bump" }, () => {
      state.bumps += 1
    })
    carrier.command({ name: "kept.hide", title: "kept.hide" }, () => {
      state.hidden = !state.hidden
    })
    // Changes nothing: the view after it keeps its root, and its memo with it.
    carrier.command({ name: "kept.same", title: "kept.same" }, () => {})
    const on = (event: any) => {
      if (event.type !== "mount") return "pass"
      if (event.mounted) state.begun += 1
      else state.ended += 1
      return "pass"
    }
    carrier.surface(
      "kept",
      { type: "route", name: "kept" },
      (cx: any) => {
        const message = carrier.read("message")
        const now = JSON.stringify([state, message?.id ?? null])
        if (!cx.input.full && shown === now) return { type: "keep", key: "kept-root" }
        shown = now
        const line = `kept ${state.bumps} · begun ${state.begun} · ended ${state.ended} · message ${message?.id ?? "none"}`
        return {
          type: "box",
          id: "kept-root",
          children: [
            { type: "text", id: "kept", spans: [{ text: line }] },
            { type: "box", id: "extra", visible: !state.hidden, children: [{ type: "text", spans: [{ text: "extra" }] }] },
            cx.memo("below", 0, () => ({ type: "text", spans: [{ text: "below" }] })),
          ],
        }
      },
      { on, mounts: true },
    )
  },
}
