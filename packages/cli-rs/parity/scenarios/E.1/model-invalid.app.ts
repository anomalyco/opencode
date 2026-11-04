// `--model` without a provider (T27): a warning toast on the home.
import { defineApp } from "../../lib/app"

const prompt = { x: 0, y: 9, width: 100, height: 12, reason: "the home prompt is T.1's stand-in (T17-home-prompt)" }

export default defineApp({
  args: { model: "gpt-5" },
  steps: [{ checkpoint: "toast", until: "Invalid model format: gpt-5", masks: [prompt] }],
})
