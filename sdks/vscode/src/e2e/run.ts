import { downloadInsiders, run, extensionTestsPath } from "./fixtures"

async function main() {
  try {
    await downloadInsiders()
    // Run the extension tests (including E2E tests in test/suite)
    await run(extensionTestsPath)
  } catch (error) {
    console.error("E2E tests failed:", error)
    process.exit(1)
  }
}

main()
