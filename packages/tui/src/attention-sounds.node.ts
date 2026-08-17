import { createRequire } from "node:module"
import path from "node:path"

const require = createRequire(import.meta.url)
const resolve = (name: string) => {
  const key = `@opencode-ai/ui/audio/${name}`
  return process.env.OPENCODE_NODE_ASSETS_DIR
    ? path.join(process.env.OPENCODE_NODE_ASSETS_DIR, key)
    : require.resolve(key)
}

export const defaultSoundPath = resolve("bip-bop-01.mp3")
export const questionSoundPath = resolve("bip-bop-03.mp3")
export const permissionSoundPath = resolve("staplebops-06.mp3")
export const errorSoundPath = resolve("nope-03.mp3")
export const subagentDoneSoundPath = resolve("yup-01.mp3")
