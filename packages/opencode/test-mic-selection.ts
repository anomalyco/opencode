#!/usr/bin/env bun
/**
 * Test with explicit microphone selection
 */

import { spawn } from "child_process"

console.log("🎤 Testing Microphone Selection\n")

// Test different microphones
const mics = [
  { name: "Immersed", index: ":0" },
  { name: "Insta360 Link 2C", index: ":1" },
  { name: "Oz Microphone", index: ":2" },
  { name: "Pickle Microphone", index: ":3" },
  { name: "MX Brio", index: ":8" },
  { name: "MacBook Pro Microphone", index: ":10" },
  { name: "HyperX QuadCast S", index: ":11" },
]

for (const mic of mics) {
  console.log(`Testing: ${mic.name} (${mic.index})`)
  
  const proc = spawn("ffmpeg", [
    "-f", "avfoundation",
    "-i", mic.index,
    "-t", "0.5",
    "-f", "null",
    "-"
  ])
  
  proc.stderr?.on("data", () => {})
  
  const exitCode = await new Promise<number>((resolve) => {
    proc.on("exit", (code) => resolve(code || 0))
  })
  
  if (exitCode === 0) {
    console.log(`   ✅ Working\n`)
  } else {
    console.log(`   ❌ Failed\n`)
  }
}

console.log("\n💡 Recommendation:")
console.log("   For LiveKit, use: :10 (MacBook Pro Microphone)")
console.log("   Or: :11 (HyperX QuadCast S)")
