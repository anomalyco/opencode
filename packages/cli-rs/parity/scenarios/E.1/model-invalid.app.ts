// `--model` without a provider (T27): a warning toast on the home.
import { defineApp, HOME_PLACEHOLDER } from "../../lib/app"

// The home prompt's placeholder row: its example is random.
const prompt = [HOME_PLACEHOLDER]

export default defineApp({
  args: { model: "gpt-5" },
  steps: [{ checkpoint: "toast", until: "Invalid model format: gpt-5", masks: prompt }],
})
