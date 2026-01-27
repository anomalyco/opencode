import { Browser } from "./src/browser/browser"

async function testBrowser() {
  console.log("Testing browser navigate...")

  const result = await Browser.navigate({ url: "https://example.com" })

  console.log("Result:", JSON.stringify(result, null, 2))

  if (result.success) {
    console.log("✓ Browser test passed!")
    console.log("  URL:", result.data?.url)
    console.log("  Title:", result.data?.title)
  } else {
    console.log("✗ Browser test failed:", result.error)
  }

  await Browser.close()
  process.exit(result.success ? 0 : 1)
}

testBrowser().catch((error) => {
  console.error("Test error:", error)
  process.exit(1)
})
