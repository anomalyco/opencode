# Terminal Engine Roadmap

**Current**: Phase 3 L1–L6 (ScreenBuffer rewrite + DirtyDiff span tracking + SGR Flyweight + benchmarks — 165 non-bench tests, 0 fail)  
**Next**: Phase 3 L7 (Direct PTY syscall)  
**Future**: Phase 4+ Ecosystem

---

## Mythos 5 Security Standard

Semua fase harus lulus 5 kriteria Mythos sebelum dikunci. Standar ini
berasal dari **Claude Mythos 5** (Project Glasswing) — model AI keamanan
siber Anthropic yang menemukan 10,000+ critical vuln.

| # | Kriteria | Arti |
|---|----------|------|
| 1 | **Zero Attack Surface** | Tidak ada dead code, handler dummy, atau route mati yang bisa di-inject |
| 2 | **Zero Resource Exhaustion** | Tidak ada unbounded loop/queue, memory leak, atau flaky timeout |
| 3 | **Absolute Type Safety** | 0 type cast liar. Setiap cast harus terdaftar sebagai debt |
| 4 | **Lifecycle Integrity** | Startup/shutdown idempotent, exception-safe, tanpa side-effect global |
| 5 | **Evidence Gate** | Setiap klaim diverifikasi forensik — tidak ada "pre-existing" tanpa bukti |

## Phase 2: UI + SGR Delta

### Objective

Build UI primitives on top of the Phase 1 engine, then optimize rendering bandwidth with SGR delta encoding.

### Components

| Component | Description |
|---|---|
| `src/terminal/widgets/Box.ts` | Bordered box with optional title |
| `src/terminal/widgets/Text.ts` | Text rendering with word-wrap |
| `src/terminal/widgets/List.ts` | Scrollable list with selection |
| `src/terminal/widgets/Input.ts` | Text input field |
| `src/terminal/widgets/ProgressBar.ts` | Indeterminate/determinate progress |
| `src/terminal/layout/Flex.ts` | Simple flexbox-style layout engine |
| `src/terminal/layout/Stack.ts` | Vertical/horizontal stack |

### SGR Delta State Machine

Replace full-SGR-per-cell (`\x1b[0;38;5;${fg};48;5;${bg}m`) with delta-only output:

```
State: {fg, bg, bold, italic, underline, strikethrough, inverse}
On new cell: emit SGR changes only, not full reset
```

**Expected**: 30-50% bandwidth reduction on SSH connections.

### Pre-requisites

- All Phase 1 debts tracked and not worsened
- Render scheduling (frame rate limiting)
- Backpressure detection

### Deliverables

- 15+ widget tests
- SGR delta benchmark showing bandwidth reduction
- No regression in Phase 1 test suite

---

## Phase 3: God-Tier Optimizations

Status: **L1–L6 COMPLETE** (MUEL v1.0 Compliant)

| Layer | Component | Status | Benchmark |
|-------|-----------|--------|-----------|
| L1 | ScreenBuffer — Single ArrayBuffer SSOT | ✅ | Memory: 8 bytes/cell (−93.8%) |
| L2 | DirtyDiff — Span tracking via BigUint64Array | ✅ | 0.783 ratio (27.6% faster), CV 8.01% |
| L3 | SgrFlyweight — Dictionary-cached SGR | ✅ | 0.091 ratio (11.0× faster), CV 4.37% |
| L4 | Benchmarks — DirtyDiff + Flyweight | ✅ | Both pass CV < 10% |
| L5 | Baseline results capture | ✅ | See `docs/terminal/phase3-compliance.md` |
| L6 | Typecheck + Test suite | ✅ | 165 non-bench pass, 0 terminal type errors |
| L7 | Direct PTY syscall | ⏳ | Planned |

### Span-Based Dirty Tracking

Replace per-cell `DirtyDiff` with `BigUint64Array` span tracking:

```
Current (Phase 2): cellEquals per cell → CUP + SGR per cell
God-Tier (Phase 3): findSpans → CUP per span + flyweight SGR
```

Each span: `{ sx: number, ex: number, y: number }` found by scanning
`prev.packed[i] !== curr.packed[i]` (single BigUint64 compare).

### SGR Flyweight Dictionary

Cache SGR sequences as `Map<number, string>`:

```
Key: (fg << 16 | bg << 8 | attrMask)
Value: pre-rendered SGR string
```

