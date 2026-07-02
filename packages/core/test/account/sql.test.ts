import { describe, expect, test } from "bun:test"
import { getTableConfig, type SQLiteTable } from "drizzle-orm/sqlite-core"

import {
  TokenBalanceTable,
  TokenTransactionTable,
  UserIdentityTable,
} from "../../src/account/sql"

function columnNames(table: SQLiteTable) {
  return getTableConfig(table).columns.map((c) => c.name)
}

function tableName(table: SQLiteTable) {
  return getTableConfig(table).name
}

describe("token-management account schema", () => {
  describe("UserIdentityTable", () => {
    test("is named user_identity", () => {
      expect(tableName(UserIdentityTable)).toBe("user_identity")
    })

    test("exposes the expected columns", () => {
      expect(columnNames(UserIdentityTable).sort()).toEqual(
        ["createdAt", "displayName", "email", "id", "isAdmin", "lastLoginAt", "tenantId"].sort(),
      )
    })

    test("email is required, identity fields are nullable", () => {
      const cols = getTableConfig(UserIdentityTable).columns
      const colByName = (name: string) => cols.find((c) => c.name === name)!
      expect(colByName("email").notNull).toBe(true)
      expect(colByName("displayName").notNull).toBe(false)
      expect(colByName("tenantId").notNull).toBe(false)
    })
  })

  describe("TokenBalanceTable", () => {
    test("is named token_balance", () => {
      expect(tableName(TokenBalanceTable)).toBe("token_balance")
    })

    test("exposes the expected columns", () => {
      expect(columnNames(TokenBalanceTable).sort()).toEqual(["balance", "lifetimeUsed", "updatedAt", "userId"].sort())
    })

    test("userId is the primary key and references user_identity", () => {
      const cols = getTableConfig(TokenBalanceTable).columns
      const userId = cols.find((c) => c.name === "userId")!
      expect(userId.primary).toBe(true)
      const fks = getTableConfig(TokenBalanceTable).foreignKeys
      expect(fks).toHaveLength(1)
      expect(fks[0].reference().foreignTable).toBe(UserIdentityTable)
    })
  })

  describe("TokenTransactionTable", () => {
    test("is named token_transaction", () => {
      expect(tableName(TokenTransactionTable)).toBe("token_transaction")
    })

    test("exposes the expected columns", () => {
      const columns = columnNames(TokenTransactionTable)
      expect(columns).toContain("id")
      expect(columns).toContain("userId")
      expect(columns).toContain("amount")
      expect(columns).toContain("description")
      expect(columns).toContain("sessionId")
      expect(columns).toContain("model")
      expect(columns).toContain("tokensUsed")
      expect(columns).toContain("costUsd")
      expect(columns).toContain("createdAt")
    })

    test("userId has FK to user_identity", () => {
      const fks = getTableConfig(TokenTransactionTable).foreignKeys
      expect(fks).toHaveLength(1)
      expect(fks[0].reference().foreignTable).toBe(UserIdentityTable)
    })
  })
})
