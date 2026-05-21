import { afterEach, describe, expect, mock, test } from "bun:test"
import { Database } from "../src/drizzle"

void mock.module("../src/billing", () => ({
  Billing: {
    subtractLiteUsage: async () => {},
  },
}))

void mock.module("../src/lite", () => ({
  LiteData: {},
}))

const { Referral } = await import("../src/referral")

const originalTransaction = Database.transaction

afterEach(() => {
  Database.transaction = originalTransaction
})

describe("Referral.completeFromLiteSubscription", () => {
  test("returns without error when invitee has no referral", async () => {
    const selectedRows = [{ accountID: "account_1" }, undefined]
    let insertCalls = 0

    Database.transaction = async (callback) =>
      callback({
        select: () => ({
          from: () => ({
            where: () => ({
              then: (resolve: (rows: unknown[]) => unknown) => {
                const row = selectedRows.shift()
                return Promise.resolve(resolve(row ? [row] : []))
              },
            }),
          }),
        }),
        insert: () => ({
          ignore: () => ({
            values: () => {
              insertCalls += 1
              return Promise.resolve({ rowsAffected: 2 })
            },
          }),
        }),
      } as never)

    await expect(
      Referral.completeFromLiteSubscription({
        workspaceID: "workspace_1",
        userID: "user_1",
      }),
    ).resolves.toBeUndefined()
    expect(insertCalls).toBe(0)
  })
})
