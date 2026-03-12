import { Terminal as XTerm } from '@xterm/xterm';
import { bench, group, run } from 'mitata';
import { Ghostty, Terminal as GhosttyTerminal } from '../lib';
import '../happydom';

function generateColorText(lines: number): string {
  const colors = [31, 32, 33, 34, 35, 36];
  let output = '';
  for (let i = 0; i < lines; i++) {
    const color = colors[i % colors.length];
    output += `\x1b[${color}mLine ${i}: This is some colored text with ANSI escape sequences\x1b[0m\r\n`;
  }
  return output;
}

function generateComplexVT(lines: number): string {
  let output = '';
  for (let i = 0; i < lines; i++) {
    output += `\x1b[1;4;38;2;255;128;0mBold underline RGB\x1b[0m `;
    output += `\x1b[48;5;236mBG 256\x1b[0m `;
    output += `\x1b[7mInverse\x1b[0m\r\n`;
  }
  return output;
}

function generateRawBytes(size: number): Uint8Array {
  const data = new Uint8Array(size);
  for (let i = 0; i < size; i++) {
    const mod = i % 85;
    if (mod < 80) {
      data[i] = 32 + (i % 95); // Printable ASCII
    } else if (mod === 80) {
      data[i] = 13; // \r
    } else {
      data[i] = 10; // \n
    }
  }
  return data;
}

function generateCursorMovement(ops: number): string {
  let output = '';
  for (let i = 0; i < ops; i++) {
    output += `\x1b[${(i % 24) + 1};${(i % 80) + 1}H`; // Cursor position
    output += `\x1b[K`; // Clear to end of line
    output += `Text at position ${i}`;
    output += `\x1b[A\x1b[B\x1b[C\x1b[D`; // Up, Down, Right, Left
  }
  return output;
}

const withTerminals = async (fn: (term: GhosttyTerminal | XTerm) => Promise<void>) => {
  const ghostty = await Ghostty.load();
  bench('ghostty-web', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const term = new GhosttyTerminal({ ghostty });
    await term.open(container);
    await fn(term);
    await term.dispose();
  });
  bench('xterm.js', async () => {
    const xterm = new XTerm();
    const container = document.createElement('div');
    document.body.appendChild(container);
    await xterm.open(container);
    await fn(xterm);
    await xterm.dispose();
  });
};

const throughput = async (prefix: string, data: Record<string, Uint8Array | string>) => {
  await Promise.all(
    Object.entries(data).map(async ([name, data]) => {
      await group(`${prefix}: ${name}`, async () => {
        await withTerminals(async (term) => {
          await new Promise<void>((resolve) => {
            term.write(data, resolve);
          });
        });
      });
    })
  );
};

await throughput('raw bytes', {
  '1KB': generateRawBytes(1024),
  '10KB': generateRawBytes(10 * 1024),
  '100KB': generateRawBytes(100 * 1024),
  '1MB': generateRawBytes(1024 * 1024),
});

await throughput('color text', {
  '100 lines': generateColorText(100),
  '1000 lines': generateColorText(1000),
  '10000 lines': generateColorText(10000),
});

await throughput('complex VT', {
  '100 lines': generateComplexVT(100),
  '1000 lines': generateComplexVT(1000),
  '10000 lines': generateComplexVT(10000),
});

await throughput('cursor movement', {
  '1000 operations': generateCursorMovement(1000),
  '10000 operations': generateCursorMovement(10000),
  '100000 operations': generateCursorMovement(100000),
});

await group('read full viewport', async () => {
  await withTerminals(async (term) => {
    const lines = term.rows;
    for (let i = 0; i < lines; i++) {
      const line = term.buffer.active.getLine(i);
      if (!line) {
        continue;
      }
      line.translateToString();
    }
  });
});

await run();
