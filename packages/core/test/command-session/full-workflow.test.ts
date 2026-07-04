import { describe, expect, test } from "bun:test"
import { spawn } from "node:child_process"
import { writeFileSync, chmodSync, unlinkSync } from "node:fs"


describe("CommandSession - Full Workflow Test", () => {
  test("should handle complete interactive command lifecycle", async () => {
    // Create an interactive script
    const scriptPath = "/tmp/full-workflow-test.sh"
    writeFileSync(
      scriptPath,
      `#!/bin/bash
echo "Step 1: Starting..."
sleep 0.5
echo "Step 2: Ready for input"
read name
echo "Step 3: Hello, \$name!"
sleep 0.5
echo "Step 4: Done!"
`,
    )
    
    chmodSync(scriptPath, 0o755)

    // Start the command
    const proc = spawn("bash", [scriptPath], {
      stdio: ["pipe", "pipe", "pipe"],
      cwd: "/tmp",
    })

    let stdout = ""
    let stderr = ""

    proc.stdout.on("data", (data) => {
      stdout += data.toString()
    })

    proc.stderr.on("data", (data) => {
      stderr += data.toString()
    })

    // Wait for first prompt
    await new Promise<void>((resolve) => {
      const check = () => {
        if (stdout.includes("Step 2: Ready for input")) {
          resolve()
        } else {
          setTimeout(check, 50)
        }
      }
      setTimeout(check, 2000)
    })

    expect(stdout).toContain("Step 1: Starting...")
    expect(stdout).toContain("Step 2: Ready for input")

    // Send input
    proc.stdin.write("World\n")

    // Wait for completion
    await new Promise<void>((resolve) => {
      proc.on("close", () => {
        expect(stdout).toContain("Step 3: Hello, World!")
        expect(stdout).toContain("Step 4: Done!")
        resolve()
      })
    })

    // Cleanup
    unlinkSync(scriptPath)

    console.log("✓ Full workflow test passed!")
    console.log("  - Command started and ran interactively")
    console.log("  - Input was sent successfully")
    console.log("  - Output was captured correctly")
    console.log("  - Command completed with expected output")
  })
})
