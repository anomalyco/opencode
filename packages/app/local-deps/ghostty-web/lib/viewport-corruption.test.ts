/**
 * Viewport Corruption Tests
 *
 * Tests for the WASM viewport row-merge bug described in WASM_VIEWPORT_BUG.md.
 * After repeated escape-heavy writes, getViewport() allegedly returns corrupted
 * data where two terminal lines are horizontally concatenated into one row.
 *
 * These tests confirm or deny whether the bug exists.
 */

import { describe, expect, test } from 'bun:test';
import { createIsolatedTerminal } from './test-helpers';
import type { Terminal } from './terminal';

/**
 * Generate escape-heavy terminal output matching the bug report description.
 * Exercises SGR 8/16/256/truecolor, text attributes, Unicode, and OSC sequences.
 * Produces ~45 lines of output per call.
 */
function generateEscapeHeavyOutput(runNumber: number): string {
  const lines: string[] = [];
  const ESC = '\x1b';

  // OSC 0: Set terminal title
  lines.push(`${ESC}]0;Test Run ${runNumber}${ESC}\\`);

  // Section 1: Basic 8/16 colors
  lines.push(`${ESC}[1m── 1. BASIC COLORS (Run ${runNumber}) ──${ESC}[0m`);
  let colorLine = '';
  for (let i = 30; i <= 37; i++) {
    colorLine += `${ESC}[${i}m Color${i} ${ESC}[0m`;
  }
  lines.push(colorLine);
  let brightLine = '';
  for (let i = 90; i <= 97; i++) {
    brightLine += `${ESC}[${i}m Bright${i} ${ESC}[0m`;
  }
  lines.push(brightLine);

  // Section 2: Text attributes
  lines.push(`${ESC}[1m── 2. TEXT ATTRIBUTES ──${ESC}[0m`);
  lines.push(
    `  ${ESC}[1mBold${ESC}[0m ${ESC}[2mDim${ESC}[0m ${ESC}[3mItalic${ESC}[0m ${ESC}[4mUnderline${ESC}[0m ${ESC}[5mBlink${ESC}[0m ${ESC}[7mReverse${ESC}[0m ${ESC}[9mStrike${ESC}[0m`
  );

  // Section 3: 256-color backgrounds (2 rows of 128 each)
  lines.push(`${ESC}[1m── 3. 256-COLOR PALETTE ──${ESC}[0m`);
  let palette1 = '';
  for (let i = 0; i < 128; i++) {
    palette1 += `${ESC}[48;5;${i}m ${ESC}[0m`;
  }
  lines.push(palette1);
  let palette2 = '';
  for (let i = 128; i < 256; i++) {
    palette2 += `${ESC}[48;5;${i}m ${ESC}[0m`;
  }
  lines.push(palette2);

  // Section 4: True color gradients
  lines.push(`${ESC}[1m── 4. TRUE COLOR GRADIENTS ──${ESC}[0m`);
  for (const [label, rFn, gFn, bFn] of [
    ['Red', (i: number) => i * 2, () => 0, () => 0],
    ['Green', () => 0, (i: number) => i * 2, () => 0],
    ['Blue', () => 0, () => 0, (i: number) => i * 2],
    ['Rainbow', (i: number) => Math.sin(i * 0.05) * 127 + 128, (i: number) => Math.sin(i * 0.05 + 2) * 127 + 128, (i: number) => Math.sin(i * 0.05 + 4) * 127 + 128],
  ] as [string, (i: number) => number, (i: number) => number, (i: number) => number][]) {
    let grad = `  ${label}: `;
    for (let i = 0; i < 64; i++) {
      const r = Math.floor(rFn(i));
      const g = Math.floor(gFn(i));
      const b = Math.floor(bFn(i));
      grad += `${ESC}[48;2;${r};${g};${b}m ${ESC}[0m`;
    }
    lines.push(grad);
  }

  // Section 5: More attributes with colors
  lines.push(`${ESC}[1m── 5. COMBINED STYLES ──${ESC}[0m`);
  lines.push(`  ${ESC}[1;31mBold Red${ESC}[0m  ${ESC}[3;32mItalic Green${ESC}[0m  ${ESC}[4;34mUnderline Blue${ESC}[0m  ${ESC}[1;3;35mBold Italic Magenta${ESC}[0m`);
  lines.push(`  ${ESC}[38;2;255;165;0m24-bit Orange${ESC}[0m  ${ESC}[38;5;201mPalette Pink${ESC}[0m  ${ESC}[7;36mReverse Cyan${ESC}[0m`);

  // Section 6: Unicode box drawing
  lines.push(`${ESC}[1m── 6. UNICODE & BOX DRAWING ──${ESC}[0m`);
  lines.push('');
  lines.push('  ┌──────────┬──────────┐');
  lines.push('  │  Cell A   │  Cell B   │');
  lines.push('  ├──────────┼──────────┤');
  lines.push('  │  Cell C   │  Cell D   │');
  lines.push('  └──────────┴──────────┘');
  lines.push('');
  lines.push('  Braille: ⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏  Arrows: ←↑→↓↔↕  Math: ∑∏∫∂√∞≠≈');

  // Section 7: OSC 8 hyperlinks
  lines.push(`${ESC}[1m── 7. OSC 8 HYPERLINKS ──${ESC}[0m`);
  lines.push(`  Click: ${ESC}]8;;https://example.com${ESC}\\Example Link${ESC}]8;;${ESC}\\  (OSC 8)`);

  // Section 8: Rainbow banner
  lines.push(`${ESC}[1m── 8. RAINBOW BANNER ──${ESC}[0m`);
  const bannerText = '  GHOSTTY WASM TERMINAL TEST  ';
  let banner = '';
  for (let i = 0; i < bannerText.length; i++) {
    const colorIdx = 196 + (i % 36);
    banner += `${ESC}[48;5;${colorIdx};1m${bannerText[i]}${ESC}[0m`;
  }
  lines.push(banner);

  // Section 9: Summary separator
  lines.push('');
  lines.push('═'.repeat(80));
  lines.push(`  ✓ Run ${runNumber} complete`);
  lines.push('═'.repeat(80));
  lines.push('');

  return lines.join('\r\n') + '\r\n';
}

