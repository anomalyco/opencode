# Phase 1: Terminal Engine

**Status**: ✅ Complete  
**Source**: `packages/opencode/src/terminal/` (13 files)  
**Tests**: `packages/opencode/test/terminal/` (61/61 passing, `--timeout 30000`)  
**Type Errors**: 0

---

## Philosophy

A zero-dependency terminal rendering engine using TypedArrays for screen state. Designed for 60 FPS rendering with minimal allocation. Cross-platform via `process.stdin.setRawMode(true)` + `process.stdout.columns/rows` — no Rust/native addons.

### Why TypedArrays?

- `Int32Array` for characters (supports emoji > 0xFFFF)
- `Uint8Array` for foreground/background colors and attributes
- Predictable memory layout: ~64 bytes per cell, 640KB for 10,000 cells
- No GC pressure during frame writes

---

## Architecture

```
src/terminal/
├── core/
│   ├── Cell.ts              # Cell data structure
│   ├── ScreenBuffer.ts      # Current + next screen state
│   └── DirtyDiff.ts         # Minimal ANSI diff generation
├── buffer/
│   └── DoubleBuffer.ts      # Double-buffering manager
├── input/
│   ├── RawMode.ts           # Raw terminal mode activation
│   ├── KeyCodes.ts          # Key code definitions
│   └── InputHandler.ts      # Input parsing state machine
├── utils/
│   ├── AnsiCodes.ts         # ANSI escape code helpers
│   ├── WidthUtils.ts        # Character width (ASCII vs CJK vs emoji)
│   └── TerminalFeatures.ts  # Terminal capability detection
├── window/
│   ├── WindowSize.ts        # Terminal size polling + SIGWINCH
│   └── TerminalManager.ts   # Top-level lifecycle manager
└── index.ts                 # Barrel export
```

---

## API Reference

### `core/Cell.ts`

Cell data structure backed by TypedArray slices.

```ts
export interface Cell {
  char: number           // Unicode code point (Int32Array)
  fg: number             // Foreground color 0-255 (0 = default)
  bg: number             // Background color 0-255 (0 = default)
  bold: boolean          // Attribute flags
  italic: boolean
  underline: boolean
  strikethrough: boolean
  inverse: boolean
  width: number          // Display width: 1 (ASCII), 2 (CJK/emoji)
}
```

Constants: `AttrMask.BOLD | ITALIC | UNDERLINE | STRIKE | INVERSE`

### `core/ScreenBuffer.ts`

Manages current and target screen state as parallel TypedArrays.

```ts
export class ScreenBuffer {
  readonly rows: number
  readonly cols: number
  constructor(rows: number, cols: number)
  clear(): void
  setCell(row: number, col: number, cell: Partial<Cell>): void
  getCell(row: number, col: number): Cell
  fill(row: number, col: number, width: number, cell: Partial<Cell>): void
  scrollUp(lines: number): void
  scrollDown(lines: number): void
}
```

### `core/DirtyDiff.ts`

Compares two ScreenBuffers and emits minimal ANSI sequences.

```ts
export class DirtyDiff {
  diff(current: ScreenBuffer, next: ScreenBuffer): string
}
```

Output uses: CUP (`\x1b[{row};{col}H`), SGR (`\x1b[0;{fg};{bg}m`), ECH (`\x1b[{n}X`), and character writes. Position is 1-indexed in output; input coordinates are 0-indexed.

### `buffer/DoubleBuffer.ts`

Manages front/back buffer swapping.

```ts
export class DoubleBuffer {
  readonly front: ScreenBuffer
  readonly back: ScreenBuffer
  readonly dirty: DirtyDiff
  constructor(rows: number, cols: number)
  flush(): string
}
```

### `input/RawMode.ts`

Cross-platform raw mode activation.

```ts
export class RawMode {
  static isRaw(): boolean
  static enter(): void
  static exit(): void
}
```

### `input/KeyCodes.ts`

Named key code constants. Standard ASCII + escape sequence mappings.

### `input/InputHandler.ts`

State machine for parsing terminal input sequences.

```ts
export class InputHandler {
  on(event: "key", handler: (key: string) => void): this
  on(event: "mouse", handler: (pos: {row: number, col: number, button: number}) => void): this
  on(event: "resize", handler: (size: {rows: number, cols: number}) => void): this
  feed(data: string): void
  resetEscBuffer(): void
}
```

ESC timeout: 50ms. `resetEscBuffer()` cancels timer on CSI completion.

