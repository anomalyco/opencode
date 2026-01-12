#!/usr/bin/env node

// Simple test for terminal restoration changes
// This script simulates the signal handling we added

console.log("Testing macOS terminal restoration...")

// Test isMacOSTerminal function
const isMacOSTerminal = () => {
  return (
    process.platform === "darwin" &&
    (process.env.TERM_PROGRAM === "Apple_Terminal" ||
      process.env.TERM_PROGRAM === "iTerm.app" ||
      process.env.TERM?.includes("xterm") ||
      process.env.TERM?.includes("screen"))
  )
}

console.log("Platform:", process.platform)
console.log("Terminal:", process.env.TERM_PROGRAM || process.env.TERM)
console.log("Is macOS terminal:", isMacOSTerminal())

// Test escape sequences
const testTerminalReset = () => {
  try {
    process.stdout.write("\x1bc") // Reset terminal
    process.stdout.write("\x1b[?1049l") // Restore normal screen buffer
    process.stdout.write("\x1b[?47l") // Disable alternate screen
    process.stdout.write("\x1b[0m") // Reset attributes
    process.stdout.write("\x1b[2J") // Clear screen
    process.stdout.write("\x1b[H") // Move cursor to top-left
    console.log("✓ Terminal reset sequences executed successfully")
  } catch (e) {
    console.log("✗ Error executing terminal reset:", e.message)
  }
}

console.log("Testing terminal reset sequences...")
testTerminalReset()

// Test signal handling setup
let signalHandlersCleared = false

const setupSignalHandlers = (renderer) => {
  const handleSigint = () => {
    console.log("SIGINT received - would clean up and exit")
    renderer.setTerminalTitle("")
    renderer.destroy()
    process.exit(0)
  }

  const handleSighup = () => {
    console.log("SIGHUP received - would clean up and exit")
    renderer.setTerminalTitle("")
    renderer.destroy()
    process.exit(0)
  }

  const handleSigterm = () => {
    console.log("SIGTERM received - would clean up and exit")
    renderer.setTerminalTitle("")
    renderer.destroy()
    process.exit(0)
  }

  process.on("SIGINT", handleSigint)
  process.on("SIGHUP", handleSighup)
  process.on("SIGTERM", handleSigterm)

  return () => {
    process.off("SIGINT", handleSigint)
    process.off("SIGHUP", handleSighup)
    process.off("SIGTERM", handleSigterm)
    signalHandlersCleared = true
    console.log("✓ Signal handlers cleared")
  }
}

// Mock renderer for testing
const mockRenderer = {
  setTerminalTitle: (title) => console.log(`Setting terminal title: "${title}"`),
  destroy: () => console.log("Renderer destroy called"),
}

console.log("Testing signal handler setup...")
const cleanup = setupSignalHandlers(mockRenderer)

console.log("Sending SIGINT signal...")
process.emit("SIGINT")

setTimeout(() => {
  if (signalHandlersCleared) {
    console.log("✓ All tests passed!")
    process.exit(0)
  } else {
    console.log("✗ Signal handlers not cleared properly")
    process.exit(1)
  }
}, 100)