/**
 * Extract text content from a viewport row.
 */
function getViewportRowText(term: Terminal, row: number): string {
  const viewport = term.wasmTerm?.getViewport();
  if (!viewport) return '';
  const cols = term.cols;
  const start = row * cols;
  return viewport
    .slice(start, start + cols)
    .map((c) => String.fromCodePoint(c.codepoint || 32))
    .join('')
    .trimEnd();
}

/**
 * Extract text content from getLine.
 */
function getLineRowText(term: Terminal, row: number): string {
  const line = term.wasmTerm?.getLine(row);
  if (!line) return '';
  return line
    .map((c) => String.fromCodePoint(c.codepoint || 32))
    .join('')
    .trimEnd();
}

/**
 * Generate output with unique line markers for merge detection.
 */
function generateMarkedOutput(runNumber: number, lineCount: number): string {
  const ESC = '\x1b';
  const lines: string[] = [];
  for (let i = 0; i < lineCount; i++) {
    const marker = `R${runNumber.toString().padStart(2, '0')}L${i.toString().padStart(2, '0')}`;
    // Add escape sequences to stress the parser
    lines.push(
      `${ESC}[38;5;${(i * 7) % 256}m${marker}${ESC}[0m: ${ESC}[1m${ESC}[48;2;${i * 3};${i * 5};${i * 7}mContent line ${i} of run ${runNumber}${ESC}[0m ${'─'.repeat(40)}`
    );
  }
  return lines.join('\r\n') + '\r\n';
}

