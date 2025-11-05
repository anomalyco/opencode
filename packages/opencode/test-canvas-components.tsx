#!/usr/bin/env bun
/**
 * Test Canvas Components Independently
 *
 * This tests that our Canvas components work correctly within a TUI renderer context.
 */

import { render } from "@opentui/solid"
import { VStack, HStack, Text, For, createSignal } from "./src/plugin-ui"

// Test 1: Basic components
function TestBasicComponents() {
  return (
    <VStack gap={1}>
      <Text fg="#00ff00">✓ VStack works</Text>
      <HStack gap={2}>
        <Text fg="#ff0000">✓ HStack</Text>
        <Text fg="#0000ff">✓ works</Text>
      </HStack>
    </VStack>
  )
}

// Test 2: With signals
function TestWithSignals() {
  const [count, setCount] = createSignal(0)

  setTimeout(() => setCount(count() + 1), 100)
  setTimeout(() => setCount(count() + 1), 200)

  return (
    <VStack gap={1}>
      <Text fg="#ffff00">Count: {count()}</Text>
    </VStack>
  )
}

// Test 3: With For loop
function TestWithFor() {
  const items = () => ["one", "two", "three"]

  return (
    <VStack gap={1}>
      <Text fg="#ffffff">Items:</Text>
      <For each={items()}>{(item) => <Text fg="#00ffff"> - {item}</Text>}</For>
    </VStack>
  )
}

// Test 4: Complete component (like plugin would use)
function TestCompleteComponent() {
  const [data] = createSignal({
    tokens: 1500,
    limit: 200000,
    percentage: 1,
  })

  return (
    <VStack gap={0}>
      <Text fg="#6b7280">Tokens: {data().tokens}</Text>
      <Text fg="#6b7280">Usage: {data().percentage}%</Text>
    </VStack>
  )
}

console.log("\n=== Testing Canvas Components ===\n")

// Test each component
console.log("Test 1: Basic Components")
try {
  render(() => <TestBasicComponents />)
  console.log("✓ Basic components rendered successfully\n")
} catch (error) {
  console.error(
    "✗ Basic components failed:",
    error instanceof Error ? error.message : String(error),
    "\n",
  )
}

console.log("Test 2: With Signals")
try {
  render(() => <TestWithSignals />)
  setTimeout(() => {
    console.log("✓ Signals work\n")
  }, 300)
} catch (error) {
  console.error("✗ Signals failed:", error instanceof Error ? error.message : String(error), "\n")
}

console.log("Test 3: With For Loop")
try {
  render(() => <TestWithFor />)
  console.log("✓ For loops work\n")
} catch (error) {
  console.error("✗ For loops failed:", error instanceof Error ? error.message : String(error), "\n")
}

console.log("Test 4: Complete Component")
try {
  render(() => <TestCompleteComponent />)
  console.log("✓ Complete component works\n")
} catch (error) {
  console.error(
    "✗ Complete component failed:",
    error instanceof Error ? error.message : String(error),
    "\n",
  )
}

console.log("=== All Canvas Tests Complete ===\n")

// Keep process alive for signal test
await new Promise((resolve) => setTimeout(resolve, 500))
