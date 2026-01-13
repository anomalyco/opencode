export async function data() {
  const path = Bun.env.MODELS_DEV_API_JSON
  if (path) {
    const file = Bun.file(path)
    if (await file.exists()) {
      return await file.text()
    }
  }

  // Offline mode: skip network request
  if (Bun.env.OPENCODE_OFFLINE_MODE === "1") {
    return "{}"
  }

  // Add timeout to prevent hanging in closed networks
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 2000) // 2 second timeout

  try {
    const json = await fetch("https://models.dev/api.json", { signal: controller.signal }).then((x) => x.text())
    clearTimeout(timeoutId)
    return json
  } catch (err) {
    clearTimeout(timeoutId)
    console.warn("Failed to fetch models from models.dev, using fallback", err)
    return "{}"
  }
}
