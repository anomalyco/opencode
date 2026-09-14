export {}

const path = "dist/server/wrangler.json"
const config = await Bun.file(path).json()

delete config.kv_namespaces
delete config.images
delete config.previews

await Bun.write(path, JSON.stringify(config))
