// `--model` without a provider (T27): a warning toast on the home.
import { defineApp } from "../../lib/app"

// The home prompt's placeholder row (T17-home-prompt) and the prompt footer hints (P01-read-only-prompt).
const prompt = [
  { x: 16, y: 16, width: 84, height: 1, reason: "the placeholder: random in TS, not drawn yet in Rust (T17-home-prompt)" },
  { x: 50, y: 20, width: 50, height: 1, reason: "the prompt footer hints are E.14's (P01-read-only-prompt)" },
]

export default defineApp({
  args: { model: "gpt-5" },
  steps: [{ checkpoint: "toast", until: "Invalid model format: gpt-5", masks: prompt }],
})
