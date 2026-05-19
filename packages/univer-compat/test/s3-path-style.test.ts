import { expect, test } from "bun:test"
import { presignSignerConfig } from "../src/exchange-files"

const bucket = "veritly-univer-exchange"

test("virtual-hosted DO presign env strips bucket host; SDK emits bucket.region URL", () => {
  const cfg = presignSignerConfig("https://veritly-univer-exchange.ams3.digitaloceanspaces.com", bucket)
  expect(cfg.endpoint).toBe("https://ams3.digitaloceanspaces.com")
  expect(cfg.pathStyle).toBe(false)
})

test("regional DO endpoint uses virtual-hosted presign URLs", () => {
  const cfg = presignSignerConfig("https://ams3.digitaloceanspaces.com", bucket)
  expect(cfg.endpoint).toBe("https://ams3.digitaloceanspaces.com")
  expect(cfg.pathStyle).toBe(false)
})

test("MinIO published host stays path-style", () => {
  const cfg = presignSignerConfig("http://127.0.0.1:9000", "veritly-exchange")
  expect(cfg.pathStyle).toBe(true)
})
