import { Auth } from "../auth"
import { Database } from "@opencode-ai/core/database/database"
import { UserIdentityTable, TokenBalanceTable, TokenTransactionTable } from "@opencode-ai/core/account/sql"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { eq, sql } from "drizzle-orm"
import { Context, Effect, Layer, Schema } from "effect"

// Gating: when OPENCODE_TOKEN_MGMT is unset, the Identity layer is a no-op.
const isEnabled = (): boolean => process.env["OPENCODE_TOKEN_MGMT"] !== undefined

export class Unauthorized extends Schema.TaggedErrorClass<Unauthorized>()("IdentityUnauthorized", {
  message: Schema.String,
}) {}

// --- Types ---

export interface UserIdentity {
  id: string
  email: string
  displayName: string | null
  tenantId: string | null
  createdAt: number
  lastLoginAt: number
  isAdmin: boolean
}

export interface UserWithBalance extends UserIdentity {
  balance: number
  lifetimeUsed: number
}

export interface AdminStats {
  totalUsers: number
  totalBalance: number
  totalUsedThisMonth: number
}

export interface UsageStatsEntry {
  date: string
  userId: string
  email: string
  tokensUsed: number
  costUsd: number
  requestCount: number
}

// --- Interface ---

export interface Interface {
  readonly upsertFromAuth: (input: {
    id: string
    email: string
    displayName?: string
    tenantId?: string
    roles?: readonly string[]
    groups?: readonly string[]
    extensionAttrs?: Record<string, string>
  }) => Effect.Effect<void>
  readonly getByID: (id: string) => Effect.Effect<UserIdentity | null>
  readonly getCurrent: () => Effect.Effect<UserIdentity | null>
  readonly requireAdmin: () => Effect.Effect<void, Unauthorized>
  readonly listUsersWithBalances: () => Effect.Effect<UserWithBalance[]>
  readonly credit: (input: {
    userId: string
    amount: number
    description: string
  }) => Effect.Effect<{ newBalance: number; transactionId: number }>
  readonly stats: () => Effect.Effect<AdminStats>
  readonly usageStats: (input: {
    from: string
    to: string
  }) => Effect.Effect<UsageStatsEntry[]>
}

// --- Service ---

export class Service extends Context.Service<Service, Interface>()("@opencode/Identity") {}

// --- helpers ---

export function getCurrentUTCMonth(): string {
  return new Date().toISOString().slice(0, 7)
}

export function monthAllowanceDue(currentMonth: string, lastMonth: string): boolean {
  return lastMonth < currentMonth
}

function mapRow(row: typeof UserIdentityTable.$inferSelect): UserIdentity {
  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName ?? null,
    tenantId: row.tenantId ?? null,
    createdAt: row.createdAt,
    lastLoginAt: row.lastLoginAt,
    isAdmin: row.isAdmin === 1,
  }
}

