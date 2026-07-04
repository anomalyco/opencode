const modelsUrl = process.env.OPENCODE_MODELS_URL || "https://models.dev"

export const modelsData: string = process.env.MODELS_DEV_API_JSON
  ? await Bun.file(process.env.MODELS_DEV_API_JSON).text()
  : await fetch(`${modelsUrl}/api.json`)
    .then((response) => response.text())
    .catch(() => {
      console.warn(`Warning: unable to fetch models from ${modelsUrl}/api.json — embedding empty snapshot`)
      return "{}"
    })

console.log("Loaded models.dev snapshot")
