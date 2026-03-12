/**
 * Viewport row-merging bug — self-contained reproduction.
 *
 * BUG: After writing enough escape-heavy output to accumulate scrollback,
 * getViewport() periodically returns corrupted data where content from
 * two rows is horizontally concatenated into a single row.
 *
 * Properties:
 * - Transient: self-corrects on the next write (not consecutive)
 * - Periodic: recurs at a fixed interval (~11 writes at cols=160 with this data)
 * - All column widths affected, just at different frequencies
 * - Independent of scrollback capacity (identical at 10KB..50MB)
 * - In WASM state: both getViewport() and getLine() return the same wrong data
 *
 * The trigger requires enough per-write byte volume (~20KB+) to advance
 * the ring buffer sufficiently. Smaller output (~3KB) only triggers the
 * bug at narrow widths (cols≈120-130); larger output triggers it everywhere.
 *
 * 100% self-contained — no external fixture files needed.
 */

import { describe, expect, test } from 'bun:test';
import { createIsolatedTerminal } from './test-helpers';
import type { Terminal } from './terminal';

const ESC = '\x1b';

/**
 * Generate ~25KB of escape-heavy terminal output. Must be large enough
 * to trigger the ring buffer misalignment at common widths (cols=160).
 *
 * The output simulates a color/rendering test script with:
 * - 256-color palette blocks (SGR 48;5;N)
 * - Truecolor gradients (SGR 48;2;R;G;B)
 * - Text attribute combinations (bold, italic, underline, reverse)
 * - Unicode box drawing
 * - Dense colored grids (8 sections × 8 rows × 70 cols)
 */
function generateOutput(): Uint8Array {
  const lines: string[] = [];

  lines.push(`${ESC}[1m${'═'.repeat(80)}${ESC}[0m`);
  lines.push(`${ESC}[1m  Terminal Rendering Test${ESC}[0m`);
  lines.push(`${ESC}[1m${'═'.repeat(80)}${ESC}[0m`);
  lines.push('');

  // 256-color palette
  lines.push(`${ESC}[1m── 1. 256-COLOR PALETTE ──${ESC}[0m`);
  for (let row = 0; row < 8; row++) {
    let line = '  ';
    for (let i = 0; i < 32; i++) {
      line += `${ESC}[48;5;${row * 32 + i}m  ${ESC}[0m`;
    }
    lines.push(line);
  }
  lines.push('');

  // Truecolor gradients
  lines.push(`${ESC}[1m── 2. TRUECOLOR GRADIENTS ──${ESC}[0m`);
  for (let row = 0; row < 8; row++) {
    let line = '  ';
    for (let i = 0; i < 80; i++) {
      const r = Math.floor(Math.sin(i * 0.08 + row) * 127 + 128);
      const g = Math.floor(Math.sin(i * 0.08 + row + 2) * 127 + 128);
      const b = Math.floor(Math.sin(i * 0.08 + row + 4) * 127 + 128);
      line += `${ESC}[48;2;${r};${g};${b}m ${ESC}[0m`;
    }
    lines.push(line);
  }
  lines.push('');

  // Text attributes
  lines.push(`${ESC}[1m── 3. TEXT ATTRIBUTES ──${ESC}[0m`);
  lines.push(`  ${ESC}[1mBold${ESC}[0m  ${ESC}[3mItalic${ESC}[0m  ${ESC}[4mUnderline${ESC}[0m  ${ESC}[7mReverse${ESC}[0m  ${ESC}[9mStrike${ESC}[0m`);
  lines.push(`  ${ESC}[1;3mBold+Italic${ESC}[0m  ${ESC}[1;4mBold+Under${ESC}[0m  ${ESC}[3;4mItalic+Under${ESC}[0m`);
  lines.push('');

  // Unicode box drawing
  lines.push(`${ESC}[1m── 4. UNICODE BOX DRAWING ──${ESC}[0m`);
  lines.push('  ┌──────────┬──────────┬──────────┐');
  lines.push('  │  Cell A   │  Cell B   │  Cell C   │');
  lines.push('  ├──────────┼──────────┼──────────┤');
  lines.push('  │  Cell D   │  Cell E   │  Cell F   │');
  lines.push('  └──────────┴──────────┴──────────┘');
  lines.push('');

  // Dense colored grids — this is the bulk, producing enough byte volume
  for (let section = 0; section < 8; section++) {
    lines.push(`${ESC}[1m── ${section + 5}. COLOR GRID ${String.fromCharCode(65 + section)} ──${ESC}[0m`);
    for (let row = 0; row < 8; row++) {
      let line = '  ';
      for (let i = 0; i < 70; i++) {
        const idx = (section * 64 + row * 8 + i) % 256;
        if ((i + row) % 3 === 0) {
          line += `${ESC}[38;2;${(idx * 7) % 256};${(idx * 13) % 256};${(idx * 23) % 256}m*${ESC}[0m`;
        } else {
          line += `${ESC}[38;5;${idx}m*${ESC}[0m`;
        }
      }
      lines.push(line);
    }
    lines.push('');
  }

  lines.push(`${ESC}[1m${'═'.repeat(80)}${ESC}[0m`);
  lines.push(`  ${ESC}[32m✓${ESC}[0m Test complete`);
  lines.push(`${ESC}[1m${'═'.repeat(80)}${ESC}[0m`);
  lines.push('');

  return new TextEncoder().encode(lines.join('\r\n') + '\r\n');
}

