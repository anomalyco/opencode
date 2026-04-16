import { test, expect } from "bun:test"
import { FileIgnore } from "../../src/file/ignore"

test("match nested and non-nested", () => {
  expect(FileIgnore.match("node_modules/index.js")).toBe(true)
  expect(FileIgnore.match("node_modules")).toBe(true)
  expect(FileIgnore.match("node_modules/")).toBe(true)
  expect(FileIgnore.match("node_modules/bar")).toBe(true)
  expect(FileIgnore.match("node_modules/bar/")).toBe(true)
})

test("exclude .env files containing secrets", () => {
  expect(FileIgnore.match(".env")).toBe(true)
  expect(FileIgnore.match(".env.local")).toBe(true)
  expect(FileIgnore.match(".env.production")).toBe(true)
  expect(FileIgnore.match(".env.development")).toBe(true)
  expect(FileIgnore.match(".env.development.local")).toBe(true)
  expect(FileIgnore.match(".env.test")).toBe(true)
  expect(FileIgnore.match(".env.example")).toBe(true)
  expect(FileIgnore.match(".env.template")).toBe(true)
  expect(FileIgnore.match(".env.sample")).toBe(true)
})

test("exclude nested .env files", () => {
  expect(FileIgnore.match("config/.env")).toBe(true)
  expect(FileIgnore.match("config/.env.local")).toBe(true)
  expect(FileIgnore.match("apps/web/.env")).toBe(true)
  expect(FileIgnore.match("apps/web/.env.production")).toBe(true)
  expect(FileIgnore.match("deep/nested/dir/.env")).toBe(true)
  expect(FileIgnore.match("deep/nested/dir/.env.staging")).toBe(true)
})

test("do not exclude non-dotenv files", () => {
  expect(FileIgnore.match(".envrc")).toBe(false)
  expect(FileIgnore.match("dir/.envrc")).toBe(false)
  expect(FileIgnore.match("env.ts")).toBe(false)
  expect(FileIgnore.match("src/env/config.ts")).toBe(false)
  expect(FileIgnore.match("environment.yaml")).toBe(false)
  expect(FileIgnore.match(".environment")).toBe(false)
  expect(FileIgnore.match("docker.env")).toBe(false)
  expect(FileIgnore.match("config.env")).toBe(false)
  expect(FileIgnore.match("src/utils/env.js")).toBe(false)
  expect(FileIgnore.match("env")).toBe(false)
  expect(FileIgnore.match(".env-example")).toBe(false)
  expect(FileIgnore.match("test.env.bak")).toBe(false)
})
