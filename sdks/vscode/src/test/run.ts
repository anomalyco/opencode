import * as path from "path"
import { runTests } from "@vscode/test-electron"

async function main() {
  try {
    const extensionDevelopmentPath = path.resolve(__dirname, "../../")
    const extensionTestsPath = path.resolve(__dirname, "../out/test/suite")

    await runTests({ extensionDevelopmentPath, extensionTestsPath })
  } catch (err) {
    console.error("Failed to run tests")
    process.exit(1)
  }
}

main()
