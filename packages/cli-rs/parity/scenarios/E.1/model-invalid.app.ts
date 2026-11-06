// `--model` without a provider (T27): a warning toast on the home.
import { defineApp } from "../../lib/app"

// The home prompt's placeholder row: its example is random.
const prompt = [
  {
    x: 16,
    y: 16,
    width: 84,
    height: 1,
    reason: "the placeholder example: random in TS and Rust",
  },
]

export default defineApp({
  args: { model: "gpt-5" },
  steps: [{ checkpoint: "toast", until: "Invalid model format: gpt-5", masks: prompt }],
})