// --- Layer ---

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const auth = yield* Auth.Service

    const upsertFromAuth = Effect.fn("Identity.upsertFromAuth")(function* (input: {
      id: string
      email: string
      displayName?: string
      tenantId?: string
      roles?: readonly string[]
      groups?: readonly string[]
      extensionAttrs?: Record<string, string>
    }) {
      if (!isEnabled()) return

      yield* db
        .transaction(
          (tx) =>
            Effect.gen(function* () {
              // Admin detection: explicit opencode-admins role wins, else first user.
              const hasAdminRole = input.roles?.includes("opencode-admins") ?? false
              const existing = yield* tx.select({ id: UserIdentityTable.id }).from(UserIdentityTable).limit(1).all()
              const isEmpty = existing.length === 0
              const isAdmin = hasAdminRole || isEmpty

              yield* tx
                .insert(UserIdentityTable)
                .values({
                  id: input.id,
                  email: input.email,
                  displayName: input.displayName ?? null,
                  tenantId: input.tenantId ?? null,
                  isAdmin: isAdmin ? 1 : 0,
                  createdAt: Date.now(),
                  lastLoginAt: Date.now(),
                })
                .onConflictDoUpdate({
                  target: UserIdentityTable.id,
                  set: {
                    email: input.email,
                    displayName: input.displayName ?? null,
                    tenantId: input.tenantId ?? null,
                    isAdmin: isAdmin ? 1 : 0,
                    lastLoginAt: Date.now(),
                  },
                })
                .run()

              // Ensure a token_balance row exists (insert-or-ignore).
              yield* tx
                .insert(TokenBalanceTable)
                .values({
                  userId: input.id,
                  balance: 0,
                  lifetimeUsed: 0,
                  updatedAt: Date.now(),
                })
                .onConflictDoNothing()
                .run()

              // --- Auto-recharge: monthly allowance ---
              // Priority: extensionAttrs.monthlyTokenAllowance → env var → default 50000
              const allowance =
                Number(input.extensionAttrs?.monthlyTokenAllowance) ||
                Number(process.env["OPENCODE_MONTHLY_ALLOWANCE"]) ||
                50000
              const currentMonth = getCurrentUTCMonth()
              const balanceRow = yield* tx
                .select({ lastAllowanceMonth: TokenBalanceTable.lastAllowanceMonth })
                .from(TokenBalanceTable)
                .where(eq(TokenBalanceTable.userId, input.id))
                .get()

              if (balanceRow && monthAllowanceDue(currentMonth, balanceRow.lastAllowanceMonth ?? "")) {
                yield* tx
                  .update(TokenBalanceTable)
                  .set({
                    balance: sql`${TokenBalanceTable.balance} + ${allowance}`,
                    lastAllowanceMonth: currentMonth,
                    updatedAt: Date.now(),
                  })
                  .where(eq(TokenBalanceTable.userId, input.id))
                  .run()

                yield* tx
                  .insert(TokenTransactionTable)
                  .values({
                    userId: input.id,
                    amount: allowance,
                    description: `Monthly allowance ${currentMonth}`,
                    createdAt: Date.now(),
                  })
                  .run()
              }
              // --- end auto-recharge ---
            }),
          { behavior: "immediate" },
        )
        .pipe(
          Effect.catch((cause) =>
            Effect.sync(() => console.warn("Identity.upsertFromAuth failed", cause)),
          ),
        )
    })

    const getByID = Effect.fn("Identity.getByID")(function* (id: string) {
      if (!isEnabled()) return null

      const row = yield* db
        .select()
        .from(UserIdentityTable)
        .where(eq(UserIdentityTable.id, id))
        .get()
        .pipe(Effect.catch(() => Effect.succeed(undefined)))

      return row ? mapRow(row) : null
    })

    const getCurrent = Effect.fn("Identity.getCurrent")(function* () {
      if (!isEnabled()) return null

      const microsoftAuth = yield* auth
        .get("microsoft")
        .pipe(Effect.catch(() => Effect.succeed(undefined)))

      if (microsoftAuth?.type !== "oauth" || !microsoftAuth.accountId) return null

      return yield* getByID(microsoftAuth.accountId)
    })

    const requireAdmin = Effect.fn("Identity.requireAdmin")(function* () {
      if (!isEnabled()) {
        return yield* Effect.fail(new Unauthorized({ message: "Identity layer is disabled" }))
      }
      const user = yield* getCurrent()
      if (!user?.isAdmin) {
        return yield* Effect.fail(new Unauthorized({ message: "Admin access required" }))
      }
    })

    const listUsersWithBalances = Effect.fn("Identity.listUsersWithBalances")(function* () {
      if (!isEnabled()) return []

      const rows = yield* db
        .select({
          id: UserIdentityTable.id,
          email: UserIdentityTable.email,
          displayName: UserIdentityTable.displayName,
          tenantId: UserIdentityTable.tenantId,
          createdAt: UserIdentityTable.createdAt,
          lastLoginAt: UserIdentityTable.lastLoginAt,
          isAdmin: UserIdentityTable.isAdmin,
          balance: TokenBalanceTable.balance,
          lifetimeUsed: TokenBalanceTable.lifetimeUsed,
        })
        .from(UserIdentityTable)
        .leftJoin(TokenBalanceTable, eq(UserIdentityTable.id, TokenBalanceTable.userId))
        .all()
        .pipe(Effect.catch(() => Effect.succeed([])))

      return rows.map((row) => ({
        id: row.id,
        email: row.email,
        displayName: row.displayName ?? null,
        tenantId: row.tenantId ?? null,
        createdAt: row.createdAt,
        lastLoginAt: row.lastLoginAt,
        isAdmin: row.isAdmin === 1,
        balance: row.balance ?? 0,
        lifetimeUsed: row.lifetimeUsed ?? 0,
      }))
    })

    const credit = Effect.fn("Identity.credit")(function* (input: {
      userId: string
      amount: number
      description: string
    }) {
      if (!isEnabled()) return { newBalance: 0, transactionId: 0 }

      const createTransaction = Effect.fnUntraced(function* () {
        return yield* db.transaction(
          (tx) =>
            Effect.gen(function* () {
              // Upsert balance row to ensure it exists.
              yield* tx
                .insert(TokenBalanceTable)
                .values({
                  userId: input.userId,
                  balance: 0,
                  lifetimeUsed: 0,
                  updatedAt: Date.now(),
                })
                .onConflictDoNothing()
                .run()

              // Update balance atomically.
              yield* tx
                .update(TokenBalanceTable)
                .set({
                  balance: sql`${TokenBalanceTable.balance} + ${input.amount}`,
                  updatedAt: Date.now(),
                })
                .where(eq(TokenBalanceTable.userId, input.userId))
                .run()

              // Read back new balance.
              const updated = yield* tx
                .select({ balance: TokenBalanceTable.balance })
                .from(TokenBalanceTable)
                .where(eq(TokenBalanceTable.userId, input.userId))
                .get()

              // Record transaction.
              yield* tx
                .insert(TokenTransactionTable)
                .values({
                  userId: input.userId,
                  amount: input.amount,
                  description: input.description,
                  createdAt: Date.now(),
                })
                .run()

              // Read back the auto-increment id.
              const txRow = yield* tx
                .select({ id: TokenTransactionTable.id })
                .from(TokenTransactionTable)
                .where(eq(TokenTransactionTable.userId, input.userId))
                .orderBy(sql`${TokenTransactionTable.id} DESC`)
                .limit(1)
                .get()

              return {
                newBalance: updated?.balance ?? 0,
                transactionId: txRow?.id ?? 0,
              }
            }),
          { behavior: "immediate" },
        )
      })

      return yield* createTransaction().pipe(
        Effect.catch(() => Effect.succeed({ newBalance: 0, transactionId: 0 })),
      )
    })

    const stats = Effect.fn("Identity.stats")(function* () {
      if (!isEnabled()) return { totalUsers: 0, totalBalance: 0, totalUsedThisMonth: 0 }

      const now = new Date()
      const monthStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)

      const [userCount, balanceSum, monthUsage] = yield* Effect.all(
        [
          db.select({ count: sql<number>`COUNT(*)` }).from(UserIdentityTable).get(),
          db
            .select({ sum: sql<number>`COALESCE(SUM(${TokenBalanceTable.balance}), 0)` })
            .from(TokenBalanceTable)
            .get(),
          db
            .select({ sum: sql<number>`COALESCE(SUM(ABS(${TokenTransactionTable.amount})), 0)` })
            .from(TokenTransactionTable)
            .where(
              sql`${TokenTransactionTable.amount} < 0 AND ${TokenTransactionTable.createdAt} >= ${monthStart}`,
            )
            .get(),
        ],
        { concurrency: 3 },
      ).pipe(Effect.catch(() => Effect.succeed([null, null, null] as const)))

      return {
        totalUsers: userCount?.count ?? 0,
        totalBalance: balanceSum?.sum ?? 0,
        totalUsedThisMonth: monthUsage?.sum ?? 0,
      }
    })

    const usageStats = Effect.fn("Identity.usageStats")(function* (input: {
      from: string
      to: string
    }) {
      if (!isEnabled()) return []

      const fromMs = new Date(input.from + "T00:00:00Z").getTime()
      const toMs = new Date(input.to + "T23:59:59.999Z").getTime()

      if (isNaN(fromMs) || isNaN(toMs)) return []

      const rows = yield* db
        .select({
          date: sql<string>`date(${TokenTransactionTable.createdAt} / 1000, 'unixepoch')`,
          userId: TokenTransactionTable.userId,
          email: UserIdentityTable.email,
          tokensUsed: sql<number>`COALESCE(SUM(ABS(${TokenTransactionTable.tokensUsed})), 0)`,
          costUsd: sql<number>`COALESCE(SUM(ABS(${TokenTransactionTable.costUsd})), 0)`,
          requestCount: sql<number>`COUNT(*)`,
        })
        .from(TokenTransactionTable)
        .leftJoin(
          UserIdentityTable,
          eq(UserIdentityTable.id, TokenTransactionTable.userId),
        )
        .where(
          sql`${TokenTransactionTable.amount} < 0
            AND ${TokenTransactionTable.createdAt} >= ${fromMs}
            AND ${TokenTransactionTable.createdAt} <= ${toMs}`,
        )
        .groupBy(sql`date(${TokenTransactionTable.createdAt} / 1000, 'unixepoch')`, TokenTransactionTable.userId)
        .orderBy(sql`date(${TokenTransactionTable.createdAt} / 1000, 'unixepoch') DESC`, sql`tokensUsed DESC`)
        .all()
        .pipe(Effect.catch(() => Effect.succeed([])))

      return rows.map((row) => ({
        date: row.date,
        userId: row.userId,
        email: row.email ?? "",
        tokensUsed: row.tokensUsed,
        costUsd: row.costUsd,
        requestCount: row.requestCount,
      }))
    })

    return Service.of({
      upsertFromAuth,
      getByID,
      getCurrent,
      requireAdmin,
      listUsersWithBalances,
      credit,
      stats,
      usageStats,
    })
  }),
)

export const node = LayerNode.make(layer, [Auth.node, Database.node])

export const defaultLayer = layer.pipe(
  Layer.provide(Database.defaultLayer),
  Layer.provideMerge(Auth.defaultLayer),
)

export * as Identity from "."
