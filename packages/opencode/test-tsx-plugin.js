// Test if production binary can load TSX plugins
const pluginPath = "./examples/plugin-steering-questions/index.tsx"

console.log("Testing TSX plugin loading in production binary...")
console.log("Plugin path:", pluginPath)

import(pluginPath)
  .then((m) => {
    console.log("✅ SUCCESS: TSX Plugin loaded in production!")
    console.log("Exports:", Object.keys(m))
    console.log("Default is function:", typeof m.default === "function")
    process.exit(0)
  })
  .catch((e) => {
    console.log("❌ FAILED: Cannot load TSX in production")
    console.log("Error:", e.message)
    process.exit(1)
  })
