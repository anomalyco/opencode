import { readFile } from "node:fs/promises"

const modelsUrl = process.env.OPENCODE_MODELS_URL || "https://models.dev"

export const modelsData = process.env.MODELS_DEV_API_JSON
  ? await readFile(process.env.MODELS_DEV_API_JSON, "utf8")
  : await fetch(`${modelsUrl}/api.json`).then((response) => response.text())

console.log("Loaded models.dev snapshot")
