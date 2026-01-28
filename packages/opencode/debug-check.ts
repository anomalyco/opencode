// Debug script to check LOCAL_FRONTEND and paths
console.log("=== Debug Check ===")
console.log("1. LOCAL_FRONTEND:", process.env.LOCAL_FRONTEND)

const distPath = import.meta.dir.replace(/[/\\][^/\\]*$/, "") + "/app/dist"
console.log("2. distPath:", distPath)

const indexPath = distPath + "/index.html"
console.log("3. indexPath:", indexPath)

const file = Bun.file(indexPath)
const exists = await file.exists()
console.log("4. File exists:", exists)

if (exists) {
  const content = await file.text()
  console.log("5. First 200 chars:", content.substring(0, 200))

  // Check if it's the modified version with your features
  const hasBrowserPanel = content.includes("BrowserPanel")
  const hasHTMLPreview = content.includes("HTMLPreview")

  console.log("\n=== Feature Check ===")
  console.log("Has BrowserPanel:", hasBrowserPanel)
  console.log("Has HTMLPreview:", hasHTMLPreview)
}

// Check dist assets
const assetsDir = distPath + "/assets"
try {
  const assets = Bun.file(assetsDir + "/index.js").exists()
  console.log("\n6. Assets check:", assets)
} catch {
  console.log("\n6. Assets: not checked")
}