/** Read viewport as text rows. */
function getViewportText(term: Terminal): string[] {
  const vp = term.wasmTerm!.getViewport();
  const cols = term.cols;
  const rows: string[] = [];
  for (let r = 0; r < term.rows; r++) {
    let text = '';
    for (let c = 0; c < cols; c++) {
      const cell = vp[r * cols + c];
      if (cell.width === 0) continue;
      text += cell.codepoint > 32 ? String.fromCodePoint(cell.codepoint) : ' ';
    }
    rows.push(text.trimEnd());
  }
  return rows;
}

/** Count rows that differ between two viewport snapshots. */
function countDiffs(a: string[], b: string[]): number {
  let n = 0;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] || '') !== (b[i] || '')) n++;
  }
  return n;
}

describe('Viewport row-merge bug', () => {
  const data = generateOutput();

  test('test data is large enough (>20KB)', () => {
    expect(data.length).toBeGreaterThan(20_000);
  });

  /**
   * Primary assertion: viewport text should be identical after every write
   * of the same data. The bug causes periodic corruption where rows are
   * horizontally merged.
   */
  test('viewport text is stable after repeated writes', async () => {
    const term = await createIsolatedTerminal({ cols: 160, rows: 39, scrollback: 10_000_000 });
    const container = document.createElement('div');
    term.open(container);

    let baseline: string[] | null = null;
    const corruptReps: number[] = [];

    for (let rep = 0; rep < 30; rep++) {
      term.write(data);
      term.wasmTerm!.update();
      const text = getViewportText(term);

      if (!baseline) {
        baseline = text;
      } else {
        if (countDiffs(text, baseline) > 0) corruptReps.push(rep);
      }
    }

    if (corruptReps.length > 0) {
      console.log(`Corrupt at reps: [${corruptReps.join(', ')}]`);
    }
    expect(corruptReps.length).toBe(0);

    term.dispose();
  });

  /**
   * The corruption is transient — it never appears on consecutive writes.
   * The write after a corrupt read always produces a correct viewport.
   */
  test('corruption is never consecutive', async () => {
    const term = await createIsolatedTerminal({ cols: 160, rows: 39, scrollback: 10_000_000 });
    const container = document.createElement('div');
    term.open(container);

    let baseline: string[] | null = null;
    let prevCorrupt = false;
    let consecutivePairs = 0;

    for (let rep = 0; rep < 30; rep++) {
      term.write(data);
      term.wasmTerm!.update();
      const text = getViewportText(term);

      if (!baseline) {
        baseline = text;
        prevCorrupt = false;
      } else {
        const corrupt = countDiffs(text, baseline) > 0;
        if (corrupt && prevCorrupt) consecutivePairs++;
        prevCorrupt = corrupt;
      }
    }

    expect(consecutivePairs).toBe(0);
    term.dispose();
  });

  /**
   * The corruption is independent of scrollback capacity. The same
   * writes corrupt at the same reps regardless of buffer size.
   */
  test('corruption pattern is identical across scrollback sizes', async () => {
    const patterns: string[] = [];

    for (const sb of [10_000, 1_000_000, 50_000_000]) {
      const term = await createIsolatedTerminal({ cols: 160, rows: 39, scrollback: sb });
      const container = document.createElement('div');
      term.open(container);

      let baseline: string[] | null = null;
      const corruptReps: number[] = [];

      for (let rep = 0; rep < 15; rep++) {
        term.write(data);
        term.wasmTerm!.update();
        const text = getViewportText(term);

        if (!baseline) baseline = text;
        else if (countDiffs(text, baseline) > 0) corruptReps.push(rep);
      }

      patterns.push(corruptReps.join(','));
      console.log(`scrollback=${sb}: corrupt at [${corruptReps.join(', ')}]`);
      term.dispose();
    }

    // All patterns should be identical
    expect(new Set(patterns).size).toBe(1);
  });

  /**
   * Verify no row corruption occurs over many writes (regression guard).
   * Previously, rows showed horizontally merged content from stale page cells.
   */
  test('no row corruption over extended writes', async () => {
    const term = await createIsolatedTerminal({ cols: 160, rows: 39, scrollback: 10_000_000 });
    const container = document.createElement('div');
    term.open(container);

    let baseline: string[] | null = null;
    let corruptCount = 0;

    for (let rep = 0; rep < 30; rep++) {
      term.write(data);
      term.wasmTerm!.update();
      const text = getViewportText(term);

      if (!baseline) { baseline = text; continue; }
      if (countDiffs(text, baseline) > 0) corruptCount++;
    }

    expect(corruptCount).toBe(0);

    term.dispose();
  });

  /**
   * WORKAROUND: Replace every ESC[0m (SGR reset) with ESC[0;48;2;R;G;Bm
   * where R,G,B is the terminal's background color. This keeps bg_color
   * set to a non-.none value at all times, which triggers the row-clear
   * path in cursorDownScroll even in the unpatched WASM code.
   *
   * The visual result is identical — the explicit bg color matches the
   * terminal default — but the internal state differs enough to prevent
   * stale cells from surviving page growth.
   */
  test('workaround: replacing ESC[0m with ESC[0;48;2;bg;bg;bgm prevents corruption', async () => {
    const term = await createIsolatedTerminal({ cols: 160, rows: 39, scrollback: 10_000_000 });
    const container = document.createElement('div');
    term.open(container);

    // Theme bg for dark terminal: (10, 10, 10) — the default #0a0a0a
    const bgR = 10, bgG = 10, bgB = 10;
    const resetReplacement = new TextEncoder().encode(`\x1b[0;48;2;${bgR};${bgG};${bgB}m`);
    const resetSeq = new TextEncoder().encode('\x1b[0m');

    // Patch: replace every ESC[0m with ESC[0;48;2;R;G;Bm in the data
    function patchResets(src: Uint8Array): Uint8Array {
      // Find all occurrences of ESC[0m (bytes: 1B 5B 30 6D)
      const positions: number[] = [];
      for (let i = 0; i < src.length - 3; i++) {
        if (src[i] === 0x1B && src[i+1] === 0x5B && src[i+2] === 0x30 && src[i+3] === 0x6D) {
          positions.push(i);
        }
      }
      if (positions.length === 0) return src;

      const extra = resetReplacement.length - resetSeq.length;
      const out = new Uint8Array(src.length + positions.length * extra);
      let si = 0, di = 0;
      for (const pos of positions) {
        const chunk = src.subarray(si, pos);
        out.set(chunk, di);
        di += chunk.length;
        out.set(resetReplacement, di);
        di += resetReplacement.length;
        si = pos + resetSeq.length;
      }
      const tail = src.subarray(si);
      out.set(tail, di);
      di += tail.length;
      return out.subarray(0, di);
    }

    const patched = patchResets(data);
    console.log(`Original: ${data.length} bytes, patched: ${patched.length} bytes`);

    let baseline: string[] | null = null;
    const corruptReps: number[] = [];

    for (let rep = 0; rep < 30; rep++) {
      term.write(patched);
      term.wasmTerm!.update();
      const text = getViewportText(term);

      if (!baseline) { baseline = text; continue; }
      if (countDiffs(text, baseline) > 0) corruptReps.push(rep);
    }

    console.log(`With workaround: corrupt at [${corruptReps.join(', ')}] (${corruptReps.length}/30)`);
    expect(corruptReps.length).toBe(0);

    term.dispose();
  });

  /**
   * Both getViewport() and getLine() return the same wrong data,
   * proving the corruption is in the WASM ring buffer, not the API layer.
   */
  test('getViewport and getLine agree at the corrupt state', async () => {
    const term = await createIsolatedTerminal({ cols: 160, rows: 39, scrollback: 10_000_000 });
    const container = document.createElement('div');
    term.open(container);

    let baseline: string[] | null = null;

    for (let rep = 0; rep < 30; rep++) {
      term.write(data);
      term.wasmTerm!.update();
      const text = getViewportText(term);
      if (!baseline) { baseline = text; continue; }
      if (countDiffs(text, baseline) > 0) break; // stop at first corruption
    }

    // Compare APIs at whatever state we're in (corrupt or not)
    const vpText = getViewportText(term);
    let mismatches = 0;
    for (let row = 0; row < term.rows; row++) {
      const line = term.wasmTerm?.getLine(row);
      if (!line) continue;
      const lineText = line.map(c => String.fromCodePoint(c.codepoint || 32)).join('').trimEnd();
      if (vpText[row] !== lineText) mismatches++;
    }

    expect(mismatches).toBe(0);
    term.dispose();
  });
});
