import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { Extraction } from "../src/experimental.js"
import { CloudflareWorkersAI } from "../src/providers.js"
import { it } from "./lib/effect.js"
import { dynamicResponse, json } from "./lib/http.js"

const model = CloudflareWorkersAI.configure({
  accountId: "test-account",
  apiKey: "cloudflare-key",
}).experimental.extraction("@cf/cloudflare/clairic")

describe("Extraction", () => {
  it.effect("sends Clairic fields and decodes typed answers", () =>
    Extraction.generate({
      model,
      input: "Invoice INV-7 issued March 2, net 30, total $1,080.00. Contacts: Dana, Priya.",
      fields: {
        invoice: { type: "text", nullThreshold: 0.8 },
        total: { type: "number", decimals: 2, unit: "USD" },
        due: { type: "date", instructions: "Issue date plus net days" },
        contacts: { type: "list", items: "text" },
        payDays: { type: "estimate", min: 0, max: 120, step: 1 },
        sales: { type: "forecast", min: 0, max: 500, horizon: 2, interval: "month" },
      },
      referenceDate: "2026-01-01",
      providerOptions: { options: { include_quantiles: true } },
    }).pipe(
      Effect.tap((response) =>
        Effect.sync(() => {
          expect(response.answers).toEqual({
            invoice: {
              value: "INV-7",
              guess: "INV-7",
              nullProbability: 0.01,
              confidence: 0.99,
              span: [8, 13],
            },
            total: { value: null, guess: 1080, nullProbability: 0.6, confidence: 0.9 },
            due: { value: "2026-04-01", nullProbability: 0, confidence: 1 },
            contacts: {
              value: ["Dana", "Priya"],
              spans: [
                [67, 71],
                [73, 78],
              ],
              confidence: 0.98,
            },
            payDays: {
              value: 30,
              mean: 29.5,
              median: 30,
              p10: 21,
              p90: 38,
              belowProbability: 0.001,
              aboveProbability: 0.002,
              quantiles: [20, 30, 40],
            },
            sales: {
              value: [140, 148],
              steps: [
                { value: 140, mean: 140, median: 141, p10: 130, p90: 151 },
                { value: 148, mean: 148, median: 148, p10: 131, p90: 165 },
              ],
            },
          })
          expect(response.usage?.inputTokens).toBe(655)
          expect(response.usage?.providerMetadata?.["cloudflare-workers-ai"]).toMatchObject({ passes: 3 })
          expect(response.providerMetadata).toEqual({ "cloudflare-workers-ai": { model: "clairic", truncated: false } })
        }),
      ),
      Effect.provide(
        dynamicResponse((input) => {
          expect(input.request.url).toBe(
            "https://api.cloudflare.com/client/v4/accounts/test-account/ai/run/@cf/cloudflare/clairic",
          )
          expect(input.request.headers.authorization).toBe("Bearer cloudflare-key")
          expect(JSON.parse(input.text)).toEqual({
            options: { include_quantiles: true },
            model: "@cf/cloudflare/clairic",
            state: "Invoice INV-7 issued March 2, net 30, total $1,080.00. Contacts: Dana, Priya.",
            fields: {
              invoice: { type: "text", null_threshold: 0.8 },
              total: { type: "number", decimals: 2, unit: "USD" },
              due: { type: "date", instructions: "Issue date plus net days" },
              contacts: { type: "list", items: "text" },
              payDays: { type: "estimate", min: 0, max: 120, step: 1 },
              sales: { type: "forecast", min: 0, max: 500, horizon: 2, interval: "month" },
            },
            reference_date: "2026-01-01",
          })
          return Effect.succeed(
            json(input, {
              result: {
                model: "clairic",
                answers: {
                  invoice: {
                    type: "text",
                    p_null: 0.01,
                    span: [8, 13],
                    guess: "INV-7",
                    confidence: 0.99,
                    value: "INV-7",
                  },
                  total: { type: "number", p_null: 0.6, guess: 1080, confidence: 0.9, value: null },
                  due: { type: "date", p_null: 0, confidence: 1, value: "2026-04-01" },
                  contacts: {
                    type: "list",
                    value: ["Dana", "Priya"],
                    spans: [
                      [67, 71],
                      [73, 78],
                    ],
                    confidence: 0.98,
                  },
                  payDays: {
                    type: "estimate",
                    value: 30,
                    mean: 29.5,
                    median: 30,
                    p10: 21,
                    p90: 38,
                    p_below: 0.001,
                    p_above: 0.002,
                    quantiles: [20, 30, 40],
                  },
                  sales: {
                    type: "forecast",
                    value: [140, 148],
                    median: [141, 148],
                    p10: [130, 131],
                    p90: [151, 165],
                    steps: [
                      { value: 140, mean: 140, median: 141, p10: 130, p90: 151 },
                      { value: 148, mean: 148, median: 148, p10: 131, p90: 165 },
                    ],
                  },
                },
                truncated: false,
                usage: {
                  state_tokens: 61,
                  image_tokens: 0,
                  schema_tokens: 472,
                  input_tokens: 655,
                  output_tokens: 0,
                  passes: 3,
                },
              },
              success: true,
              errors: [],
              messages: [],
            }),
          )
        }),
      ),
    ),
  )

  it.effect("passes unknown field types through and drops extra answers", () =>
    Extraction.generate({
      model,
      input: "Ship by May 20 in EUR.",
      fields: { ship: { type: "date" }, money: { type: "currency", codes: ["EUR"] } },
    }).pipe(
      Effect.tap((response) =>
        Effect.sync(() =>
          expect(response.answers).toEqual({
            ship: { value: "2026-05-20", confidence: 0.97 },
            money: { type: "currency", value: "EUR", p_null: 0 },
          }),
        ),
      ),
      Effect.provide(
        dynamicResponse((input) => {
          expect(JSON.parse(input.text).fields.money).toEqual({ type: "currency", codes: ["EUR"] })
          return Effect.succeed(
            json(input, {
              result: {
                model: "clairic",
                answers: {
                  ship: { type: "date", value: "2026-05-20", confidence: 0.97, calendar: "gregorian" },
                  money: { type: "currency", value: "EUR", p_null: 0 },
                  extra: { type: "hologram", value: { x: 1 } },
                },
                future_flag: true,
              },
            }),
          )
        }),
      ),
    ),
  )

  it.effect("fails when a requested field has no answer", () =>
    Extraction.generate({ model, input: "Nothing here.", fields: { total: { type: "number" } } }).pipe(
      Effect.flip,
      Effect.tap((error) => Effect.sync(() => expect(error.reason._tag).toBe("InvalidProviderOutput"))),
      Effect.provide(
        dynamicResponse((input) =>
          Effect.succeed(json(input, { result: { model: "clairic", answers: {}, usage: { input_tokens: 1 } } })),
        ),
      ),
    ),
  )

  it.effect("fails when an answer value does not match its field", () =>
    Extraction.generate({ model, input: "Total: lots.", fields: { total: { type: "number" } } }).pipe(
      Effect.flip,
      Effect.tap((error) => Effect.sync(() => expect(error.reason._tag).toBe("InvalidProviderOutput"))),
      Effect.provide(
        dynamicResponse((input) =>
          Effect.succeed(
            json(input, { result: { model: "clairic", answers: { total: { type: "number", value: "lots" } } } }),
          ),
        ),
      ),
    ),
  )

  it.effect("rejects an empty field map before the network", () =>
    Extraction.generate({ model, input: "x", fields: {} }).pipe(
      Effect.flip,
      Effect.tap((error) => Effect.sync(() => expect(error.reason._tag).toBe("InvalidRequest"))),
      Effect.provide(dynamicResponse(() => Effect.die("an invalid extraction request reached the network"))),
    ),
  )
})
