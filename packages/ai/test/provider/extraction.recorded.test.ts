import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { Extraction } from "../../src/experimental.js"
import { CloudflareWorkersAI } from "../../src/providers.js"
import { recordedTests } from "../recorded-test.js"

const cloudflareWorkersAI = recordedTests({
  prefix: "cloudflare-workers-ai-extraction",
  provider: "cloudflare-workers-ai",
  protocol: "cloudflare-run-extraction",
  requires: ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_KEY"],
  metadata: { model: "@cf/cloudflare/clairic" },
  options: {
    redact: { url: (url: string) => url.replace(/\/client\/v4\/accounts\/[^/]+\//, "/client/v4/accounts/{account}/") },
  },
})

describe("Extraction recorded", () => {
  cloudflareWorkersAI.effect("extracts invoice fields", () =>
    Effect.gen(function* () {
      const response = yield* Extraction.generate({
        model: CloudflareWorkersAI.configure({
          accountId: process.env.CLOUDFLARE_ACCOUNT_ID ?? "fixture-account",
          apiKey: process.env.CLOUDFLARE_API_KEY ?? "fixture",
        }).experimental.extraction("@cf/cloudflare/clairic"),
        input:
          "Invoice INV-2291 from Northwind Supply, issued 2026-09-02, net 30. 4 pallets at $250.00 each, shipping $80.00. Contact: Dana Ruiz, Priya Shah.",
        fields: {
          invoiceNumber: { type: "text" },
          dueDate: { type: "date", instructions: "Issue date plus the net payment days" },
          total: { type: "number", decimals: 2, unit: "USD", instructions: "Amount due including shipping" },
          contacts: { type: "list", items: "text" },
          poNumber: { type: "text", instructions: "Purchase order number" },
        },
      })
      expect(response.answers.invoiceNumber.value).toBe("INV-2291")
      expect(response.answers.invoiceNumber.span).toEqual([8, 16])
      expect(response.answers.dueDate.value).toBe("2026-10-02")
      expect(response.answers.total.value).toBe(1080)
      expect(response.answers.contacts.value).toEqual(["Dana Ruiz", "Priya Shah"])
      expect(response.answers.poNumber.value).toBeNull()
      expect(response.answers.poNumber.nullProbability).toBeGreaterThan(0.5)
      expect(response.usage?.inputTokens).toBeGreaterThan(0)
    }),
  )
})