Hit rate: 100% after warmup (660 unique keys for typical UIs).

### Direct PTY Syscall

Replace `process.stdout.write()` with `writeSync(fd, buffer)` on Unix:

- Bypasses Node.js stream overhead
- Returns immediately (no backpressure from stream)
- ~40% throughput improvement

### Compliance

See `docs/terminal/phase3-compliance.md` for:
- H6: Full Change Log with before/after metrics
- H9: Rollback Procedure (all changes zero-data-loss)
- H10: Blast Radius Map (low risk, 0 API breaks)

---

## Phase 4+: Ecosystem

| Phase | Scope |
|---|---|
| 4 | Accessibility (ARIA-like terminal patterns, high-contrast mode) |
| 5 | Remote rendering (SSH session forwarding, tmux integration) |
| 6 | GPU-accelerated render pass (WebGL fallback for browser terminals) |

---

## Key Metrics

| Metric | Phase 1 | Phase 2 | Phase 3 |
|---|---|---|---|
| Tests | 61 | 80+ | 100+ |
| Type errors | 0 | 0 | 0 |
| Dependencies | 0 | 0 | 0 |
| SGR bytes/cell | ~40 | ~15 (delta) | ~5 (flyweight) |
| Render latency (10K cells) | ~2ms | ~1ms | ~0.3ms |
| Memory/cell | ~64 bytes | ~64 bytes | ~50 bytes |

---

## Active Debts

| ID | Description | Target | Status |
|---|---|---|---|
| TD-T-001 | 164 pre-existing type errors in `src/evolution/` (Effect v4 API migration) | Phase 6 | Open |
| TD-T-002 | `as Layer.Any` escape di `agent.ts:448` / `system.ts:113` | Phase 6 | Open |
| MUEL-001 | Evolution code violates H8 (type dishonesty) — 270+ `as any` across evolution/ | Phase 6 | Open |

## Resolved Debts

| ID | Description | Resolved In | Evidence |
|---|---|---|---|
| AD-T-001 | SGR delta implemented (bandwidth optimization) | Phase 2 | Benchmark: 7.6% savings random, 60-80% expected real |
| AD-T-002 | Render scheduling via Central Tick Scheduler | Phase 2 | Scheduler.test.ts — frame limiting, backpressure |
| AD-T-003 | Backpressure handling (render returns false = pause) | Phase 2 | Scheduler.test.ts — pause/resume on drain |
| MUEL-004 | Empty catch blocks in terminal code (3 violations) | Phase 2 | Fix: log error with context |
| MUEL-008 | `as any` in terminal production code (7 violations) | Phase 2 | Fix: type guard, LayoutWidget, proper imports |
| MUEL-008 | `as any` in terminal test code (18 violations) | Phase 2 | Fix: WidgetStub helper, Object.defineProperty |
| AD-P3-001 | ScreenBuffer — Single ArrayBuffer SSOT (eliminate 5 legacy arrays) | Phase 3 | Memory: 8 bytes/cell (−93.8%) |
| AD-P3-002 | DirtyDiff — Span tracking via BigUint64Array comparison | Phase 3 | Benchmark: 0.783 ratio, CV 8.01% |
| AD-P3-003 | SgrFlyweight — Dictionary-cached SGR sequences | Phase 3 | Benchmark: 0.091 ratio (11.0×), CV 4.37% |
| AD-P3-004 | H6 Change Log for Phase 3 | Phase 3 | `docs/terminal/phase3-compliance.md` |
| AD-P3-005 | H9 Rollback Procedure for Phase 3 | Phase 3 | `docs/terminal/phase3-compliance.md` |
| AD-P3-006 | H10 Blast Radius Map for Phase 3 | Phase 3 | `docs/terminal/phase3-compliance.md` |

## MUEL v1.0 Compliance

The **Mythos Universal Evidence Law (MUEL v1.0)** governs all code in this
project. See `docs/constitution/MUEL-v1.0.md` for the full constitution.

**Current status**: `src/terminal/` and `test/terminal/` are 100% MUEL-compliant
(0 `as any`, 0 empty catches, 0 type suppressions). Phase 3 L1–L6 compliance
verified in `docs/terminal/phase3-compliance.md` (H6 Change Log, H9 Rollback
Procedure, H10 Blast Radius Map completed). `src/evolution/` carries pre-existing
debt tracked as TD-T-001 and MUEL-001.
