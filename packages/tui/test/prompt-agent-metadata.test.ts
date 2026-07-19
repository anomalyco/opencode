import { expect, test } from "bun:test"
import { resolvePromptMetadata } from "../src/component/prompt"

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