### `utils/AnsiCodes.ts`

ANSI escape code builders.

```ts
export const CUP = (row: number, col: number) => `\x1b[${row + 1};${col + 1}H`
export const SGR = (fg: number, bg: number) => fg === 0 && bg === 0 ? "\x1b[0m" : `\x1b[0;38;5;${fg};48;5;${bg}m`
export const ECH = (n: number) => `\x1b[${n}X`
export const ED = (n: number) => `\x1b[${n}J`
export const DECTCEM = (show: boolean) => show ? "\x1b[?25h" : "\x1b[?25l"
export const DECSET = (n: number) => `\x1b[?${n}h`
export const DECRST = (n: number) => `\x1b[?${n}l`
```

### `utils/WidthUtils.ts`

Character width estimation.

```ts
export function charWidth(code: number): 1 | 2
```

### `utils/TerminalFeatures.ts`

Terminal capability detection.

```ts
export class TerminalFeatures {
  static get isAnsi(): boolean
  static get is256Color(): boolean
  static get synchronizedOutput(): boolean
}
```

Tmux guard: `synchronizedOutput` is `false` when `process.env["TMUX"]` is set.

### `window/WindowSize.ts`

Terminal size tracking.

```ts
export class WindowSize {
  get rows(): number
  get cols(): number
  onResize(handler: () => void): void
  poll(intervalMs?: number): void
  stopPolling(): void
}
```

Windows uses 100ms polling; Unix uses SIGWINCH.

### `window/TerminalManager.ts`

Top-level lifecycle manager.

```ts
export class TerminalManager {
  static startup(): void
  static shutdown(): void
  static get rows(): number
  static get cols(): number
}
```

`startup()` calls `enableVT()` (from `enable-vt.ts`) for Windows VT processing.

---

## SGR Convention

- Every SGR sequence starts with reset (`0`): `\x1b[0;38;5;${fg};48;5;${bg}m`
- Default fg (0) renders as SGR 39 (terminal default foreground)
- Default bg (0) renders as SGR 49 (terminal default background)
- Color range: 0 = terminal default, 1-255 = 256-color palette

---

## Key Decisions (ADR Format)

| ID | Decision | Rationale |
|---|---|---|
| ADR-T-001 | Int32Array for cells | Uint16Array cannot hold emoji (>0xFFFF). Memory delta (~20KB for 10K cells) is negligible. |
| ADR-T-002 | CUP +1 correction in output | DirtyDiff emits `\x1b[${y+1};${x+1}H`. Input coordinates are 0-indexed, ANSI is 1-indexed. |
| ADR-T-003 | SGR starts with reset `0` | Ensures clean state regardless of terminal history. No stale attributes leak across cells. |
| ADR-T-004 | 50ms ESC timeout | Balances responsiveness vs false Escape detection. Canceled on CSI completion. |
| ADR-T-005 | SGR delta deferred (Phase 2) | Current full-SGR approach: up to 40 bytes/cell. Delta SGR would save 30-50% bandwidth on SSH. Not needed for local 60 FPS. |
| ADR-T-006 | Windows polling 100ms | SIGWINCH not available on Windows. 100ms balances responsiveness vs CPU. |
| ADR-T-007 | enableVT() explicit function | Not a side-effect on import. Called from TerminalManager.startup(). Windows only. |
| ADR-T-008 | synchronizedOutput disabled in tmux | tmux does not forward DECSET 2026. Guard prevents stale synchronization state. |

---

## Test Matrix

| File | Tests | Coverage |
|---|---|---|
| `ScreenBuffer.test.ts` | 15 | cell CRUD, fill, scroll, edge cases |
| `DirtyDiff.test.ts` | 14 | diff generation, SGR correctness, ECH optimization |
| `DoubleBuffer.test.ts` | 6 | swap, flush, identity optimization |
| `InputHandler.test.ts` | 22 | key parsing, mouse, ESC sequences, timeout |
| `WindowSize.test.ts` | 2 | size reporting, resize event |
| `RawMode.test.ts` | 2 | enter/exit, isRaw state |
| **Total** | **61** | ✅ All passing |

---

## Deferred to Phase 2

| Feature | Reason |
|---|---|
| SGR delta state machine | 30-50% SSH bandwidth saving, not needed locally |
| Backpressure / frame dropping | `drain` event covers it; edge case |
| Render scheduling (requestAnimationFrame equivalent) | Not needed until UI rendering |
| Virtual scroll / offscreen buffers | Not needed until scrollable content |
