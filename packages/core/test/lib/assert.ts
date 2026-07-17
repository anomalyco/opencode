import { expect } from "bun:test"

/** Runtime expect + TypeScript narrow — keeps test bodies linear. */
export function assertDefined<T>(value: T | null | undefined): asserts value is T {
  expect(value).toBeDefined()
}

/** Narrow a `{ type }` discriminated union after asserting the tag. */
export function assertTag<const T extends string, A extends { type: string }>(
  value: A,
  type: T,
): asserts value is Extract<A, { type: T }> {
  expect(value.type).toBe(type)
}
