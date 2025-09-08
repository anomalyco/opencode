#!/usr/bin/env bun

// Simple test to verify background process handling works

import { runningProcesses } from "../src/tool/bash"

async function test() {
  console.log("Testing background process handling...")

  // Mock a simple long-running process
  const { exec } = await import("child_process")
  const { randomUUID } = await import("crypto")

  const processId = randomUUID()
  const command = 'while true; do echo "Test output $(date)"; sleep 1; done'

  console.log("Starting test process...")
  const childProcess = exec(command, { shell: "/bin/bash" })

  if (!childProcess.pid) {
    console.error("Failed to start process")
    process.exit(1)
  }

  // Add to running processes
  runningProcesses.set(processId, {
    process: childProcess,
    id: processId,
    output: [],
    bufferSize: 0,
    readCursor: 0,
    metadata: {
      command,
      startTime: Date.now(),
      lastOutputTime: Date.now(),
      pid: childProcess.pid,
      bufferWarnings: 0,
      status: "running",
    },
  })

  // Capture output
  childProcess.stdout?.on("data", (chunk) => {
    const proc = runningProcesses.get(processId)
    if (proc) {
      const text = chunk.toString()
      proc.output.push(text)
      proc.bufferSize += text.length
      proc.metadata.lastOutputTime = Date.now()
      console.log("Output:", text.trim())
    }
  })

  console.log(`Process started with ID: ${processId}, PID: ${childProcess.pid}`)
  console.log("Running processes:", runningProcesses.size)

  // Wait 3 seconds then kill
  setTimeout(() => {
    console.log("\nKilling process...")
    childProcess.kill()
    runningProcesses.delete(processId)
    console.log("Process killed. Running processes:", runningProcesses.size)
    process.exit(0)
  }, 3000)
}

test()
