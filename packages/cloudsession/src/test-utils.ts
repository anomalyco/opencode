/**
 * Auto-generated type validation utilities for sessions API tests
 * Generated from SDK types - DO NOT EDIT MANUALLY
 * Run 'bun generate-test-types' to update when SDK types change
 */

import type { Session, Message, Part, FileDiff, Model } from "../src/types"
import { expect } from "bun:test"

/**
 * Type validation utility that automatically updates with SDK changes
 */
export function validateTypeStructure(obj: any, typeName: string, expectedProperties: string[]) {
  expectedProperties.forEach((prop) => {
    expect(obj).toHaveProperty(prop)
  })
  return true
}

/**
 * Automatically generated property lists from SDK types
 * These will update when SDK types change
 */

export const SESSION_PROPERTIES = ["id", "slug", "projectID", "directory", "title", "version", "time"]
export const MESSAGE_PROPERTIES = ["id", "sessionID", "role", "time"]
export const PART_PROPERTIES = ["id", "sessionID", "messageID", "type", "text"]
export const MODEL_PROPERTIES = ["id", "providerID", "api", "name", "capabilities", "cost", "limit", "status"]
export const FILEDIFF_PROPERTIES = ["file", "before", "after", "additions", "deletions"]

/**
 * Validate that an object matches the structure of a specific SDK type
 */

export function validateSessionStructure(obj: any) {
  return validateTypeStructure(obj, "Session", SESSION_PROPERTIES)
}
export function validateMessageStructure(obj: any) {
  return validateTypeStructure(obj, "Message", MESSAGE_PROPERTIES)
}
export function validatePartStructure(obj: any) {
  return validateTypeStructure(obj, "Part", PART_PROPERTIES)
}
export function validateModelStructure(obj: any) {
  return validateTypeStructure(obj, "Model", MODEL_PROPERTIES)
}
export function validateFileDiffStructure(obj: any) {
  return validateTypeStructure(obj, "FileDiff", FILEDIFF_PROPERTIES)
}

/**
 * Create properly typed test data that matches SDK types
 */
export function createTestSession(overrides: Partial<Session> = {}): Session {
  const baseSession: Session = {
    id: "test-" + Date.now(),
    slug: "test-session",
    projectID: "test-project",
    directory: "/test",
    title: "Test Session",
    version: "1.0",
    time: {
      created: Date.now(),
      updated: Date.now(),
    },
  }
  return { ...baseSession, ...overrides }
}

export function createTestMessage(overrides: Partial<Message> = {}): Message {
  const baseMessage: Message = {
    id: "test-" + Date.now(),
    sessionID: "test-session",
    role: "user",
    time: { created: Date.now() },
    agent: "test-agent",
    model: {
      providerID: "test-provider",
      modelID: "test-model",
    },
  }
  return { ...baseMessage, ...overrides } as Message
}

export function createTestPart(overrides: Partial<Part> = {}): Part {
  const basePart: Extract<Part, { type: "text" }> = {
    id: "test-" + Date.now(),
    sessionID: "test-session",
    messageID: "test-message",
    type: "text",
    text: "Test content",
  }
  return { ...basePart, ...overrides } as Part
}

export function createTestModel(overrides: Partial<Model> = {}): Model {
  const baseModel: Model = {
    id: "test-" + Date.now(),
    providerID: "test-provider",
    api: {
      id: "test-api",
      url: "https://test.api.com",
      npm: "test-package",
    },
    name: "Test Model",
    capabilities: {
      temperature: true,
      reasoning: true,
      attachment: false,
      toolcall: true,
      input: { text: true, audio: false, image: false, video: false, pdf: false },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
    cost: {
      input: 0.001,
      output: 0.002,
      cache: { read: 0.0001, write: 0.0002 },
    },
    limit: { context: 4096, output: 1024 },
    status: "active",
    options: {},
    headers: {},
    release_date: "2024-01-01",
  }
  return { ...baseModel, ...overrides }
}

export function createTestFileDiff(overrides: Partial<FileDiff> = {}): FileDiff {
  const baseFileDiff: FileDiff = {
    file: "test.txt",
    before: "old content",
    after: "new content",
    additions: 1,
    deletions: 1,
  }
  return { ...baseFileDiff, ...overrides }
}
