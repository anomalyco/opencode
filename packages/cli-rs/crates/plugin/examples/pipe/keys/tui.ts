// Modal composer input probe. Its log lets the harness compare plugin and host key order.

import { appendFileSync } from "node:fs"
import path from "node:path"

export default {
  id: "example.keys",
  setup(api: any) {
    const carrier = api[Symbol.for("opencode.carrier")]
    const log = (entry: unknown) => appendFileSync(path.join(import.meta.dir, "..", ".keys.log.jsonl"), JSON.stringify(entry) + "\n")
    const effect = (request: unknown) => carrier.effect(request)
    const said = (owner: string) => (event: any) => {
      const what = { key: event.bind ?? `any ${event.key}`, pointer: `pointer ${event.kind}` }[event.type as string]
      log({ [owner]: what ?? event.type })
      return "consume"
    }
    carrier.layer(
      {
        scope: "composer",
        keys: [
          { key: "ctrl+n", name: "normal", hold: true },
          { key: "x", name: "hold", hold: true },
        ],
      },
      (event: any) => {
        said("setup")(event)
        if (event.bind === "normal") effect({ type: "set-mode", mode: "normal" })
        if (event.bind === "hold") effect({ type: "composer-edit", edit: { type: "set", text: "X:" } })
        effect({ type: "release-keys" })
      },
    )
    carrier.layer(
      {
        scope: "composer",
        mode: "normal",
        keys: [
          { key: "d", name: "d" },
          { key: "w", name: "w" },
          { key: "i", name: "insert", hold: true },
        ],
      },
      (event: any) => {
        said("normal")(event)
        if (event.bind === "insert") {
          effect({ type: "set-mode" })
          effect({ type: "release-keys" })
        }
      },
    )
    // It hears each key and lets it go on: a listener that answered "consume" would take it (contract gaps 2).
    carrier.layer({ scope: "global", any: true }, (event: any) => {
      said("any")(event)
      return "pass"
    })
    carrier.watch("mode", { type: "input-mode" })
    carrier.watch("focused", { type: "focused" })
    carrier.surface(
      "side",
      { type: "panel", name: "side" },
      () => ({
        type: "box",
        children: [
          {
            type: "text",
            spans: [{ text: `SIDE mode=${carrier.read("mode") ?? "-"} node=${carrier.read("focused")?.node ?? "-"}` }],
          },
          { type: "box", id: "a", focusable: true, pointer: true, children: [{ type: "text", selectable: false, spans: [{ text: "node a" }] }] },
        ],
      }),
      {
        on: (event: any) => {
          said("side")(event)
          if (event.bind === "open") effect({ type: "overlay", surface: "menu", anchor: { edge: "top" }, width: 20, height: 3 })
        },
        layers: [{ scope: "surface", keys: [{ key: "k", name: "k" }, { key: "o", name: "open" }] }],
      },
    )
    carrier.surface(
      "menu",
      { type: "overlay", name: "menu" },
      () => ({ type: "box", children: [{ type: "text", spans: [{ text: "MENU one" }] }] }),
      { on: said("menu"), layers: [{ scope: "surface", keys: [{ key: "m", name: "m" }] }] },
    )
    carrier.command({ name: "keys.panel", title: "keys.panel" }, () => effect({ type: "open-panel", surface: "side" }))
    carrier.command({ name: "keys.close", title: "keys.close" }, () => effect({ type: "close-panel", surface: "side" }))
    carrier.command({ name: "keys.focus", title: "keys.focus" }, () => effect({ type: "focus", node: "a" }))
  },
}
