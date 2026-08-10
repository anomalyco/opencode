import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Global } from "@opencode-ai/core/global"
import {
  appendReceipt,
  createId,
  isAdverse,
  readReceipts,
  resolveReceiptDir,
  receiptFile,
  scrubMeta,
  type Receipt,
} from "../../src/decision/receipt"
import { tmpdir } from "../fixture/fixture"

describe("decision/receipt", () => {
  test("resolveReceiptDir uses Global.Path.data/receipts when no .moks", async () => {
    await using tmp = await tmpdir()
    expect(resolveReceiptDir(tmp.path)).toBe(path.join(Global.Path.data, "receipts"))
  })

  test("resolveReceiptDir uses cwd/.moks/receipts when .moks dir exists", async () => {
    await using tmp = await tmpdir()
    await fs.mkdir(path.join(tmp.path, ".moks"))
    expect(resolveReceiptDir(tmp.path)).toBe(path.join(tmp.path, ".moks", "receipts"))
  })

  test("receiptFile points at decisions.jsonl", () => {
    expect(receiptFile("/tmp/receipts")).toBe(path.join("/tmp/receipts", "decisions.jsonl"))
  })

  test("isAdverse matches reject/offer/hire case-insensitively", () => {
    expect(isAdverse("reject")).toBe(true)
    expect(isAdverse("OFFER")).toBe(true)
    expect(isAdverse("Hire")).toBe(true)
    expect(isAdverse("note")).toBe(false)
  })

  test("scrubMeta strips secret keys and nested secrets", () => {
    const scrubbed = scrubMeta({
      note: "ok",
      api_key: "secret",
      Authorization: "Bearer x",
      nested: { password: "p", keep: 1 },
      token: "t",
    })
    expect(scrubbed).toEqual({
      note: "ok",
      nested: { keep: 1 },
    })
  })

  test("scrubMeta returns undefined for empty or non-object", () => {
    expect(scrubMeta(undefined)).toBeUndefined()
    expect(scrubMeta("x")).toBeUndefined()
    expect(scrubMeta({ apiKey: "x" })).toBeUndefined()
  })

  test("append + read roundtrip JSONL", async () => {
    await using tmp = await tmpdir()
    await fs.mkdir(path.join(tmp.path, ".moks"))
    const receipt: Receipt = {
      id: createId(),
      ts: new Date().toISOString(),
      verb: "propose",
      action: "note",
      dry_run: true,
      state: "proposed",
      adverse: false,
    }
    await appendReceipt(receipt, tmp.path)
    await appendReceipt({ ...receipt, id: createId(), action: "reject", adverse: true }, tmp.path)
    const rows = await readReceipts(tmp.path)
    expect(rows).toHaveLength(2)
    expect(rows[0].action).toBe("note")
    expect(rows[1].action).toBe("reject")
    const text = await Bun.file(receiptFile(resolveReceiptDir(tmp.path))).text()
    expect(text.trim().split("\n")).toHaveLength(2)
  })

  test("readReceipts skips bad lines", async () => {
    await using tmp = await tmpdir()
    await fs.mkdir(path.join(tmp.path, ".moks", "receipts"), { recursive: true })
    const file = receiptFile(resolveReceiptDir(tmp.path))
    await fs.writeFile(
      file,
      [
        JSON.stringify({
          id: "dec_a",
          ts: "t",
          verb: "propose",
          action: "note",
          dry_run: true,
          state: "proposed",
          adverse: false,
        }),
        "not-json",
        JSON.stringify({
          id: "dec_b",
          ts: "t",
          verb: "propose",
          action: "note",
          dry_run: true,
          state: "proposed",
          adverse: false,
        }),
      ].join("\n") + "\n",
    )
    const rows = await readReceipts(tmp.path)
    expect(rows.map((r) => r.id)).toEqual(["dec_a", "dec_b"])
  })
})
