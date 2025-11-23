export async function data() {
  const path = Bun.env.MODELS_DEV_API_JSON
  if (path) {
    const file = Bun.file(path)
    if (await file.exists()) {
      return await file.text()
    }
  }
  if (Bun.env.OPENCODE_OFFLINE === "1") return "{}"
  const json = await fetch("https://models.dev/api.json").then((x) => x.text())
  return json
}
