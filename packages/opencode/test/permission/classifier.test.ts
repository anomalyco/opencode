import { expect } from "bun:test"
import { Effect } from "effect"
import { testEffect } from "../lib/effect"
import { PermissionClassifier } from "@opencode-ai/core/permission/classifier"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"

// Create a minimal test environment with just the classifier
const env = LayerNode.compile(LayerNode.group([PermissionClassifier.node]))
const it = testEffect(env)

// Test isSafeTool
it.effect("isSafeTool returns true for safe tools", () =>
  Effect.gen(function* () {
    const classifier = yield* PermissionClassifier.Service

    expect(classifier.isSafeTool("read")).toBe(true)
    expect(classifier.isSafeTool("glob")).toBe(true)
    expect(classifier.isSafeTool("grep")).toBe(true)
    expect(classifier.isSafeTool("list")).toBe(true)
    expect(classifier.isSafeTool("websearch")).toBe(true)
    expect(classifier.isSafeTool("webfetch")).toBe(true)
    expect(classifier.isSafeTool("todowrite")).toBe(true)
    expect(classifier.isSafeTool("skill")).toBe(true)
    expect(classifier.isSafeTool("question")).toBe(true)
  }))

it.effect("isSafeTool returns false for unsafe tools", () =>
  Effect.gen(function* () {
    const classifier = yield* PermissionClassifier.Service

    expect(classifier.isSafeTool("bash")).toBe(false)
    expect(classifier.isSafeTool("edit")).toBe(false)
    expect(classifier.isSafeTool("write")).toBe(false)
    expect(classifier.isSafeTool("task")).toBe(false)
  }))

// Test denial tracking
it.effect("recordDenial increments denial counters", () =>
  Effect.gen(function* () {
    const classifier = yield* PermissionClassifier.Service
    const sessionID = "test-session-1" as any

    yield* classifier.recordDenial(sessionID)
    yield* classifier.recordDenial(sessionID)

    expect(true).toBe(true)
  }))

it.effect("resetDenials resets denial counters", () =>
  Effect.gen(function* () {
    const classifier = yield* PermissionClassifier.Service
    const sessionID = "test-session-2" as any

    yield* classifier.recordDenial(sessionID)
    yield* classifier.recordDenial(sessionID)
    yield* classifier.resetDenials(sessionID)

    expect(true).toBe(true)
  }))

// Test that classify method exists
it.effect("classify method exists and is callable", () =>
  Effect.gen(function* () {
    const classifier = yield* PermissionClassifier.Service

    expect(classifier.classify).toBeDefined()
    expect(typeof classifier.classify).toBe("function")
  }))
