import type { Value } from "./objects.js"

const deleted: unique symbol = Symbol("codemode.deleted")

/** A position in a table's entries, kept by the table so compaction can move it. */
export type TableCursor = { index: number; done: boolean }

/**
 * The storage behind Map and Set: entries in insertion order with tombstones, as V8's OrderedHashTable. An entry keeps
 * its index until the table compacts, and the table moves every live cursor when it does, so an iterator's position is
 * a plain integer. Iteration is live: entries added before a cursor reaches the end are visited, deleted ones skipped,
 * and after `clear()` a cursor continues with whatever is added next. Keys compare by SameValueZero.
 */
export class OrderedTable {
  readonly keys: Array<Value | typeof deleted> = []
  readonly values: Array<Value> = []
  // Derived from `keys`: where each live key is.
  private readonly index = new Map<Value, number>()
  private cursors: Array<TableCursor> = []
  private tombstones = 0
  private pruneAt = 16

  get size(): number {
    return this.index.size
  }

  has(key: Value): boolean {
    return this.index.has(key)
  }

  get(key: Value): Value {
    const at = this.index.get(key)
    return at === undefined ? undefined : this.values[at]
  }

  set(key: Value, value: Value): void {
    const at = this.index.get(key)
    if (at !== undefined) {
      this.values[at] = value
      return
    }
    // -0 is stored as +0, as Map and Set do.
    const stored = key === 0 ? 0 : key
    this.index.set(stored, this.keys.length)
    this.keys.push(stored)
    this.values.push(value)
  }

  add(key: Value): void {
    if (!this.index.has(key)) this.set(key, undefined)
  }

  delete(key: Value): boolean {
    const at = this.index.get(key)
    if (at === undefined) return false
    this.index.delete(key)
    this.keys[at] = deleted
    this.values[at] = undefined
    this.tombstones++
    if (this.tombstones >= 16 && this.tombstones * 2 >= this.keys.length) this.compact()
    return true
  }

  clear(): void {
    this.keys.fill(deleted)
    this.values.fill(undefined)
    this.index.clear()
    this.tombstones = this.keys.length
    this.compact()
  }

  /** A cursor at the first entry, moved along by `advance`. */
  cursor(): TableCursor {
    return this.track({ index: 0, done: false })
  }

  /** Starts keeping `cursor` in place across compaction. */
  track<C extends TableCursor>(cursor: C): C {
    if (this.cursors.length >= this.pruneAt) {
      this.cursors = this.cursors.filter((item) => !item.done)
      this.pruneAt = Math.max(16, this.cursors.length * 2)
    }
    this.cursors.push(cursor)
    return cursor
  }

  /** The index of the cursor's next live entry, moving past it; -1 once the cursor is done, which is for good. */
  advance(cursor: TableCursor): number {
    if (cursor.done) return -1
    for (let at = cursor.index; at < this.keys.length; at++) {
      if (this.keys[at] === deleted) continue
      cursor.index = at + 1
      return at
    }
    cursor.done = true
    return -1
  }

  /**
   * Live entries in order, through a tracked cursor, so host code may change the table (or run program code that does)
   * between steps. Stopping early releases the cursor.
   */
  *entries(): Generator<[Value, Value]> {
    const cursor = this.cursor()
    try {
      for (let at = this.advance(cursor); at >= 0; at = this.advance(cursor)) {
        yield [this.keys[at] as Value, this.values[at]]
      }
    } finally {
      cursor.done = true
    }
  }

  [Symbol.iterator](): Generator<[Value, Value]> {
    return this.entries()
  }

  *liveKeys(): Generator<Value> {
    for (const [key] of this.entries()) yield key
  }

  // Drops the tombstones; a cursor moves to the count of live entries before it, which is where it now points.
  private compact(): void {
    const before: Array<number> = []
    let live = 0
    for (let at = 0; at < this.keys.length; at++) {
      before.push(live)
      const key = this.keys[at]
      if (key === deleted) continue
      this.keys[live] = key
      this.values[live] = this.values[at]
      this.index.set(key, live)
      live++
    }
    before.push(live)
    this.keys.length = live
    this.values.length = live
    this.tombstones = 0
    this.cursors = this.cursors.filter((cursor) => !cursor.done)
    for (const cursor of this.cursors) cursor.index = before[Math.min(cursor.index, before.length - 1)]!
  }
}