describe('Viewport Corruption', () => {
  describe('getViewport consistency after repeated escape-heavy writes', () => {
    test('getViewport and getLine return identical data after each run', async () => {
      const term = await createIsolatedTerminal({ cols: 140, rows: 40, scrollback: 10000 });
      const container = document.createElement('div');
      term.open(container);

      for (let run = 1; run <= 10; run++) {
        const output = generateEscapeHeavyOutput(run);
        term.write(output);
        term.wasmTerm!.update();

        // Compare every row: getViewport vs getLine
        for (let row = 0; row < term.rows; row++) {
          const viewportText = getViewportRowText(term, row);
          const lineText = getLineRowText(term, row);
          expect(viewportText).toBe(lineText);
        }
      }

      term.dispose();
    });

    test('getViewport returns identical data on consecutive calls', async () => {
      const term = await createIsolatedTerminal({ cols: 140, rows: 40, scrollback: 10000 });
      const container = document.createElement('div');
      term.open(container);

      for (let run = 1; run <= 10; run++) {
        const output = generateEscapeHeavyOutput(run);
        term.write(output);
        term.wasmTerm!.update();

        const viewport1 = term.wasmTerm!.getViewport();
        const snapshot1 = viewport1.map((c) => ({
          codepoint: c.codepoint,
          fg_r: c.fg_r,
          fg_g: c.fg_g,
          fg_b: c.fg_b,
          bg_r: c.bg_r,
          bg_g: c.bg_g,
          bg_b: c.bg_b,
          flags: c.flags,
          width: c.width,
        }));

        const viewport2 = term.wasmTerm!.getViewport();
        const snapshot2 = viewport2.map((c) => ({
          codepoint: c.codepoint,
          fg_r: c.fg_r,
          fg_g: c.fg_g,
          fg_b: c.fg_b,
          bg_r: c.bg_r,
          bg_g: c.bg_g,
          bg_b: c.bg_b,
          flags: c.flags,
          width: c.width,
        }));

        expect(snapshot1).toEqual(snapshot2);
      }

      term.dispose();
    });
  });

  describe('row-merge detection with marked lines', () => {
    test('no viewport row contains markers from two different lines', async () => {
      const term = await createIsolatedTerminal({ cols: 140, rows: 40, scrollback: 10000 });
      const container = document.createElement('div');
      term.open(container);

      const linesPerRun = 45;

      for (let run = 1; run <= 10; run++) {
        const output = generateMarkedOutput(run, linesPerRun);
        term.write(output);
        term.wasmTerm!.update();

        // Check each viewport row for multiple markers
        for (let row = 0; row < term.rows; row++) {
          const text = getViewportRowText(term, row);
          // Find all R##L## markers in this row
          const markers = text.match(/R\d{2}L\d{2}/g) || [];
          const uniqueMarkers = new Set(markers);
          // A row should contain at most one unique marker
          if (uniqueMarkers.size > 1) {
            throw new Error(
              `Run ${run}, row ${row}: found ${uniqueMarkers.size} different markers in one row: ${[...uniqueMarkers].join(', ')}\n` +
              `Row content: "${text}"`
            );
          }
        }
      }

      term.dispose();
    });

    test('markers remain intact after accumulating scrollback', async () => {
      const term = await createIsolatedTerminal({ cols: 140, rows: 40, scrollback: 10000 });
      const container = document.createElement('div');
      term.open(container);

      const linesPerRun = 45;

      for (let run = 1; run <= 10; run++) {
        const output = generateMarkedOutput(run, linesPerRun);
        term.write(output);
        term.wasmTerm!.update();

        // Verify viewport rows containing markers have the correct format
        for (let row = 0; row < term.rows; row++) {
          const text = getViewportRowText(term, row);
          const match = text.match(/R(\d{2})L(\d{2})/);
          if (match) {
            const markerRun = parseInt(match[1], 10);
            const markerLine = parseInt(match[2], 10);
            // The marker should reference a valid run/line
            expect(markerRun).toBeGreaterThanOrEqual(1);
            expect(markerRun).toBeLessThanOrEqual(run);
            expect(markerLine).toBeGreaterThanOrEqual(0);
            expect(markerLine).toBeLessThan(linesPerRun);
          }
        }
      }

      term.dispose();
    });
  });

  describe('viewport stability across page boundaries', () => {
    test('viewport consistent when output exceeds single page size', async () => {
      // Use smaller scrollback to force page recycling sooner
      const term = await createIsolatedTerminal({ cols: 140, rows: 40, scrollback: 500 });
      const container = document.createElement('div');
      term.open(container);

      // Write enough to overflow scrollback multiple times
      for (let run = 1; run <= 20; run++) {
        const output = generateMarkedOutput(run, 45);
        term.write(output);
        term.wasmTerm!.update();

        // Verify getViewport and getLine still agree
        for (let row = 0; row < term.rows; row++) {
          const viewportText = getViewportRowText(term, row);
          const lineText = getLineRowText(term, row);
          expect(viewportText).toBe(lineText);
        }

        // Check no row merging
        for (let row = 0; row < term.rows; row++) {
          const text = getViewportRowText(term, row);
          const markers = text.match(/R\d{2}L\d{2}/g) || [];
          const uniqueMarkers = new Set(markers);
          if (uniqueMarkers.size > 1) {
            throw new Error(
              `Run ${run}, row ${row}: row merge detected with ${uniqueMarkers.size} markers: ${[...uniqueMarkers].join(', ')}\n` +
              `Row content: "${text}"`
            );
          }
        }
      }

      term.dispose();
    });

    test('viewport consistent with large scrollback that triggers recycling', async () => {
      // Very small scrollback to force aggressive recycling
      const term = await createIsolatedTerminal({ cols: 140, rows: 40, scrollback: 100 });
      const container = document.createElement('div');
      term.open(container);

      for (let run = 1; run <= 15; run++) {
        const output = generateEscapeHeavyOutput(run);
        term.write(output);
        term.wasmTerm!.update();

        // getViewport and getLine must agree
        for (let row = 0; row < term.rows; row++) {
          const viewportText = getViewportRowText(term, row);
          const lineText = getLineRowText(term, row);
          expect(viewportText).toBe(lineText);
        }
      }

      term.dispose();
    });
  });
});
