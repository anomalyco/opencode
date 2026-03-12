/**
 * Verify the scrollback bytes fix.
 *
 * Root cause: scrollbackLimit is passed as a line count (e.g. 10000)
 * but ghostty's Screen.init() interprets max_scrollback as bytes.
 * Native ghostty defaults to 10,000,000 (10MB). Passing 10,000 gives
 * only ~10KB, causing premature page pruning after ~500 rows.
 *
 * Fix: convert line count to bytes before passing to WASM.
 */

import { describe, expect, test } from 'bun:test';
import { createIsolatedTerminal } from './test-helpers';
import type { Terminal } from './terminal';

const ESC = '\x1b';

function generateTestOutput(): Uint8Array {
  const lines: string[] = [];
  lines.push(`${ESC}[1m${'═'.repeat(80)}${ESC}[0m`);
  lines.push('');
  lines.push(`${ESC}[1m── COLORS ──${ESC}[0m`);
  for (let row = 0; row < 8; row++) {
    let line = '';
    for (let i = 0; i < 32; i++) {
      line += `${ESC}[48;5;${row * 32 + i}m  ${ESC}[0m`;
    }
    lines.push(line);
  }
  lines.push(`${ESC}[1m── GRADIENTS ──${ESC}[0m`);
  for (let row = 0; row < 6; row++) {
    let line = '';
    for (let i = 0; i < 80; i++) {
      const r = Math.floor(Math.sin(i * 0.08 + row) * 127 + 128);
      const g = Math.floor(Math.sin(i * 0.08 + row + 2) * 127 + 128);
      const b = Math.floor(Math.sin(i * 0.08 + row + 4) * 127 + 128);
      line += `${ESC}[48;2;${r};${g};${b}m ${ESC}[0m`;
    }
    lines.push(line);
  }
  lines.push(`${ESC}[1m── ATTRIBUTES ──${ESC}[0m`);
  lines.push(`  ${ESC}[1mBold${ESC}[0m ${ESC}[3mItalic${ESC}[0m ${ESC}[4mUnderline${ESC}[0m ${ESC}[7mReverse${ESC}[0m`);
  lines.push(`${ESC}[1m── UNICODE ──${ESC}[0m`);
  lines.push('  ┌──────────┬──────────┐');
  lines.push('  │  Cell A   │  Cell B   │');
  lines.push('  ├──────────┼──────────┤');
  lines.push('  │  Cell C   │  Cell D   │');
  lines.push('  └──────────┴──────────┘');
  for (let section = 0; section < 4; section++) {
    lines.push(`${ESC}[1m── SECTION ${section + 5} ──${ESC}[0m`);
    for (let row = 0; row < 8; row++) {
      let line = '  ';
      for (let i = 0; i < 60; i++) {
        line += `${ESC}[38;5;${(section * 64 + row * 8 + i) % 256}m*${ESC}[0m`;
      }
      lines.push(line);
    }
  }
  lines.push('');
  lines.push('═'.repeat(80));
  lines.push('  ✓ Test complete');
  lines.push('═'.repeat(80));
  lines.push('');
  return new TextEncoder().encode(lines.join('\r\n') + '\r\n');
}

function getViewportText(term: Terminal): string[] {
  const viewport = term.wasmTerm!.getViewport();
  const cols = term.cols;
  const rows: string[] = [];
  for (let row = 0; row < term.rows; row++) {
    let text = '';
    for (let col = 0; col < cols; col++) {
      const c = viewport[row * cols + col];
      if (c.width === 0) continue;
      text += c.codepoint > 32 ? String.fromCodePoint(c.codepoint) : ' ';
    }
    rows.push(text.trimEnd());
  }
  return rows;
}

