import { meta, type Settings } from "../meta.js"
import { config } from "../meta-settings.js"

export type { Settings } from "../meta.js"

export const model = (modelID: string, settings?: Settings) => meta.configure(config(settings)).image(modelID)
