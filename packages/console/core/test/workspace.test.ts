import { beforeEach, describe, expect, mock, test } from "bun:test"
import { and, eq, getTableName, isNull, sql } from "drizzle-orm"
import type { SQLWrapper, Table } from "drizzle-orm"
import { MySqlDialect } from "drizzle-orm/mysql-core"

type Row = Record<string, unknown>

class Query {
  constructor(private rows: Row[]) {}
  innerJoin() {
    return this
  }
  where() {
    return this
  }
  for() {
    return this
  }
  then(resolve: (rows: Row[]) => unknown) {
    return Promise.resolve(this.rows).then(resolve)
  }
}

class Update {
  private values: Row = {}

  constructor(
    private database: TestDatabase,
    private table: Table,
  ) {}

  set(values: Row) {
    this.values = values
    return this
  }

  where(condition: SQLWrapper) {
    const table = getTableName(this.table)
    const query = new MySqlDialect().sqlToQuery(condition.getSQL())
    const workspaceID = query.params.find((param) => typeof param === "string" && param.startsWith("wrk_"))
    const rows = table === "workspace" ? this.database.workspaces : this.database.rows[table]
    rows?.forEach((row) => {
      const matches = table === "workspace" ? row.id === workspaceID : row.workspaceID === workspaceID
      if (matches && !row.timeDeleted) Object.assign(row, this.values)
    })
    if (table === "user") Object.assign(this.database.requester[0], { membershipDeleted: this.values.timeDeleted })
    this.database.updated.push(table)
    return Promise.resolve()
  }
}

class Delete {
  constructor(
    private database: TestDatabase,
    private table: Table,
  ) {}

  where(condition: SQLWrapper) {
    const table = getTableName(this.table)
    const query = new MySqlDialect().sqlToQuery(condition.getSQL())
    const workspaceID = query.params.find((param) => typeof param === "string" && param.startsWith("wrk_"))
    this.database.rows[table] = this.database.rows[table]?.filter((row) => row.workspaceID !== workspaceID) ?? []
    this.database.updated.push(`delete:${table}`)
    return Promise.resolve()
  }
}

class TestDatabase {
  workspaces: Row[] = [
    { id: target, timeDeleted: null },
    { id: other, timeDeleted: null },
  ]
  rows: Record<string, Row[]> = {
    user: [
      { id: "usr_target", workspaceID: target, timeDeleted: null },
      { id: "usr_other", workspaceID: other, timeDeleted: null },
    ],
    key: [
      { id: "key_target", workspaceID: target, timeDeleted: null },
      { id: "key_other", workspaceID: other, timeDeleted: null },
    ],
    provider: [
      { id: "provider_target", workspaceID: target, timeDeleted: null },
      { id: "provider_other", workspaceID: other, timeDeleted: null },
    ],
    model: [
      { id: "model_target", workspaceID: target, timeDeleted: null },
      { id: "model_other", workspaceID: other, timeDeleted: null },
    ],
  }
  billing: Row = {
    timeDeleted: null,
    balance: 0,
    reload: false,
    subscription: null,
    subscriptionID: null,
    subscriptionPlan: null,
    timeSubscriptionBooked: null,
    timeSubscriptionSelected: null,
    liteSubscriptionID: null,
    lite: null,
  }
  requester: Row[] = [{ accountID: "acc_target", role: "admin", invitationEmail: null, membershipDeleted: null }]
  black: Row[] = []
  go: Row[] = []
  updated: string[] = []

  select() {
    return {
      from: (table: Table) => {
        const name = getTableName(table)
        if (name === "workspace") return new Query(this.workspaces.filter((row) => row.id === target))
        if (name === "auth") return new Query(this.requester)
        if (name === "billing") return new Query([this.billing])
        if (name === "subscription") return new Query(this.black)
        if (name === "lite") return new Query(this.go)
        throw new Error(`Unexpected select from ${name}`)
      },
    }
  }

  update(table: Table) {
    return new Update(this, table)
  }

  delete(table: Table) {
    return new Delete(this, table)
  }
}

const target = "wrk_target"
const other = "wrk_other"
let database = new TestDatabase()

mock.module("../src/drizzle", () => ({
  and,
  Database: {
    transaction: (callback: (tx: TestDatabase) => Promise<unknown>) => callback(database),
  },
  eq,
  isNull,
  sql,
}))

const { Workspace } = await import("../src/workspace")

beforeEach(() => {
  database = new TestDatabase()
})

describe("Workspace.removeExact", () => {
  test("deletes only the exact workspace and revokes its memberships and keys", async () => {
    await Workspace.removeExact({ workspaceID: target, expectedRequesterEmail: "owner@example.com" })

    expect(database.workspaces.find((row) => row.id === target)?.timeDeleted).toBeInstanceOf(Date)
    expect(database.rows.user.find((row) => row.workspaceID === target)?.timeDeleted).toBeInstanceOf(Date)
    expect(database.rows.key.find((row) => row.workspaceID === target)?.timeDeleted).toBeInstanceOf(Date)
    expect(database.workspaces.find((row) => row.id === other)?.timeDeleted).toBeNull()
    expect(database.rows.user.find((row) => row.workspaceID === other)?.timeDeleted).toBeNull()
    expect(database.rows.key.find((row) => row.workspaceID === other)?.timeDeleted).toBeNull()
    expect(database.rows.provider.some((row) => row.workspaceID === target)).toBe(false)
    expect(database.rows.model.some((row) => row.workspaceID === target)).toBe(false)
    expect(database.rows.provider.some((row) => row.workspaceID === other)).toBe(true)
    expect(database.rows.model.some((row) => row.workspaceID === other)).toBe(true)
    expect(database.updated).toEqual(["workspace", "user", "key", "delete:provider", "delete:model"])
  })

  test("allows an exact retry only when the deleted admin membership still proves ownership", async () => {
    await Workspace.removeExact({ workspaceID: target, expectedRequesterEmail: "owner@example.com" })
    database.updated = []

    await Workspace.removeExact({ workspaceID: target, expectedRequesterEmail: "owner@example.com" })

    expect(database.updated).toEqual([])
  })

  test.each([
    ["non-admin requester", () => (database.requester[0].role = "member")],
    ["invitation-only requester", () => (database.requester = [])],
    ["inconsistent accepted invitation", () => (database.requester[0].invitationEmail = "owner@example.com")],
    ["positive Zen balance", () => (database.billing.balance = 1)],
    ["Zen reload", () => (database.billing.reload = true)],
    ["Black billing", () => (database.billing.subscriptionID = "sub_active")],
    ["Go billing", () => (database.billing.liteSubscriptionID = "sub_active")],
    ["Black entitlement", () => (database.black = [{ id: "sub_black" }])],
    ["Go entitlement", () => (database.go = [{ id: "sub_go" }])],
  ])("rejects %s without deleting data", async (_name, arrange) => {
    arrange()

    expect(
      Workspace.removeExact({ workspaceID: target, expectedRequesterEmail: "owner@example.com" }),
    ).rejects.toBeTruthy()
    expect(database.updated).toEqual([])
  })
})
