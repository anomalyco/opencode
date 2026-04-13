import { describe, it, expect } from "bun:test"
import { parseConfig } from "../src/config"

describe("parseConfig", () => {
  it("returns defaults when options is undefined", () => {
    const cfg = parseConfig(undefined, "/project")
    expect(cfg.max_depth).toBe(5)
    expect(cfg.max_retry).toBe(2)
    expect(cfg.sync_timeout_ms).toBe(60000)
    expect(cfg.broadcast_max_recipients).toBe(10)
    expect(cfg.broadcast_rate_limit_per_minute).toBe(5)
    expect(cfg.include_thinking).toBe(false)
    expect(cfg.message_ttl_ms).toBe(86400000)
    expect(cfg.db_path).toBe("/project/.opencode/agent-comms.db")
  })

  it("merges user options with defaults", () => {
    const cfg = parseConfig({ max_depth: 3, include_thinking: true }, "/project")
    expect(cfg.max_depth).toBe(3)
    expect(cfg.include_thinking).toBe(true)
    expect(cfg.max_retry).toBe(2)
  })

  it("validates max_depth is positive", () => {
    expect(() => parseConfig({ max_depth: 0 }, "/p")).toThrow("positive")
    expect(() => parseConfig({ max_depth: -1 }, "/p")).toThrow("positive")
  })

  it("validates max_retry is non-negative", () => {
    expect(() => parseConfig({ max_retry: -1 }, "/p")).toThrow("non-negative")
    expect(parseConfig({ max_retry: 0 }, "/p").max_retry).toBe(0)
  })

  it("validates sync_timeout_ms is positive", () => {
    expect(() => parseConfig({ sync_timeout_ms: 0 }, "/p")).toThrow("positive")
  })

  it("validates broadcast_max_recipients is positive", () => {
    expect(() => parseConfig({ broadcast_max_recipients: 0 }, "/p")).toThrow("positive")
  })

  it("validates broadcast_rate_limit_per_minute is positive", () => {
    expect(() => parseConfig({ broadcast_rate_limit_per_minute: 0 }, "/p")).toThrow("positive")
  })

  it("validates message_ttl_ms is positive", () => {
    expect(() => parseConfig({ message_ttl_ms: 0 }, "/p")).toThrow("positive")
  })

  it("resolves db_path relative to project directory", () => {
    expect(parseConfig({ db_path: "data/test.db" }, "/project").db_path).toBe("/project/data/test.db")
  })

  it("keeps absolute db_path", () => {
    expect(parseConfig({ db_path: "/tmp/test.db" }, "/project").db_path).toBe("/tmp/test.db")
  })

  it("passes :memory: through", () => {
    expect(parseConfig({ db_path: ":memory:" }, "/project").db_path).toBe(":memory:")
  })

  it("throws on invalid types", () => {
    expect(() => parseConfig({ max_depth: "abc" as any }, "/p")).toThrow("positive")
  })

  it("coerces include_thinking to boolean", () => {
    expect(parseConfig({ include_thinking: "yes" as any }, "/p").include_thinking).toBe(true)
    expect(parseConfig({ include_thinking: 0 as any }, "/p").include_thinking).toBe(false)
  })
})
