// Rollover's GUI bundle: shows `/rollover` command output as a toast.
//
// The app evaluates this file as CommonJS text (a TypeScript source or an ES
// module is never a GUI entry), so it stays plain JavaScript and requires only
// the modules the host provides. The canonical copy lives here; copy it to the
// plugin directory after edits:
//   cp packages/rollover/gui-experimental.cjs \
//      ~/.config/opencode/plugin/rollover/gui-experimental.cjs
const { Plugin, createKeyed } = require("@opencode/plugin/gui")

// The server plugin's RPC contract (packages/rollover/src/rpc.ts) as plain
// JSON Schema; the wire event is `rpc.rollover.notify`. Keep the two in sync.
const Rollover = {
  id: "rollover",
  methods: {},
  events: {
    notify: {
      schema: {
        type: "object",
        properties: { sessionID: { type: "string" }, text: { type: "string" } },
        required: ["sessionID", "text"],
        additionalProperties: false,
      },
    },
  },
}

module.exports = Plugin.define({
  setup(context) {
    // One subscription per listed server, rebuilt when the list or a server's
    // connection state changes; the key string makes both visible to createKeyed.
    const subscriptions = new Map()
    const sync = () => {
      const ids = context.servers.list()
      for (const [id, off] of subscriptions) {
        if (!ids.includes(id)) {
          off()
          subscriptions.delete(id)
        }
      }
      for (const id of ids) {
        if (subscriptions.has(id)) continue
        const server = context.servers.get(id)
        if (!server || !server.connected) continue
        const off = server.client.rpc(Rollover).events.on("notify", (event) => {
          context.toast.show({ title: "Rollover", description: event.data.text })
        })
        subscriptions.set(id, off)
      }
    }
    createKeyed(
      () =>
        context.servers
          .list()
          .map((id) => `${id}:${context.servers.get(id)?.connected ? "1" : "0"}`)
          .join("\u0000"),
      sync,
    )

    return () => {
      for (const off of subscriptions.values()) off()
      subscriptions.clear()
    }
  },
})
