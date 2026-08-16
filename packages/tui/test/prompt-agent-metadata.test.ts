import { expect, test } from "bun:test"
import { resolvePromptAgentGate, resolvePromptMetadata, resolveSlashCommandGate } from "../src/component/prompt"

test("loading agent leaves cached model metadata without a separator", () => {
  expect(resolvePromptMetadata({ agentStatus: "loading", hasAgent: false, hasModel: true })).toEqual({
    agent: "empty",
    visible: true,
    separator: false,
  })
})

test("loaded agent replaces loading", () => {
  expect(resolvePromptMetadata({ agentStatus: "complete", hasAgent: true, hasModel: true })).toEqual({
    agent: "agent",
    visible: true,
    separator: true,
  })
})

test("settled empty agents leave model metadata without a separator", () => {
  expect(resolvePromptMetadata({ agentStatus: "complete", hasAgent: false, hasModel: true })).toEqual({
    agent: "empty",
    visible: true,
    separator: false,
  })
})

test("loading agent without a cached model leaves a blank row", () => {
  expect(resolvePromptMetadata({ agentStatus: "loading", hasAgent: false, hasModel: false })).toEqual({
    agent: "empty",
    visible: false,
    separator: false,
  })
})

test("settled empty metadata leaves a blank row", () => {
  expect(resolvePromptMetadata({ agentStatus: "complete", hasAgent: false, hasModel: false })).toEqual({
    agent: "empty",
    visible: false,
    separator: false,
  })
})

test("empty prompt does not request agent loading attention", () => {
  expect(resolvePromptAgentGate({ hasInput: false, agentStatus: "loading", hasAgent: false })).toBe("empty")
})

test("non-empty prompt identifies the deferred agent loading gate", () => {
  expect(resolvePromptAgentGate({ hasInput: true, agentStatus: "loading", hasAgent: false })).toBe("loading")
})

test("settled missing agent remains unavailable without loading attention", () => {
  expect(resolvePromptAgentGate({ hasInput: true, agentStatus: "complete", hasAgent: false })).toBe("unavailable")
})

test("available agent allows submission", () => {
  expect(resolvePromptAgentGate({ hasInput: true, agentStatus: "complete", hasAgent: true })).toBe("ready")
})

test("failed agent loading blocks stale agents", () => {
  expect(resolvePromptAgentGate({ hasInput: true, agentStatus: "error", hasAgent: true })).toBe("unavailable")
  expect(resolvePromptMetadata({ agentStatus: "error", hasAgent: true, hasModel: true })).toEqual({
    agent: "empty",
    visible: true,
    separator: false,
  })
})

test("slash commands wait for the server command catalog", () => {
  expect(resolveSlashCommandGate({ mode: "normal", text: "/review", commandStatus: "loading" })).toBe("loading")
  expect(resolveSlashCommandGate({ mode: "normal", text: "/review", commandStatus: "error" })).toBe("error")
})

test("slash-shaped input can submit after the server command catalog settles", () => {
  expect(resolveSlashCommandGate({ mode: "normal", text: "/unknown", commandStatus: "complete" })).toBe("ready")
})

test("shell and ordinary prompts do not depend on the server command catalog", () => {
  expect(resolveSlashCommandGate({ mode: "shell", text: "/bin/pwd", commandStatus: "loading" })).toBe("normal")
  expect(resolveSlashCommandGate({ mode: "normal", text: "hello", commandStatus: "loading" })).toBe("normal")
})
