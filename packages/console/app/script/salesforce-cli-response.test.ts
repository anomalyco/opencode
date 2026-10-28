import { expect, test } from "bun:test"
import { SalesforceCliError, salesforceCliResponse } from "./salesforce-cli-response"

test("unwraps a successful Salesforce Lead creation from the CLI HTTP envelope", () => {
  expect(
    salesforceCliResponse(
      JSON.stringify({
        status: 0,
        result: { statusCode: 201, headers: {}, body: { id: "test-lead", success: true, errors: [] } },
      }),
    ),
  ).toEqual({ id: "test-lead", success: true, errors: [] })
})

test("rejects a Salesforce HTTP failure even if the CLI exits successfully", () => {
  expect(() =>
    salesforceCliResponse(
      JSON.stringify({
        status: 0,
        result: { statusCode: 400, body: [{ errorCode: "INVALID_OR_NULL_FOR_RESTRICTED_PICKLIST" }] },
      }),
    ),
  ).toThrow()
})

test("rejects CLI errors and responses missing the HTTP envelope", () => {
  expect(() => salesforceCliResponse(JSON.stringify({ status: 1, message: "CLI error" }))).toThrow()
  expect(() => salesforceCliResponse(JSON.stringify({ status: 0, result: { success: true } }))).toThrow()
})

test("preserves the Salesforce rejection code when the CLI exits nonzero", () => {
  expect(() =>
    salesforceCliResponse(
      JSON.stringify({
        status: 1,
        result: { statusCode: 400, body: [{ errorCode: "DUPLICATES_DETECTED", message: "Duplicate found" }] },
      }),
    ),
  ).toThrow(new SalesforceCliError("DUPLICATES_DETECTED"))
})
