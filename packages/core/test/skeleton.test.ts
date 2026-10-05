import { describe, expect, it } from "bun:test"
import { Effect } from "effect"
import { Skeleton } from "../src/skeleton"

describe("Skeleton.Service in Core", () => {
  it("supports common TypeScript and JavaScript extensions", () => {
    Effect.runSync(
      Effect.gen(function* () {
        const service = yield* Skeleton.Service
        expect(service.supports("foo.ts")).toBe(true)
        expect(service.supports("component.tsx")).toBe(true)
        expect(service.supports("script.js")).toBe(true)
        expect(service.supports("types.d.ts")).toBe(true)
        expect(service.supports("main.py")).toBe(true)
        expect(service.supports("stubs.pyi")).toBe(true)
        expect(service.supports("readme.md")).toBe(false)
        expect(service.supports("data.json")).toBe(false)
      }).pipe(Effect.provide(Skeleton.layer)),
    )
  })

  it("prunes function and class method bodies while keeping signatures and interfaces", () => {
    const code = `import { Effect } from "effect"

export interface User {
  id: string
  name: string
}

export type Status = "active" | "inactive"

export class UserService {
  private count = 0

  constructor(private db: any) {
    this.count = 1
    console.log("initialized")
  }

  async findUser(id: string): Promise<User | null> {
    const query = "SELECT * FROM users WHERE id = " + id
    return await this.db.query(query)
  }
}

export function helper(x: number, y: number): number {
  const sum = x + y
  return sum * 2
}
`

    Effect.runSync(
      Effect.gen(function* () {
        const service = yield* Skeleton.Service
        const result = yield* service.prune("user-service.ts", code)

        expect(result.pruned).toBe(true)
        expect(result.content).toContain("export interface User")
        expect(result.content).toContain("export type Status")
        expect(result.content).toContain("export class UserService")
        expect(result.content).toContain("async findUser(id: string): Promise<User | null> { /* body omitted */ }")
        expect(result.content).toContain("export function helper(x: number, y: number): number { /* body omitted */ }")
        expect(result.content).not.toContain("SELECT * FROM users")
        expect(result.content).not.toContain("const sum = x + y")
        expect(result.skeletonLines).toBeLessThan(result.originalLines)
      }).pipe(Effect.provide(Skeleton.layer)),
    )
  })

  it("handles arrow functions assigned to const variables", () => {
    const code = `export const calculate = (a: number, b: number): number => {
  const diff = Math.abs(a - b)
  return diff * 10
}
`

    Effect.runSync(
      Effect.gen(function* () {
        const service = yield* Skeleton.Service
        const result = yield* service.prune("calc.ts", code)

        expect(result.pruned).toBe(true)
        expect(result.content).toContain("export const calculate = (a: number, b: number): number => { /* body omitted */ }")
        expect(result.content).not.toContain("Math.abs")
      }).pipe(Effect.provide(Skeleton.layer)),
    )
  })

  it("returns pruned: false when there are no function/method bodies to omit", () => {
    const code = `export interface Config {
  host: string
  port: number
}

export type ID = string
`

    Effect.runSync(
      Effect.gen(function* () {
        const service = yield* Skeleton.Service
        const result = yield* service.prune("config.ts", code)

        expect(result.pruned).toBe(false)
        expect(result.content).toBe(code)
      }).pipe(Effect.provide(Skeleton.layer)),
    )
  })

  it("prunes Python function and method bodies while preserving classes, signatures and docstrings", () => {
    const pythonCode = `import os
from typing import List, Optional

class UserRepository:
    """Repository for user data."""
    table_name: str = "users"

    def __init__(self, db_url: str):
        self.db_url = db_url
        self.connected = True
        print("Connected to DB")

    async def get_by_id(self, user_id: str) -> Optional[dict]:
        """Fetch a user by their unique ID."""
        raw = await fetch_from_db(user_id)
        if not raw:
            return None
        return transform(raw)

def calculate_metric(values: List[float]) -> float:
    total = sum(values)
    avg = total / len(values)
    return avg * 100.0
`

    Effect.runSync(
      Effect.gen(function* () {
        const service = yield* Skeleton.Service
        const result = yield* service.prune("repo.py", pythonCode)

        expect(result.pruned).toBe(true)
        expect(result.content).toContain("class UserRepository:")
        expect(result.content).toContain('"""Repository for user data."""')
        expect(result.content).toContain('table_name: str = "users"')
        expect(result.content).toContain("def __init__(self, db_url: str):")
        expect(result.content).toContain("async def get_by_id(self, user_id: str) -> Optional[dict]:")
        expect(result.content).toContain('"""Fetch a user by their unique ID."""')
        expect(result.content).toContain("def calculate_metric(values: List[float]) -> float:")
        expect(result.content).not.toContain("self.connected = True")
        expect(result.content).not.toContain("raw = await fetch_from_db")
        expect(result.content).not.toContain("avg = total / len(values)")
        expect(result.skeletonLines).toBeLessThan(result.originalLines)
      }).pipe(Effect.provide(Skeleton.layer)),
    )
  })
})
