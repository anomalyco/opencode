import { configure } from "./src/providers/moonshot"

const provider = configure({
  apiKey: "test-key"
})

console.log("Provider ID:", provider.id)
console.log("Has model function:", typeof provider.model === "function")
console.log("Has chat function:", typeof provider.chat === "function")

const model = provider.model("kimi-k2-6")
console.log("Model created successfully")
console.log("✅ Provider configuration is valid")
