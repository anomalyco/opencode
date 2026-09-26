const raw = process.argv[2]
if (!raw) throw new Error("Missing worker payload")

const value = JSON.parse(raw)
if (!value || typeof value !== "object") {
  throw new Error("Invalid worker payload")
}

const msg = Object.fromEntries(Object.entries(value))
if (typeof msg.file !== "string" || typeof msg.spec !== "string" || typeof msg.target !== "string") {
  throw new Error("Invalid worker payload")
}
if (typeof msg.id !== "string") throw new Error("Invalid worker payload")

process.env.OPENCODE_PLUGIN_META_FILE = msg.file

const { PluginMeta } = await import("../../src/plugin/meta")

await PluginMeta.touch(msg.spec, msg.target, msg.id)