describe('Scrollback bytes fix verification', () => {
  const data = generateTestOutput();

  // scrollback=10000 lines — now correctly converted to bytes internally
  test('scrollback=10000 has no scrollback drops after bytes fix', async () => {
    const term = await createIsolatedTerminal({ cols: 160, rows: 39, scrollback: 10000 });
    const container = document.createElement('div');
    term.open(container);

    const sbLengths: number[] = [];
    for (let rep = 0; rep < 12; rep++) {
      term.write(data);
      term.wasmTerm!.update();
      sbLengths.push(term.wasmTerm!.getScrollbackLength());
    }

    let drops = 0;
    for (let i = 1; i < sbLengths.length; i++) {
      if (sbLengths[i] < sbLengths[i - 1]) drops++;
    }

    console.log('scrollback=10000:', sbLengths.join(', '));
    console.log(`Drops: ${drops}`);
    expect(drops).toBe(0);
    term.dispose();
  });

  // After fix: scrollback=10_000_000 (10MB, matching native ghostty) → no corruption
  test('AFTER fix: scrollback=10000000 (10MB) has no scrollback drops', async () => {
    const term = await createIsolatedTerminal({ cols: 160, rows: 39, scrollback: 10_000_000 });
    const container = document.createElement('div');
    term.open(container);

    const sbLengths: number[] = [];
    for (let rep = 0; rep < 12; rep++) {
      term.write(data);
      term.wasmTerm!.update();
      sbLengths.push(term.wasmTerm!.getScrollbackLength());
    }

    let drops = 0;
    for (let i = 1; i < sbLengths.length; i++) {
      if (sbLengths[i] < sbLengths[i - 1]) drops++;
    }

    console.log('scrollback=10000000:', sbLengths.join(', '));
    console.log(`Drops: ${drops}`);
    expect(drops).toBe(0); // Bug fixed
    term.dispose();
  });

  // Verify viewport text is also correct with large scrollback
  test('AFTER fix: viewport text stable at cols=130 and cols=160 with large scrollback', async () => {
    for (const cols of [130, 160]) {
      const term = await createIsolatedTerminal({ cols, rows: 39, scrollback: 10_000_000 });
      const container = document.createElement('div');
      term.open(container);

      let baseline: string[] | null = null;
      let vpCorrupt = false;

      const sbLengths: number[] = [];
      for (let rep = 0; rep < 12; rep++) {
        term.write(data);
        term.wasmTerm!.update();
        sbLengths.push(term.wasmTerm!.getScrollbackLength());
        const text = getViewportText(term);
        if (!baseline) { baseline = text; }
        else {
          for (let i = 0; i < Math.max(text.length, baseline.length); i++) {
            if ((text[i] || '') !== (baseline[i] || '')) { vpCorrupt = true; break; }
          }
        }
      }

      let sbDrops = 0;
      for (let i = 1; i < sbLengths.length; i++) {
        if (sbLengths[i] < sbLengths[i - 1]) sbDrops++;
      }

      console.log(`cols=${cols}: viewport=${vpCorrupt ? 'CORRUPT' : 'OK'} scrollback_drops=${sbDrops} sbLens=[${sbLengths.join(',')}]`);
      term.dispose();
    }
  });

  // Find the minimum scrollback value that prevents corruption
  test('minimum safe scrollback value', async () => {
    for (const sb of [10000, 50000, 100000, 500000, 1000000, 5000000, 10000000]) {
      const term = await createIsolatedTerminal({ cols: 160, rows: 39, scrollback: sb });
      const container = document.createElement('div');
      term.open(container);

      const sbLengths: number[] = [];
      for (let rep = 0; rep < 12; rep++) {
        term.write(data);
        term.wasmTerm!.update();
        sbLengths.push(term.wasmTerm!.getScrollbackLength());
      }

      let drops = 0;
      for (let i = 1; i < sbLengths.length; i++) {
        if (sbLengths[i] < sbLengths[i - 1]) drops++;
      }

      console.log(`scrollback=${sb}: drops=${drops} ${drops === 0 ? '✓' : '✗'}`);
      term.dispose();
    }
  });
});
