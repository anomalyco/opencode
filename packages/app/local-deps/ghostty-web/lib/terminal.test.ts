/**
 * Terminal Integration Tests
 *
 * Tests the main Terminal class that integrates all components.
 * Note: These are logic-focused tests. Visual/rendering tests are skipped
 * since they require a full browser environment with canvas.
 *
 * Test Isolation Pattern:
 * Uses createIsolatedTerminal() to ensure each test gets its own WASM instance.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { Terminal } from './terminal';
import { createIsolatedTerminal } from './test-helpers';

/**
 * Helper to convert viewport row to absolute buffer row for selection tests.
 * Absolute row = scrollbackLength + viewportRow - viewportY
 */
function viewportRowToAbsolute(term: Terminal, viewportRow: number): number {
  const scrollbackLength = term.wasmTerm?.getScrollbackLength() ?? 0;
  const viewportY = Math.floor(term.getViewportY());
  return scrollbackLength + viewportRow - viewportY;
}

/**
 * Helper to set selection using viewport-relative rows (converts to absolute internally)
 */
function setSelectionViewportRelative(
  term: Terminal,
  startCol: number,
  startViewportRow: number,
  endCol: number,
  endViewportRow: number
): void {
  const selMgr = (term as any).selectionManager;
  if (selMgr) {
    (selMgr as any).selectionStart = {
      col: startCol,
      absoluteRow: viewportRowToAbsolute(term, startViewportRow),
    };
    (selMgr as any).selectionEnd = {
      col: endCol,
      absoluteRow: viewportRowToAbsolute(term, endViewportRow),
    };
  }
}

describe('Terminal', () => {
  let container: HTMLElement;

  beforeEach(async () => {
    // Create a container element if document is available
    if (typeof document !== 'undefined') {
      container = document.createElement('div');
      document.body.appendChild(container);
    }
  });

  afterEach(() => {
    // Clean up container
    if (container && container.parentNode) {
      container.parentNode.removeChild(container);
      container = null!;
    }
  });

  describe('Constructor', () => {
    test('creates terminal with default size', async () => {
      const term = await createIsolatedTerminal();
      expect(term.cols).toBe(80);
      expect(term.rows).toBe(24);
    });

    test('creates terminal with custom size', async () => {
      const term = await createIsolatedTerminal({ cols: 100, rows: 30 });
      expect(term.cols).toBe(100);
      expect(term.rows).toBe(30);
    });

    test('creates terminal with custom options', async () => {
      const term = await createIsolatedTerminal({
        cols: 120,
        rows: 40,
        scrollback: 5000,
        fontSize: 14,
        fontFamily: 'Courier New',
      });
      expect(term.cols).toBe(120);
      expect(term.rows).toBe(40);
    });
  });

  describe('Lifecycle', () => {
    test('terminal is not open before open() is called', async () => {
      const term = await createIsolatedTerminal();
      expect(() => term.write('test')).toThrow('Terminal must be opened');
    });

    test('can be disposed without being opened', async () => {
      const term = await createIsolatedTerminal();
      expect(() => term.dispose()).not.toThrow();
    });

    test('cannot write after disposal', async () => {
      const term = await createIsolatedTerminal();
      term.open(container!);
      term.dispose();

      expect(() => term.write('test')).toThrow('Terminal has been disposed');
    });

    test('cannot open twice', async () => {
      const term = await createIsolatedTerminal();
      term.open(container!);

      // open() is synchronous and throws immediately
      expect(() => term.open(container!)).toThrow('already open');

      term.dispose();
    });

    test('cannot open after disposal', async () => {
      const term = await createIsolatedTerminal();
      term.dispose();

      // open() is synchronous and throws immediately
      expect(() => term.open(container!)).toThrow('has been disposed');
    });
  });

  describe('Properties', () => {
    test('exposes cols and rows', async () => {
      const term = await createIsolatedTerminal({ cols: 90, rows: 25 });
      expect(term.cols).toBe(90);
      expect(term.rows).toBe(25);
    });

    test('exposes element after open', async () => {
      const term = await createIsolatedTerminal();
      expect(term.element).toBeUndefined();

      term.open(container!);
      expect(term.element).toBe(container);

      term.dispose();
    });
  });

  describe('Events', () => {
    test('onData event exists', async () => {
      const term = await createIsolatedTerminal();
      expect(typeof term.onData).toBe('function');
    });

    test('onResize event exists', async () => {
      const term = await createIsolatedTerminal();
      expect(typeof term.onResize).toBe('function');
    });

    test('onBell event exists', async () => {
      const term = await createIsolatedTerminal();
      expect(typeof term.onBell).toBe('function');
    });

    test('onData can register listeners', async () => {
      const term = await createIsolatedTerminal();
      const disposable = term.onData((data) => {
        // Listener callback
      });
      expect(typeof disposable.dispose).toBe('function');
      disposable.dispose();
    });

    test('onResize fires when terminal is resized', async () => {
      const term = await createIsolatedTerminal({ cols: 80, rows: 24 });
      term.open(container!);

      let resizeEvent: { cols: number; rows: number } | null = null;
      term.onResize((e) => {
        resizeEvent = e;
      });

      term.resize(100, 30);

      expect(resizeEvent).not.toBeNull();
      expect(resizeEvent!.cols).toBe(100);
      expect(resizeEvent!.rows).toBe(30);

      term.dispose();
    });

    test('onBell fires on bell character', async () => {
      const term = await createIsolatedTerminal();
      term.open(container!);

      let bellFired = false;
      term.onBell(() => {
        bellFired = true;
      });

      term.write('\x07'); // Bell character

      // Give it a moment to process
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(bellFired).toBe(true);

      term.dispose();
    });
  });

  describe('Writing', () => {
    test('write() does not throw after open', async () => {
      const term = await createIsolatedTerminal();
      term.open(container!);

      expect(() => term.write('Hello, World!')).not.toThrow();

      term.dispose();
    });

    test('write() accepts string', async () => {
      const term = await createIsolatedTerminal();
      term.open(container!);

      expect(() => term.write('test string')).not.toThrow();

      term.dispose();
    });

    test('write() accepts Uint8Array', async () => {
      const term = await createIsolatedTerminal();
      term.open(container!);

      const data = new TextEncoder().encode('test');
      expect(() => term.write(data)).not.toThrow();

      term.dispose();
    });

    test('writeln() adds newline', async () => {
      const term = await createIsolatedTerminal();
      term.open(container!);

      expect(() => term.writeln('test line')).not.toThrow();

      term.dispose();
    });
  });

  describe('Resizing', () => {
    test('resize() updates dimensions', async () => {
      const term = await createIsolatedTerminal({ cols: 80, rows: 24 });
      term.open(container!);

      term.resize(100, 30);

      expect(term.cols).toBe(100);
      expect(term.rows).toBe(30);

      term.dispose();
    });

    test('resize() with same dimensions is no-op', async () => {
      const term = await createIsolatedTerminal({ cols: 80, rows: 24 });
      term.open(container!);

      let resizeCount = 0;
      term.onResize(() => resizeCount++);

      term.resize(80, 24); // Same size

      expect(resizeCount).toBe(0); // Should not fire event

      term.dispose();
    });

    test('resize() throws if not open', async () => {
      const term = await createIsolatedTerminal();
      expect(() => term.resize(100, 30)).toThrow('must be opened');
    });
  });

  describe('Control Methods', () => {
    test('clear() does not throw', async () => {
      const term = await createIsolatedTerminal();
      term.open(container!);

      expect(() => term.clear()).not.toThrow();

      term.dispose();
    });

    test('reset() does not throw', async () => {
      const term = await createIsolatedTerminal();
      term.open(container!);

      expect(() => term.reset()).not.toThrow();

      term.dispose();
    });

    test('focus() does not throw', async () => {
      const term = await createIsolatedTerminal();
      term.open(container!);

      expect(() => term.focus()).not.toThrow();

      term.dispose();
    });

    test('focus() before open does not throw', async () => {
      const term = await createIsolatedTerminal();
      expect(() => term.focus()).not.toThrow();
    });
  });

  describe('Addons', () => {
    test('loadAddon() accepts addon', async () => {
      const term = await createIsolatedTerminal();
      term.open(container!);

      const mockAddon = {
        activate: (terminal: any) => {
          // Addon activation
        },
        dispose: () => {
          // Cleanup
        },
      };

      expect(() => term.loadAddon(mockAddon)).not.toThrow();

      term.dispose();
    });

    test('loadAddon() calls activate', async () => {
      const term = await createIsolatedTerminal();
      term.open(container!);

      let activateCalled = false;
      const mockAddon = {
        activate: (terminal: any) => {
          activateCalled = true;
        },
        dispose: () => {},
      };

      term.loadAddon(mockAddon);

      expect(activateCalled).toBe(true);

      term.dispose();
    });

    test('dispose() calls addon dispose', async () => {
      const term = await createIsolatedTerminal();
      term.open(container!);

      let disposeCalled = false;
      const mockAddon = {
        activate: (terminal: any) => {},
        dispose: () => {
          disposeCalled = true;
        },
      };

      term.loadAddon(mockAddon);
      term.dispose();

      expect(disposeCalled).toBe(true);
    });
  });

  describe('Integration', () => {
    test('can write ANSI sequences', async () => {
      const term = await createIsolatedTerminal();
      term.open(container!);

      // Should not throw on ANSI escape sequences
      expect(() => term.write('\x1b[1;31mRed bold text\x1b[0m')).not.toThrow();
      expect(() => term.write('\x1b[32mGreen\x1b[0m')).not.toThrow();
      expect(() => term.write('\x1b[2J\x1b[H')).not.toThrow(); // Clear and home

      term.dispose();
    });

    test('can handle cursor movement sequences', async () => {
      const term = await createIsolatedTerminal();
      term.open(container!);

      expect(() => term.write('\x1b[5;10H')).not.toThrow(); // Move cursor
      expect(() => term.write('\x1b[2A')).not.toThrow(); // Move up 2
      expect(() => term.write('\x1b[3B')).not.toThrow(); // Move down 3

      term.dispose();
    });

    test('multiple write calls work', async () => {
      const term = await createIsolatedTerminal();
      term.open(container!);

      expect(() => {
        term.write('Line 1\r\n');
        term.write('Line 2\r\n');
        term.write('Line 3\r\n');
      }).not.toThrow();

      term.dispose();
    });
  });

  describe('Disposal', () => {
    test('dispose() can be called multiple times', async () => {
      const term = await createIsolatedTerminal();
      term.open(container!);

      term.dispose();
      expect(() => term.dispose()).not.toThrow();
    });

    test('dispose() cleans up canvas element', async () => {
      const term = await createIsolatedTerminal();
      term.open(container!);

      const initialChildCount = container.children.length;
      expect(initialChildCount).toBeGreaterThan(0);

      term.dispose();

      const finalChildCount = container.children.length;
      expect(finalChildCount).toBe(0);
    });
  });
});

describe('paste()', () => {
  let container: HTMLElement | null = null;

  beforeEach(async () => {
    if (typeof document !== 'undefined') {
      container = document.createElement('div');
      document.body.appendChild(container);
    }
  });

  afterEach(() => {
    if (container && container.parentNode) {
      container.parentNode.removeChild(container);
      container = null;
    }
  });

  describe('Basic functionality', () => {
    test('should fire onData event with pasted text', async () => {
      if (!container) return;
      const term = await createIsolatedTerminal({ cols: 80, rows: 24 });
      if (!container) return;
      term.open(container!);

      let receivedData = '';
      term.onData((data) => {
        receivedData = data;
      });

      term.paste('hello world');

      expect(receivedData).toBe('hello world');
      term.dispose();
    });

    test('should respect disableStdin option', async () => {
      const term = await createIsolatedTerminal({ cols: 80, rows: 24, disableStdin: true });
      // Using shared container from beforeEach
      if (!container) return;
      term.open(container!);

      let receivedData = '';
      term.onData((data) => {
        receivedData = data;
      });

      term.paste('hello world');

      expect(receivedData).toBe('');
      term.dispose();
    });

    test('should work before terminal is open', async () => {
      const term = await createIsolatedTerminal({ cols: 80, rows: 24 });
      expect(() => term.paste('test')).toThrow();
      term.dispose();
    });
  });
});

describe('blur()', () => {
  let container: HTMLElement | null = null;

  beforeEach(async () => {
    if (typeof document !== 'undefined') {
      container = document.createElement('div');
      document.body.appendChild(container);
    }
  });

  afterEach(() => {
    if (container && container.parentNode) {
      container.parentNode.removeChild(container);
      container = null;
    }
  });

  describe('Basic functionality', () => {
    test('should not throw when terminal is open', async () => {
      const term = await createIsolatedTerminal({ cols: 80, rows: 24 });
      // Using shared container from beforeEach
      if (!container) return;
      term.open(container!);

      expect(() => term.blur()).not.toThrow();
      term.dispose();
    });

    test('should not throw when terminal is closed', async () => {
      const term = await createIsolatedTerminal({ cols: 80, rows: 24 });
      expect(() => term.blur()).not.toThrow();
      term.dispose();
    });

    test('should call blur on element', async () => {
      const term = await createIsolatedTerminal({ cols: 80, rows: 24 });
      // Using shared container from beforeEach
      if (!container) return;
      term.open(container!);

      const blurSpy = { called: false };
      if (term.element) {
        const originalBlur = term.element.blur;
        term.element.blur = () => {
          blurSpy.called = true;
          originalBlur.call(term.element);
        };
      }

      term.blur();
      expect(blurSpy.called).toBe(true);
      term.dispose();
    });
  });
});

describe('input()', () => {
  let container: HTMLElement | null = null;

  beforeEach(async () => {
    if (typeof document !== 'undefined') {
      container = document.createElement('div');
      document.body.appendChild(container);
    }
  });

  afterEach(() => {
    if (container && container.parentNode) {
      container.parentNode.removeChild(container);
      container = null;
    }
  });

  describe('Basic functionality', () => {
    test('should write data to terminal', async () => {
      const term = await createIsolatedTerminal({ cols: 80, rows: 24 });
      // Using shared container from beforeEach
      if (!container) return;
      term.open(container!);

      term.input('test data');

      // Verify cursor moved (data was written)
      const cursor = term.wasmTerm!.getCursor();
      expect(cursor.x).toBeGreaterThan(0);
      term.dispose();
    });

    test('should fire onData when wasUserInput is true', async () => {
      const term = await createIsolatedTerminal({ cols: 80, rows: 24 });
      // Using shared container from beforeEach
      if (!container) return;
      term.open(container!);

      let receivedData = '';
      term.onData((data) => {
        receivedData = data;
      });

      term.input('user input', true);

      expect(receivedData).toBe('user input');
      term.dispose();
    });

    test('should not fire onData when wasUserInput is false', async () => {
      const term = await createIsolatedTerminal({ cols: 80, rows: 24 });
      // Using shared container from beforeEach
      if (!container) return;
      term.open(container!);

      let receivedData = '';
      term.onData((data) => {
        receivedData = data;
      });

      term.input('programmatic input', false);

      expect(receivedData).toBe('');
      term.dispose();
    });

    test('should respect disableStdin option', async () => {
      const term = await createIsolatedTerminal({ cols: 80, rows: 24, disableStdin: true });
      // Using shared container from beforeEach
      if (!container) return;
      term.open(container!);

      let receivedData = '';
      term.onData((data) => {
        receivedData = data;
      });

      term.input('test', true);

      expect(receivedData).toBe('');
      term.dispose();
    });
  });
});

describe('select()', () => {
  let container: HTMLElement | null = null;

  beforeEach(async () => {
    if (typeof document !== 'undefined') {
      container = document.createElement('div');
      document.body.appendChild(container);
    }
  });

  afterEach(() => {
    if (container && container.parentNode) {
      container.parentNode.removeChild(container);
      container = null;
    }
  });

  describe('Basic functionality', () => {
    test('should create selection', async () => {
      const term = await createIsolatedTerminal({ cols: 80, rows: 24 });
      // Using shared container from beforeEach
      if (!container) return;
      term.open(container!);

      term.select(0, 0, 10);

      expect(term.hasSelection()).toBe(true);
      term.dispose();
    });

    test('should handle selection wrapping to next line', async () => {
      const term = await createIsolatedTerminal({ cols: 80, rows: 24 });
      // Using shared container from beforeEach
      if (!container) return;
      term.open(container!);

      // Select 100 chars starting at column 0 (wraps to next line)
      term.select(0, 0, 100);

      const pos = term.getSelectionPosition();
      expect(pos).toBeTruthy();
      expect(pos!.start.y).toBe(0);
      expect(pos!.end.y).toBeGreaterThan(0); // Wrapped to next line
      term.dispose();
    });

    test('should fire selectionChange event', async () => {
      const term = await createIsolatedTerminal({ cols: 80, rows: 24 });
      // Using shared container from beforeEach
      if (!container) return;
      term.open(container!);

      let fired = false;
      term.onSelectionChange(() => {
        fired = true;
      });

      term.select(0, 0, 10);

      expect(fired).toBe(true);
      term.dispose();
    });

    test('should clear selection when clicking outside canvas', async () => {
      const term = await createIsolatedTerminal({ cols: 80, rows: 24 });
      // Using shared container from beforeEach
      if (!container) return;
      term.open(container!);

      // Create a selection
      term.select(0, 0, 10);
      expect(term.hasSelection()).toBe(true);

      // Simulate click outside the canvas (on document body)
      const clickEvent = new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        view: window,
      });
      document.body.dispatchEvent(clickEvent);

      // Selection should be cleared
      expect(term.hasSelection()).toBe(false);
      term.dispose();
    });
  });
});

describe('selectLines()', () => {
  let container: HTMLElement | null = null;

  beforeEach(async () => {
    if (typeof document !== 'undefined') {
      container = document.createElement('div');
      document.body.appendChild(container);
    }
  });

  afterEach(() => {
    if (container && container.parentNode) {
      container.parentNode.removeChild(container);
      container = null;
    }
  });

  describe('Basic functionality', () => {
    test('should select entire lines', async () => {
      const term = await createIsolatedTerminal({ cols: 80, rows: 24 });
      // Using shared container from beforeEach
      if (!container) return;
      term.open(container!);

      term.selectLines(0, 2);

      const pos = term.getSelectionPosition();
      expect(pos).toBeTruthy();
      expect(pos!.start.x).toBe(0);
      expect(pos!.start.y).toBe(0);
      expect(pos!.end.x).toBe(79); // Last column
      expect(pos!.end.y).toBe(2);
      term.dispose();
    });

    test('should handle reversed start/end', async () => {
      const term = await createIsolatedTerminal({ cols: 80, rows: 24 });
      // Using shared container from beforeEach
      if (!container) return;
      term.open(container!);

      term.selectLines(5, 2); // End before start

      const pos = term.getSelectionPosition();
      expect(pos).toBeTruthy();
      expect(pos!.start.y).toBe(2); // Should be swapped
      expect(pos!.end.y).toBe(5);
      term.dispose();
    });

    test('should fire selectionChange event', async () => {
      const term = await createIsolatedTerminal({ cols: 80, rows: 24 });
      // Using shared container from beforeEach
      if (!container) return;
      term.open(container!);

      let fired = false;
      term.onSelectionChange(() => {
        fired = true;
      });

      term.selectLines(0, 2);

      expect(fired).toBe(true);
      term.dispose();
    });
  });
});

describe('getSelectionPosition()', () => {
  let container: HTMLElement | null = null;

  beforeEach(async () => {
    if (typeof document !== 'undefined') {
      container = document.createElement('div');
      document.body.appendChild(container);
    }
  });

  afterEach(() => {
    if (container && container.parentNode) {
      container.parentNode.removeChild(container);
      container = null;
    }
  });

  describe('Basic functionality', () => {
    test('should return null when no selection', async () => {
      const term = await createIsolatedTerminal({ cols: 80, rows: 24 });
      // Using shared container from beforeEach
      if (!container) return;
      term.open(container!);

      const pos = term.getSelectionPosition();

      expect(pos).toBeUndefined();
      term.dispose();
    });

    test('should return correct position after select', async () => {
      const term = await createIsolatedTerminal({ cols: 80, rows: 24 });
      // Using shared container from beforeEach
      if (!container) return;
      term.open(container!);

      term.select(5, 3, 10);
      const pos = term.getSelectionPosition();

      expect(pos).toBeTruthy();
      expect(pos!.start.x).toBe(5);
      expect(pos!.start.y).toBe(3);
      term.dispose();
    });

    test('should return undefined after clearSelection', async () => {
      const term = await createIsolatedTerminal({ cols: 80, rows: 24 });
      // Using shared container from beforeEach
      if (!container) return;
      term.open(container!);

      term.select(0, 0, 10);
      term.clearSelection();
      const pos = term.getSelectionPosition();

      expect(pos).toBeUndefined();
      term.dispose();
    });
  });
});

describe('onKey event', () => {
  let container: HTMLElement | null = null;

  beforeEach(async () => {
    if (typeof document !== 'undefined') {
      container = document.createElement('div');
      document.body.appendChild(container);
    }
  });

  afterEach(() => {
    if (container && container.parentNode) {
      container.parentNode.removeChild(container);
      container = null;
    }
  });

  describe('Basic functionality', () => {
    test('should exist', async () => {
      const term = await createIsolatedTerminal({ cols: 80, rows: 24 });
      // Using shared container from beforeEach
      if (!container) return;
      term.open(container!);

      expect(term.onKey).toBeTruthy();
      expect(typeof term.onKey).toBe('function');
      term.dispose();
    });

    test('should fire on keyboard events', async () => {
      const term = await createIsolatedTerminal({ cols: 80, rows: 24 });
      // Using shared container from beforeEach
      if (!container) return;
      term.open(container!);

      let keyEvent: any = null;
      term.onKey((e) => {
        keyEvent = e;
      });

      // Simulate keyboard event
      const event = new KeyboardEvent('keydown', { key: 'a' });
      term.element?.dispatchEvent(event);

      // Note: This may not fire in test environment without proper focus
      // but the API should exist and be callable
      expect(keyEvent).toBeTruthy();
      term.dispose();
    });
  });
});

describe('onTitleChange event', () => {
  let container: HTMLElement | null = null;

  beforeEach(async () => {
    if (typeof document !== 'undefined') {
      container = document.createElement('div');
      document.body.appendChild(container);
    }
  });

  afterEach(() => {
    if (container && container.parentNode) {
      container.parentNode.removeChild(container);
      container = null;
    }
  });

  describe('Basic functionality', () => {
    test('should exist', async () => {
      const term = await createIsolatedTerminal({ cols: 80, rows: 24 });
      // Using shared container from beforeEach
      if (!container) return;
      term.open(container!);

      expect(term.onTitleChange).toBeTruthy();
      expect(typeof term.onTitleChange).toBe('function');
      term.dispose();
    });

    test('should fire when OSC 2 sequence is written', async () => {
      const term = await createIsolatedTerminal({ cols: 80, rows: 24 });
      // Using shared container from beforeEach
      if (!container) return;
      term.open(container!);

      let receivedTitle = '';
      term.onTitleChange((title) => {
        receivedTitle = title;
      });

      // Write OSC 2 sequence (set title)
      term.write('\x1b]2;Test Title\x07');

      expect(receivedTitle).toBe('Test Title');
      term.dispose();
    });

    test('should fire when OSC 0 sequence is written', async () => {
      const term = await createIsolatedTerminal({ cols: 80, rows: 24 });
      // Using shared container from beforeEach
      if (!container) return;
      term.open(container!);

      let receivedTitle = '';
      term.onTitleChange((title) => {
        receivedTitle = title;
      });

      // Write OSC 0 sequence (set icon and title)
      term.write('\x1b]0;Another Title\x07');

      expect(receivedTitle).toBe('Another Title');
      term.dispose();
    });

    test('should handle ST terminator', async () => {
      const term = await createIsolatedTerminal({ cols: 80, rows: 24 });
      // Using shared container from beforeEach
      if (!container) return;
      term.open(container!);

      let receivedTitle = '';
      term.onTitleChange((title) => {
        receivedTitle = title;
      });

      // Write OSC 2 with ST terminator (ESC \)
      term.write('\x1b]2;Title with ST\x1b\\');

      expect(receivedTitle).toBe('Title with ST');
      term.dispose();
    });
  });
});

describe('attachCustomKeyEventHandler()', () => {
  let container: HTMLElement | null = null;

  beforeEach(async () => {
    if (typeof document !== 'undefined') {
      container = document.createElement('div');
      document.body.appendChild(container);
    }
  });

  afterEach(() => {
    if (container && container.parentNode) {
      container.parentNode.removeChild(container);
      container = null;
    }
  });

  describe('Basic functionality', () => {
    test('should accept a custom handler', async () => {
      const term = await createIsolatedTerminal({ cols: 80, rows: 24 });
      // Using shared container from beforeEach
      if (!container) return;
      term.open(container!);

      const handler = (e: KeyboardEvent) => false;
      expect(() => term.attachCustomKeyEventHandler(handler)).not.toThrow();
      term.dispose();
    });

    test('should accept undefined to clear handler', async () => {
      const term = await createIsolatedTerminal({ cols: 80, rows: 24 });
      // Using shared container from beforeEach
      if (!container) return;
      term.open(container!);

      const handler = (e: KeyboardEvent) => false;
      expect(() => term.attachCustomKeyEventHandler(handler)).not.toThrow();
      term.dispose();
    });
  });
});

describe('Terminal Options', () => {
  let container: HTMLElement | null = null;

  beforeEach(async () => {
    if (typeof document !== 'undefined') {
      container = document.createElement('div');
      document.body.appendChild(container);
    }
  });

  afterEach(() => {
    if (container && container.parentNode) {
      container.parentNode.removeChild(container);
      container = null;
    }
  });

  describe('convertEol and disableStdin', () => {
    test('convertEol option should convert newlines', async () => {
      const term = await createIsolatedTerminal({ cols: 80, rows: 24, convertEol: true });
      // Using shared container from beforeEach
      if (!container) return;
      term.open(container!);

      term.write('line1\nline2');

      // Cursor should be at start of line (CR moved it back)
      const cursor = term.wasmTerm!.getCursor();
      expect(cursor.x).toBe(5); // After "line2"
      expect(cursor.y).toBeGreaterThan(0); // On next line
      term.dispose();
    });

    test('disableStdin should prevent paste', async () => {
      const term = await createIsolatedTerminal({ cols: 80, rows: 24, disableStdin: true });
      // Using shared container from beforeEach
      if (!container) return;
      term.open(container!);

      let received = false;
      term.onData(() => {
        received = true;
      });

      term.paste('test');

      expect(received).toBe(false);
      term.dispose();
    });

    test('disableStdin should prevent input with wasUserInput', async () => {
      const term = await createIsolatedTerminal({ cols: 80, rows: 24, disableStdin: true });
      // Using shared container from beforeEach
      if (!container) return;
      term.open(container!);

      let received = false;
      term.onData(() => {
        received = true;
      });

      term.input('test', true);

      expect(received).toBe(false);
      term.dispose();
    });
  });
});

describe('Buffer Access API', () => {
  let term: Terminal;
  let container: HTMLElement;

  beforeEach(async () => {
    term = await createIsolatedTerminal();
    if (typeof document !== 'undefined') {
      container = document.createElement('div');
      document.body.appendChild(container);
    }
  });

  afterEach(() => {
    term.dispose();
    if (container && container.parentNode) {
      container.parentNode.removeChild(container);
    }
  });

  test('isAlternateScreen() starts false', async () => {
    if (!container) throw new Error('DOM environment not available - check happydom setup');

    term.open(container!);
    expect(term.wasmTerm?.isAlternateScreen()).toBe(false);
  });

  test('isAlternateScreen() detects alternate screen mode', async () => {
    if (!container) throw new Error('DOM environment not available - check happydom setup');

    term.open(container!);

    // Enter alternate screen (DEC Private Mode 1049 - like vim does)
    term.write('\x1b[?1049h');
    expect(term.wasmTerm?.isAlternateScreen()).toBe(true);

    // Exit alternate screen
    term.write('\x1b[?1049l');
    expect(term.wasmTerm?.isAlternateScreen()).toBe(false);
  });

  test('alternate screen exit triggers full redraw (vim exit fix)', async () => {
    if (!container) throw new Error('DOM environment not available - check happydom setup');

    term.open(container!);

    // Write content to main screen
    term.write('Main screen content line 1\r\n');
    term.write('Main screen content line 2\r\n');

    // Clear dirty state after initial write
    term.wasmTerm?.clearDirty();

    // Verify we can read the main screen content
    const mainLine0 = term.wasmTerm?.getLine(0);
    expect(mainLine0).not.toBeNull();
    const mainContent = mainLine0!
      .map((c) => String.fromCodePoint(c.codepoint || 32))
      .join('')
      .trim();
    expect(mainContent).toBe('Main screen content line 1');

    // Enter alternate screen (like vim does)
    term.write('\x1b[?1049h');
    expect(term.wasmTerm?.isAlternateScreen()).toBe(true);

    // Write different content on alternate screen
    term.write('Alternate screen - vim content');

    // Clear dirty state
    term.wasmTerm?.clearDirty();

    // Exit alternate screen (like vim :q)
    term.write('\x1b[?1049l');
    expect(term.wasmTerm?.isAlternateScreen()).toBe(false);

    // The key fix: needsFullRedraw should return true after screen switch
    expect(term.wasmTerm?.needsFullRedraw()).toBe(true);

    // After the switch, update() should still return FULL (for subsequent calls before clearDirty)
    const dirtyState = term.wasmTerm?.update();
    expect(dirtyState).toBe(2); // DirtyState.FULL = 2

    // The main screen content should be restored
    const restoredLine0 = term.wasmTerm?.getLine(0);
    expect(restoredLine0).not.toBeNull();
    const restoredContent = restoredLine0!
      .map((c) => String.fromCodePoint(c.codepoint || 32))
      .join('')
      .trim();
    expect(restoredContent).toBe('Main screen content line 1');
  });

  test('dirty state is cleared after markClean() following screen switch', async () => {
    if (!container) throw new Error('DOM environment not available - check happydom setup');

    term.open(container!);

    // Enter and exit alternate screen
    term.write('\x1b[?1049h');
    term.write('\x1b[?1049l');

    // First call should indicate full redraw needed
    expect(term.wasmTerm?.needsFullRedraw()).toBe(true);

    // Clear the dirty state (simulating render completion)
    term.wasmTerm?.clearDirty();

    // Now needsFullRedraw should return false (no changes since last render)
    expect(term.wasmTerm?.needsFullRedraw()).toBe(false);
  });

  test('multiple screen switches are handled correctly', async () => {
    if (!container) throw new Error('DOM environment not available - check happydom setup');

    term.open(container!);
    term.write('Initial content\r\n');
    term.wasmTerm?.clearDirty();

    // Enter alternate screen
    term.write('\x1b[?1049h');
    expect(term.wasmTerm?.needsFullRedraw()).toBe(true);
    term.wasmTerm?.clearDirty();
    expect(term.wasmTerm?.needsFullRedraw()).toBe(false);

    // Exit alternate screen
    term.write('\x1b[?1049l');
    expect(term.wasmTerm?.needsFullRedraw()).toBe(true);
    term.wasmTerm?.clearDirty();
    expect(term.wasmTerm?.needsFullRedraw()).toBe(false);

    // Enter again
    term.write('\x1b[?1049h');
    expect(term.wasmTerm?.needsFullRedraw()).toBe(true);
    term.wasmTerm?.clearDirty();

    // Exit again
    term.write('\x1b[?1049l');
    expect(term.wasmTerm?.needsFullRedraw()).toBe(true);
  });

  test('viewport content is correct after alternate screen exit', async () => {
    if (!container) throw new Error('DOM environment not available - check happydom setup');

    term.open(container!);

    // Write distinct content to main screen
    term.write('MAIN_LINE_1\r\n');
    term.write('MAIN_LINE_2\r\n');
    term.write('MAIN_LINE_3\r\n');

    // Use getLine which calls update() first
    const mainLine0 = term.wasmTerm?.getLine(0);
    expect(mainLine0).not.toBeNull();

    const mainLine1 = mainLine0!
      .map((c) => String.fromCodePoint(c.codepoint || 32))
      .join('')
      .trim();
    expect(mainLine1).toBe('MAIN_LINE_1');

    // Clear dirty state to simulate render completion
    term.wasmTerm?.clearDirty();

    // Enter alternate screen
    term.write('\x1b[?1049h');
    expect(term.wasmTerm?.isAlternateScreen()).toBe(true);

    // Write different content to alternate screen
    term.write('ALT_LINE_1\r\n');
    term.write('ALT_LINE_2\r\n');

    // Skip checking alternate screen content - focus on the key issue:
    // Does main screen content get restored after exit?

    // Clear dirty state
    term.wasmTerm?.clearDirty();

    // Exit alternate screen (like vim :q)
    term.write('\x1b[?1049l');
    expect(term.wasmTerm?.isAlternateScreen()).toBe(false);

    // CRITICAL: needsFullRedraw must be true
    expect(term.wasmTerm?.needsFullRedraw()).toBe(true);

    // CRITICAL: getLine must return MAIN screen content, not alternate
    const restoredLine0 = term.wasmTerm?.getLine(0);
    expect(restoredLine0).not.toBeNull();

    const restoredLine1Content = restoredLine0!
      .map((c) => String.fromCodePoint(c.codepoint || 32))
      .join('')
      .trim();

    // This is the key assertion - content must be from main screen
    expect(restoredLine1Content).toBe('MAIN_LINE_1');

    // Also check second line to be thorough
    const restoredLine1 = term.wasmTerm?.getLine(1);
    const restoredLine2Content = restoredLine1!
      .map((c) => String.fromCodePoint(c.codepoint || 32))
      .join('')
      .trim();
    expect(restoredLine2Content).toBe('MAIN_LINE_2');
  });

  test('background colors are correctly restored after alternate screen exit', async () => {
    if (!container) throw new Error('DOM environment not available - check happydom setup');

    term.open(container!);

    // Write to main screen (default background = black)
    term.write('MAIN\r\n');
    term.wasmTerm?.update();
    term.wasmTerm?.markClean();

    // Enter alternate screen and fill with colored background (like vim does)
    term.write('\x1b[?1049h'); // Enter alt screen
    term.write('\x1b[H'); // Home
    term.write('\x1b[44m'); // Blue background (palette color 4)

    // Fill screen with spaces that have blue background
    for (let y = 0; y < term.rows; y++) {
      term.write(' '.repeat(term.cols));
      if (y < term.rows - 1) term.write('\r\n');
    }

    term.wasmTerm?.update();
    term.wasmTerm?.markClean();

    // Verify alternate screen has non-default background
    const altViewport = term.wasmTerm?.getViewport();
    expect(altViewport![0].bg_r).not.toBe(0); // Should be blue-ish

    // Exit alternate screen
    term.write('\x1b[?1049l');
    term.wasmTerm?.update();

    // CRITICAL: Background colors must be restored to main screen values (black)
    const restoredViewport = term.wasmTerm?.getViewport();
    const firstCell = restoredViewport![0];

    // Main screen cells should have default background (0, 0, 0 = black)
    expect(firstCell.bg_r).toBe(0);
    expect(firstCell.bg_g).toBe(0);
    expect(firstCell.bg_b).toBe(0);

    // Verify text is also restored
    expect(String.fromCodePoint(firstCell.codepoint)).toBe('M');
  });

  test('isRowWrapped() returns false for normal line breaks', async () => {
    if (!container) throw new Error('DOM environment not available - check happydom setup');

    term.open(container!);
    term.write('Line 1\r\nLine 2\r\n');

    expect(term.wasmTerm?.isRowWrapped(0)).toBe(false);
    expect(term.wasmTerm?.isRowWrapped(1)).toBe(false);
  });

  test('isRowWrapped() detects wrapped lines', async () => {
    if (typeof document === 'undefined')
      throw new Error('DOM environment not available - check happydom setup');

    // Create narrow terminal to force wrapping
    const narrowTerm = await createIsolatedTerminal({ cols: 20, rows: 10 });
    const narrowContainer = document.createElement('div');
    narrowTerm.open(narrowContainer);

    try {
      // Write text longer than terminal width (no newline)
      narrowTerm.write('This is a very long line that will definitely wrap');

      // First line should not be wrapped (start of line)
      expect(narrowTerm.wasmTerm?.isRowWrapped(0)).toBe(false);

      // Second line should be wrapped (continuation)
      expect(narrowTerm.wasmTerm?.isRowWrapped(1)).toBe(true);
    } finally {
      narrowTerm.dispose();
    }
  });

  test('isRowWrapped() handles edge cases', async () => {
    if (!container) throw new Error('DOM environment not available - check happydom setup');

    term.open(container!);

    // Row 0 can never be wrapped (nothing to wrap from)
    expect(term.wasmTerm?.isRowWrapped(0)).toBe(false);

    // Out of bounds returns false
    expect(term.wasmTerm?.isRowWrapped(-1)).toBe(false);
    expect(term.wasmTerm?.isRowWrapped(999)).toBe(false);
  });
});

describe('Terminal Config', () => {
  test('should pass scrollback option to WASM terminal', async () => {
    if (typeof document === 'undefined') return;

    // Create terminal with custom scrollback
    const term = await createIsolatedTerminal({ cols: 80, rows: 24, scrollback: 500 });
    const container = document.createElement('div');
    term.open(container);

    try {
      // Write enough lines to fill scrollback
      for (let i = 0; i < 600; i++) {
        term.write(`Line ${i}\r\n`);
      }

      // Scrollback should be limited based on the config
      const scrollbackLength = term.wasmTerm!.getScrollbackLength();
      // With 500 scrollback limit, we wrote 600 lines so scrollback should be capped
      // The actual value depends on ghostty's implementation but should be around 500
      expect(scrollbackLength).toBeLessThan(600);
      expect(scrollbackLength).toBeGreaterThan(450);
    } finally {
      term.dispose();
    }
  });

  test('should pass theme colors to WASM terminal', async () => {
    if (typeof document === 'undefined') return;

    // Create terminal with custom theme
    const term = await createIsolatedTerminal({
      cols: 80,
      rows: 24,
      theme: {
        foreground: '#00ff00', // Green
        background: '#000080', // Navy blue
      },
    });
    const container = document.createElement('div');
    term.open(container);

    try {
      // Get the default colors from render state
      const colors = term.wasmTerm!.getColors();

      // Verify foreground is green (0x00FF00)
      expect(colors.foreground.r).toBe(0);
      expect(colors.foreground.g).toBe(255);
      expect(colors.foreground.b).toBe(0);

      // Verify background is navy (0x000080)
      expect(colors.background.r).toBe(0);
      expect(colors.background.g).toBe(0);
      expect(colors.background.b).toBe(128);
    } finally {
      term.dispose();
    }
  });

  test('should pass palette colors to WASM terminal', async () => {
    if (typeof document === 'undefined') return;

    // Create terminal with custom red color in palette
    const term = await createIsolatedTerminal({
      cols: 80,
      rows: 24,
      theme: {
        red: '#ff0000', // Bright red for ANSI red
      },
    });
    const container = document.createElement('div');
    term.open(container);

    try {
      // Write red text using ANSI escape code
      term.write('\x1b[31mRed text\x1b[0m');

      // Get first cell - should have red foreground
      const line = term.wasmTerm!.getLine(0);
      const firstCell = line[0];

      // The foreground should be red (0xFF0000)
      expect(firstCell.fg_r).toBe(255);
      expect(firstCell.fg_g).toBe(0);
      expect(firstCell.fg_b).toBe(0);
    } finally {
      term.dispose();
    }
  });

  test('should use default config when no options provided', async () => {
    if (typeof document === 'undefined') return;

    // Create terminal with no config
    const term = await createIsolatedTerminal({ cols: 80, rows: 24 });
    const container = document.createElement('div');
    term.open(container);

    try {
      // Should still work and have reasonable defaults
      const colors = term.wasmTerm!.getColors();

      // Default colors should be set (light gray foreground, black background)
      expect(colors.foreground).toBeDefined();
      expect(colors.background).toBeDefined();
    } finally {
      term.dispose();
    }
  });
});

describe('Terminal Modes', () => {
  test('should detect bracketed paste mode', async () => {
    if (typeof document === 'undefined') return;
    const term = await createIsolatedTerminal({ cols: 80, rows: 24 });
    const container = document.createElement('div');
    term.open(container!);

    expect(term.hasBracketedPaste()).toBe(false);
    term.write('\x1b[?2004h');
    expect(term.hasBracketedPaste()).toBe(true);
    term.write('\x1b[?2004l');
    expect(term.hasBracketedPaste()).toBe(false);

    term.dispose();
  });

  test('paste() should use bracketed paste when enabled', async () => {
    if (typeof document === 'undefined') return;
    const term = await createIsolatedTerminal({ cols: 80, rows: 24 });
    const container = document.createElement('div');
    term.open(container!);

    let receivedData = '';
    term.onData((data) => {
      receivedData = data;
    });

    term.paste('test');
    expect(receivedData).toBe('test');

    term.write('\x1b[?2004h');
    term.paste('test2');
    expect(receivedData).toBe('\x1b[200~test2\x1b[201~');

    term.dispose();
  });

  test('should query arbitrary DEC modes', async () => {
    if (typeof document === 'undefined') return;
    const term = await createIsolatedTerminal({ cols: 80, rows: 24 });
    const container = document.createElement('div');
    term.open(container!);

    expect(term.getMode(25)).toBe(true); // Cursor visible
    term.write('\x1b[?25l');
    expect(term.getMode(25)).toBe(false);

    term.dispose();
  });

  test('should detect focus event mode', async () => {
    if (typeof document === 'undefined') return;
    const term = await createIsolatedTerminal({ cols: 80, rows: 24 });
    const container = document.createElement('div');
    term.open(container!);

    expect(term.hasFocusEvents()).toBe(false);
    term.write('\x1b[?1004h');
    expect(term.hasFocusEvents()).toBe(true);

    term.dispose();
  });

  test('should detect mouse tracking modes', async () => {
    if (typeof document === 'undefined') return;
    const term = await createIsolatedTerminal({ cols: 80, rows: 24 });
    const container = document.createElement('div');
    term.open(container!);

    expect(term.hasMouseTracking()).toBe(false);
    term.write('\x1b[?1000h');
    expect(term.hasMouseTracking()).toBe(true);

    term.dispose();
  });

  test('should query ANSI modes vs DEC modes', async () => {
    if (typeof document === 'undefined') return;
    const term = await createIsolatedTerminal({ cols: 80, rows: 24 });
    const container = document.createElement('div');
    term.open(container!);

    expect(term.getMode(4, true)).toBe(false); // Insert mode
    term.write('\x1b[4h');
    expect(term.getMode(4, true)).toBe(true);

    term.dispose();
  });

  test('should handle multiple modes set simultaneously', async () => {
    if (typeof document === 'undefined') return;
    const term = await createIsolatedTerminal({ cols: 80, rows: 24 });
    const container = document.createElement('div');
    term.open(container!);

    term.write('\x1b[?2004h\x1b[?1004h\x1b[?1000h');
    expect(term.hasBracketedPaste()).toBe(true);
    expect(term.hasFocusEvents()).toBe(true);
    expect(term.hasMouseTracking()).toBe(true);

    term.dispose();
  });

  test('getMode() throws when terminal not open', async () => {
    const term = await createIsolatedTerminal({ cols: 80, rows: 24 });
    expect(() => term.getMode(25)).toThrow();
  });

  test('hasBracketedPaste() throws when terminal not open', async () => {
    const term = await createIsolatedTerminal({ cols: 80, rows: 24 });
    expect(() => term.hasBracketedPaste()).toThrow();
  });

  test('alternate screen mode via getMode()', async () => {
    if (typeof document === 'undefined') return;
    const term = await createIsolatedTerminal({ cols: 80, rows: 24 });
    const container = document.createElement('div');
    term.open(container!);

    expect(term.getMode(1049)).toBe(false);
    term.write('\x1b[?1049h');
    expect(term.getMode(1049)).toBe(true);

    term.dispose();
  });
});

describe('Alternate Screen Rendering', () => {
  /**
   * Helper to get line content as a string
   */
  function getLineContent(term: Terminal, y: number): string {
    const line = term.wasmTerm?.getLine(y);
    if (!line) return '';
    return line
      .map((c) => String.fromCodePoint(c.codepoint || 32))
      .join('')
      .trimEnd();
  }

  /**
   * Helper to check if a line is empty (all spaces/null codepoints)
   */
  function isLineEmpty(term: Terminal, y: number): boolean {
    const line = term.wasmTerm?.getLine(y);
    if (!line) return true;
    return line.every((c) => c.codepoint === 0 || c.codepoint === 32);
  }

  /**
   * Helper to get line content directly from viewport
   */
  function getViewportLineContent(term: Terminal, y: number): string {
    const viewport = term.wasmTerm?.getViewport();
    if (!viewport) return '';
    const cols = term.cols;
    const start = y * cols;
    return viewport
      .slice(start, start + cols)
      .map((c) => String.fromCodePoint(c.codepoint || 32))
      .join('')
      .trimEnd();
  }

  test('BUG REPRO: getLine and getViewport should return same data after partial updates', async () => {
    const term = await createIsolatedTerminal({ cols: 80, rows: 24 });
    const container = document.createElement('div');
    term.open(container);

    // Enter alternate screen
    term.write('\x1b[?1049h');

    // Draw content in middle (like vim welcome)
    term.write('\x1b[12;30HWelcome to Vim!');
    term.write('\x1b[13;30HPress i to insert');

    // First render cycle
    term.wasmTerm?.update();
    term.wasmTerm?.clearDirty();

    // Verify initial state with BOTH methods
    const line11_initial_getLine = getLineContent(term, 11);
    const line11_initial_viewport = getViewportLineContent(term, 11);
    expect(line11_initial_getLine).toContain('Welcome to Vim!');
    expect(line11_initial_viewport).toContain('Welcome to Vim!');
    expect(line11_initial_getLine).toBe(line11_initial_viewport);

    // Now simulate typing at top (vim insert mode)
    // Just write to row 0, don't clear middle
    term.write('\x1b[1;1H'); // cursor to top
    term.write('typing here');

    // Render cycle
    term.wasmTerm?.update();
    term.wasmTerm?.clearDirty();

    // Check row 0 - should have new content
    const line0_getLine = getLineContent(term, 0);
    const line0_viewport = getViewportLineContent(term, 0);
    expect(line0_getLine).toBe('typing here');
    expect(line0_viewport).toBe('typing here');
    expect(line0_getLine).toBe(line0_viewport);

    // CRITICAL: Check row 11 - should STILL have welcome content
    // Both methods MUST return the same data
    const line11_getLine = getLineContent(term, 11);
    const line11_viewport = getViewportLineContent(term, 11);

    console.log('After typing at top:');
    console.log('  line11 via getLine:', JSON.stringify(line11_getLine));
    console.log('  line11 via viewport:', JSON.stringify(line11_viewport));

    expect(line11_getLine).toContain('Welcome to Vim!');
    expect(line11_viewport).toContain('Welcome to Vim!');
    expect(line11_getLine).toBe(line11_viewport);

    term.dispose();
  });

  test('BUG REPRO: cells should have correct codepoints after clearing', async () => {
    const term = await createIsolatedTerminal({ cols: 80, rows: 24 });
    const container = document.createElement('div');
    term.open(container);

    term.write('\x1b[?1049h');

    // Draw content in middle
    term.write('\x1b[12;30HWelcome!');

    // Verify it's there
    const line11 = term.wasmTerm?.getLine(11);
    const welcomeCell = line11?.[29]; // 0-indexed, so col 30 is index 29
    console.log('Welcome cell:', welcomeCell);
    expect(welcomeCell?.codepoint).toBe('W'.charCodeAt(0));

    // Clear dirty and "render"
    term.wasmTerm?.clearDirty();

    // Now clear the line using EL (Erase in Line)
    term.write('\x1b[12;1H\x1b[K'); // Move to row 12, clear entire line

    // Check the cell again - should be empty (codepoint 0 or 32)
    const line11After = term.wasmTerm?.getLine(11);
    const clearedCell = line11After?.[29];
    console.log('Cleared cell:', clearedCell);
    expect(clearedCell?.codepoint === 0 || clearedCell?.codepoint === 32).toBe(true);

    term.dispose();
  });

  test('BUG REPRO: multiple render cycles should not lose data', async () => {
    const term = await createIsolatedTerminal({ cols: 80, rows: 24 });
    const container = document.createElement('div');
    term.open(container);

    term.write('\x1b[?1049h');

    // Draw content across multiple rows
    term.write('\x1b[1;1HROW_0');
    term.write('\x1b[6;1HROW_5');
    term.write('\x1b[11;1HROW_10');
    term.write('\x1b[16;1HROW_15');
    term.write('\x1b[21;1HROW_20');

    // Simulate 10 render cycles with typing at top
    for (let i = 0; i < 10; i++) {
      term.wasmTerm?.update();
      term.wasmTerm?.clearDirty();

      // Type at top
      term.write(`\x1b[1;1H\x1b[KIteration ${i}`);
    }

    // Final render
    term.wasmTerm?.update();

    // Check ALL rows - each should have expected content
    const results: Record<number, { getLine: string; viewport: string }> = {};
    for (const row of [0, 5, 10, 15, 20]) {
      results[row] = {
        getLine: getLineContent(term, row),
        viewport: getViewportLineContent(term, row),
      };
      console.log(`Row ${row}:`, results[row]);
    }

    // Row 0 should have latest iteration
    expect(results[0].getLine).toBe('Iteration 9');
    expect(results[0].viewport).toBe('Iteration 9');

    // Other rows should be unchanged
    expect(results[5].getLine).toBe('ROW_5');
    expect(results[5].viewport).toBe('ROW_5');
    expect(results[10].getLine).toBe('ROW_10');
    expect(results[10].viewport).toBe('ROW_10');
    expect(results[15].getLine).toBe('ROW_15');
    expect(results[15].viewport).toBe('ROW_15');
    expect(results[20].getLine).toBe('ROW_20');
    expect(results[20].viewport).toBe('ROW_20');

    term.dispose();
  });

  test('can enter alternate screen and write content', async () => {
    const term = await createIsolatedTerminal({ cols: 80, rows: 24 });
    const container = document.createElement('div');
    term.open(container);

    term.write('\x1b[?1049h');
    expect(term.wasmTerm?.isAlternateScreen()).toBe(true);

    term.write('Hello World');
    expect(getLineContent(term, 0)).toBe('Hello World');

    term.dispose();
  });

  test('writing to line 0 should not affect content on line 10', async () => {
    const term = await createIsolatedTerminal({ cols: 80, rows: 24 });
    const container = document.createElement('div');
    term.open(container);

    term.write('\x1b[?1049h');
    term.write('\x1b[11;1HMIDDLE_CONTENT');
    expect(getLineContent(term, 10)).toBe('MIDDLE_CONTENT');
    expect(isLineEmpty(term, 0)).toBe(true);

    term.wasmTerm?.clearDirty();

    term.write('\x1b[1;1HTOP_CONTENT');
    expect(getLineContent(term, 0)).toBe('TOP_CONTENT');
    expect(getLineContent(term, 10)).toBe('MIDDLE_CONTENT');

    term.dispose();
  });

  test('erasing display should clear all content including middle', async () => {
    const term = await createIsolatedTerminal({ cols: 80, rows: 24 });
    const container = document.createElement('div');
    term.open(container);

    term.write('\x1b[?1049h');
    term.write('\x1b[11;1HMIDDLE_CONTENT');
    expect(getLineContent(term, 10)).toBe('MIDDLE_CONTENT');

    term.wasmTerm?.clearDirty();
    term.write('\x1b[2J');
    expect(isLineEmpty(term, 10)).toBe(true);

    term.dispose();
  });

  test('simulating vim-like behavior: welcome screen then typing', async () => {
    const term = await createIsolatedTerminal({ cols: 80, rows: 24 });
    const container = document.createElement('div');
    term.open(container);

    term.write('\x1b[?1049h');
    term.write('\x1b[2J');
    term.write('\x1b[12;30HWelcome to Vim!');
    term.write('\x1b[13;30HPress i to insert');

    expect(getLineContent(term, 11)).toContain('Welcome to Vim!');
    expect(getLineContent(term, 12)).toContain('Press i to insert');

    term.wasmTerm?.clearDirty();
    term.write('\x1b[1;1H\x1b[J');

    expect(isLineEmpty(term, 0)).toBe(true);
    expect(isLineEmpty(term, 11)).toBe(true);
    expect(isLineEmpty(term, 12)).toBe(true);

    term.dispose();
  });

  test('REGRESSION: middle content persists incorrectly after partial updates', async () => {
    const term = await createIsolatedTerminal({ cols: 80, rows: 24 });
    const container = document.createElement('div');
    term.open(container);

    term.write('\x1b[?1049h');
    term.write('\x1b[11;1HMIDDLE_LINE');

    term.wasmTerm?.update();
    expect(getLineContent(term, 10)).toBe('MIDDLE_LINE');
    term.wasmTerm?.clearDirty();

    for (let i = 0; i < 5; i++) {
      term.write('\x1b[1;1H\x1b[K');
      term.write(`Typing iteration ${i}`);
      term.wasmTerm?.update();
      term.wasmTerm?.clearDirty();
    }

    expect(getLineContent(term, 0)).toBe('Typing iteration 4');
    expect(getLineContent(term, 10)).toBe('MIDDLE_LINE');

    term.dispose();
  });

  test('getLine returns fresh data after each update', async () => {
    const term = await createIsolatedTerminal({ cols: 80, rows: 24 });
    const container = document.createElement('div');
    term.open(container);

    term.write('\x1b[?1049h');
    term.write('INITIAL');
    expect(getLineContent(term, 0)).toBe('INITIAL');

    term.write('\x1b[1;1HCHANGED');
    expect(getLineContent(term, 0)).toBe('CHANGED');

    term.dispose();
  });

  test('full viewport retrieval reflects actual terminal state', async () => {
    const term = await createIsolatedTerminal({ cols: 80, rows: 24 });
    const container = document.createElement('div');
    term.open(container);

    term.write('\x1b[?1049h');
    term.write('\x1b[2J');
    term.write('\x1b[1;1HLINE_0');
    term.write('\x1b[6;1HLINE_5');
    term.write('\x1b[11;1HLINE_10');
    term.write('\x1b[16;1HLINE_15');
    term.write('\x1b[21;1HLINE_20');

    expect(getLineContent(term, 0)).toBe('LINE_0');
    expect(getLineContent(term, 5)).toBe('LINE_5');
    expect(getLineContent(term, 10)).toBe('LINE_10');
    expect(getLineContent(term, 15)).toBe('LINE_15');
    expect(getLineContent(term, 20)).toBe('LINE_20');

    expect(isLineEmpty(term, 1)).toBe(true);
    expect(isLineEmpty(term, 7)).toBe(true);
    expect(isLineEmpty(term, 12)).toBe(true);

    term.dispose();
  });

  test('ED (Erase Display) sequences work correctly in alternate screen', async () => {
    const term = await createIsolatedTerminal({ cols: 80, rows: 24 });
    const container = document.createElement('div');
    term.open(container);

    term.write('\x1b[?1049h');
    for (let i = 0; i < 24; i++) {
      term.write(`\x1b[${i + 1};1HRow ${i.toString().padStart(2, '0')}`);
    }

    expect(getLineContent(term, 0)).toBe('Row 00');
    expect(getLineContent(term, 10)).toBe('Row 10');
    expect(getLineContent(term, 23)).toBe('Row 23');

    term.wasmTerm?.clearDirty();
    term.write('\x1b[2J');

    for (let i = 0; i < 24; i++) {
      expect(isLineEmpty(term, i)).toBe(true);
    }

    term.dispose();
  });

  test('ED 0 (erase from cursor to end) works correctly', async () => {
    const term = await createIsolatedTerminal({ cols: 80, rows: 24 });
    const container = document.createElement('div');
    term.open(container);

    term.write('\x1b[?1049h');
    for (let i = 0; i < 24; i++) {
      term.write(`\x1b[${i + 1};1HRow ${i.toString().padStart(2, '0')}`);
    }

    term.wasmTerm?.clearDirty();
    term.write('\x1b[11;1H\x1b[J');

    expect(getLineContent(term, 0)).toBe('Row 00');
    expect(getLineContent(term, 9)).toBe('Row 09');

    for (let i = 10; i < 24; i++) {
      expect(isLineEmpty(term, i)).toBe(true);
    }

    term.dispose();
  });

  test('multiple update/clearDirty cycles maintain correct state', async () => {
    const term = await createIsolatedTerminal({ cols: 80, rows: 24 });
    const container = document.createElement('div');
    term.open(container);

    term.write('\x1b[?1049h');

    term.write('\x1b[11;1HMIDDLE');
    term.wasmTerm?.update();
    expect(getLineContent(term, 10)).toBe('MIDDLE');
    term.wasmTerm?.clearDirty();

    term.write('\x1b[1;1HTOP');
    term.wasmTerm?.update();
    expect(getLineContent(term, 0)).toBe('TOP');
    expect(getLineContent(term, 10)).toBe('MIDDLE');
    term.wasmTerm?.clearDirty();

    term.write('\x1b[11;1H\x1b[K');
    term.wasmTerm?.update();
    expect(getLineContent(term, 0)).toBe('TOP');
    expect(isLineEmpty(term, 10)).toBe(true);
    term.wasmTerm?.clearDirty();

    term.wasmTerm?.update();
    expect(getLineContent(term, 0)).toBe('TOP');
    expect(isLineEmpty(term, 10)).toBe(true);

    term.dispose();
  });

  test('clearing a line marks it dirty', async () => {
    const term = await createIsolatedTerminal({ cols: 80, rows: 24 });
    const container = document.createElement('div');
    term.open(container);

    term.write('\x1b[?1049h');
    term.write('\x1b[11;1HMIDDLE');
    term.wasmTerm?.update();
    term.wasmTerm?.clearDirty();

    term.wasmTerm?.update();
    expect(term.wasmTerm?.isRowDirty(10)).toBeFalsy();

    term.write('\x1b[11;1H\x1b[K');
    term.wasmTerm?.update();
    expect(term.wasmTerm?.isRowDirty(10)).toBeTruthy();

    term.dispose();
  });

  test('ED sequence marks all affected rows dirty', async () => {
    const term = await createIsolatedTerminal({ cols: 80, rows: 24 });
    const container = document.createElement('div');
    term.open(container);

    term.write('\x1b[?1049h');
    for (let i = 0; i < 24; i++) {
      term.write(`\x1b[${i + 1};1HRow${i}`);
    }
    term.wasmTerm?.update();
    term.wasmTerm?.clearDirty();

    term.write('\x1b[6;1H\x1b[J');
    term.wasmTerm?.update();

    for (let i = 0; i < 5; i++) {
      expect(term.wasmTerm?.isRowDirty(i)).toBeFalsy();
    }
    for (let i = 5; i < 24; i++) {
      expect(term.wasmTerm?.isRowDirty(i)).toBeTruthy();
    }

    term.dispose();
  });

  test('getViewport and getLine return consistent data', async () => {
    const term = await createIsolatedTerminal({ cols: 80, rows: 24 });
    const container = document.createElement('div');
    term.open(container);

    term.write('\x1b[?1049h');
    term.write('\x1b[5;1HVIEWPORT_TEST');

    const lineContent = getLineContent(term, 4);
    const viewport = term.wasmTerm?.getViewport();
    const viewportLineContent = viewport
      ?.slice(4 * 80, 5 * 80)
      .map((c) => String.fromCodePoint(c.codepoint || 32))
      .join('')
      .trimEnd();

    expect(lineContent).toBe('VIEWPORT_TEST');
    expect(viewportLineContent).toBe('VIEWPORT_TEST');

    term.dispose();
  });
});

describe('Selection with Scrollback', () => {
  let container: HTMLElement | null = null;

  beforeEach(async () => {
    if (typeof document !== 'undefined') {
      container = document.createElement('div');
      document.body.appendChild(container);
    }
  });

  afterEach(() => {
    if (container && container.parentNode) {
      container.parentNode.removeChild(container);
      container = null;
    }
  });

  test('should select correct text from scrollback buffer', async () => {
    if (!container) return;

    const term = await createIsolatedTerminal({ cols: 80, rows: 24, scrollback: 1000 });
    term.open(container!);

    // Write 100 lines with unique identifiable content
    // Lines 0-99, where each line has "Line XXX: content"
    for (let i = 0; i < 100; i++) {
      const lineNum = i.toString().padStart(3, '0');
      term.write(`Line ${lineNum}: This is line number ${i}\r\n`);
    }

    // At this point, the screen buffer shows lines 77-99 (last 23 lines)
    // The scrollback buffer contains lines 0-76 (77 lines total)

    // Scroll up 50 lines to view older content
    term.scrollLines(-50);
    expect(term.getViewportY()).toBe(50);

    // The viewport now shows:
    // - Lines 0-23 of viewport = Lines 27-50 of the original output
    // (because scrollback length is 77, viewportY is 50)
    // Viewport line 0 = scrollback offset (77 - 50 + 0) = 27

    // Select from viewport row 5, col 0 to viewport row 7, col 20
    // This should select:
    // - Viewport row 5 = Line 032 (scrollback offset 77-50+5 = 32)
    // - Viewport row 6 = Line 033
    // - Viewport row 7 = Line 034 (first 20 chars)

    // Use the internal selection manager to set selection
    // Using helper to convert viewport rows to absolute coordinates
    setSelectionViewportRelative(term, 0, 5, 20, 7);

    const selMgr = (term as any).selectionManager;
    if (selMgr) {
      const selectedText = selMgr.getSelection();

      // Should contain "Line 032", "Line 033", and start of "Line 034"
      expect(selectedText).toContain('Line 032');
      expect(selectedText).toContain('Line 033');
      expect(selectedText).toContain('Line 034');

      // Should NOT contain current screen buffer content (lines 76-99)
      expect(selectedText).not.toContain('Line 076');
      expect(selectedText).not.toContain('Line 077');
      expect(selectedText).not.toContain('Line 078');
    }

    term.dispose();
  });

  test('should select correct text when selection spans scrollback and screen', async () => {
    if (!container) return;

    const term = await createIsolatedTerminal({ cols: 80, rows: 24, scrollback: 1000 });
    term.open(container!);

    // Write 100 lines
    for (let i = 0; i < 100; i++) {
      term.write(`Line ${i.toString().padStart(3, '0')}\r\n`);
    }

    // Scroll up 10 lines (less than screen height)
    term.scrollLines(-10);
    expect(term.getViewportY()).toBe(10);

    // Now viewport shows:
    // - Top 10 rows: scrollback content (lines 67-76)
    // - Bottom 14 rows: screen buffer content (lines 77-90)

    // Select from row 8 (in scrollback) to row 12 (in screen buffer)
    // Using helper to convert viewport rows to absolute coordinates
    setSelectionViewportRelative(term, 0, 8, 10, 12);

    const selMgr = (term as any).selectionManager;
    if (selMgr) {
      const selectedText = selMgr.getSelection();

      // Row 8 is in scrollback (scrollback offset: 77-10+8 = 75)
      // Row 9 is in scrollback (offset 76)
      // Rows 10-12 are in screen (screen rows 0-2, which are lines 77-79)
      expect(selectedText).toContain('Line 075');
      expect(selectedText).toContain('Line 076');
      expect(selectedText).toContain('Line 077');
      expect(selectedText).toContain('Line 078');
      expect(selectedText).toContain('Line 079');
    }

    term.dispose();
  });

  test('should select correct text when not scrolled (viewportY = 0)', async () => {
    if (!container) return;

    const term = await createIsolatedTerminal({ cols: 80, rows: 24, scrollback: 1000 });
    term.open(container!);

    // Write 100 lines
    for (let i = 0; i < 100; i++) {
      term.write(`Line ${i.toString().padStart(3, '0')}\r\n`);
    }

    // Don't scroll - should be at bottom (viewportY = 0)
    expect(term.getViewportY()).toBe(0);

    // Select from screen buffer (last visible lines)
    // Using helper to convert viewport rows to absolute coordinates
    setSelectionViewportRelative(term, 0, 0, 10, 2);

    const selMgr = (term as any).selectionManager;
    if (selMgr) {
      const selectedText = selMgr.getSelection();

      // Should get lines from screen buffer (lines 77-99 visible, we select first 3)
      expect(selectedText).toContain('Line 077');
      expect(selectedText).toContain('Line 078');
      expect(selectedText).toContain('Line 079');
    }

    term.dispose();
  });

  test('should select correct text with fractional viewportY (smooth scroll)', async () => {
    if (!container) return;

    const term = await createIsolatedTerminal({ cols: 80, rows: 24, scrollback: 1000 });
    term.open(container!);

    // Write 100 simple numbered lines
    for (let i = 0; i < 100; i++) {
      term.write(`Line ${i.toString().padStart(3, '0')}\r\n`);
    }

    // Simulate a fractional viewportY as produced by smooth scrolling.
    // We set it directly to avoid needing to call private smooth scroll APIs.
    (term as any).viewportY = 10.7;

    // Sanity check that getViewportY returns the raw value
    expect(term.getViewportY()).toBeCloseTo(10.7);

    // SelectionManager interprets viewport rows using Math.floor(viewportY),
    // matching CanvasRenderer. With viewportY=10.7, floor(viewportY)=10.
    // At this point scrollbackLength is 77 (lines 0-76) and the screen shows 77-99.
    // For viewport row 0:
    //   scrollbackOffset = 77 - 10 + 0 = 67  => "Line 067"
    // For viewport row 1:
    //   scrollbackOffset = 77 - 10 + 1 = 68  => "Line 068"

    // Using helper to convert viewport rows to absolute coordinates
    setSelectionViewportRelative(term, 0, 0, 10, 1);

    const selMgr = (term as any).selectionManager;
    if (selMgr) {
      const selectedText = selMgr.getSelection();

      expect(selectedText).toContain('Line 067');
      expect(selectedText).toContain('Line 068');
      // Ensure we didn't accidentally select from the wrong region (e.g. current screen)
      expect(selectedText).not.toContain('Line 077');
      expect(selectedText).not.toContain('Line 078');
    }

    term.dispose();
  });
  test('should handle selection in pure scrollback content', async () => {
    if (!container) return;

    const term = await createIsolatedTerminal({ cols: 80, rows: 24, scrollback: 1000 });
    term.open(container!);

    // Write 100 lines
    for (let i = 0; i < 100; i++) {
      term.write(`Scrollback line ${i.toString().padStart(3, '0')}\r\n`);
    }

    // Scroll to top to view oldest content
    term.scrollToTop();
    const viewportY = term.getViewportY();

    // Should be scrolled up significantly
    expect(viewportY).toBeGreaterThan(0);

    // Select first few lines (all in scrollback)
    // Using helper to convert viewport rows to absolute coordinates
    setSelectionViewportRelative(term, 0, 0, 20, 2);

    const selMgr = (term as any).selectionManager;
    if (selMgr) {
      const selectedText = selMgr.getSelection();

      // Should get the oldest scrollback lines
      expect(selectedText).toContain('Scrollback line 000');
      expect(selectedText).toContain('Scrollback line 001');
      expect(selectedText).toContain('Scrollback line 002');

      // Should NOT get recent lines
      expect(selectedText).not.toContain('line 099');
      expect(selectedText).not.toContain('line 098');
    }

    term.dispose();
  });
});
// ==========================================================================
// xterm.js Compatibility: Public Mutable Options
// ==========================================================================

describe('Public Mutable Options', () => {
  test('options are publicly accessible and reflect initial values', async () => {
    const term = await createIsolatedTerminal({ cols: 100, rows: 30, scrollback: 5000 });
    expect(term.options).toBeDefined();
    expect(term.options.cols).toBe(100);
    expect(term.options.rows).toBe(30);
    expect(term.options.scrollback).toBe(5000);
  });

  test('options can be mutated at runtime', async () => {
    const term = await createIsolatedTerminal();
    expect(term.options.disableStdin).toBe(false);
    term.options.disableStdin = true;
    expect(term.options.disableStdin).toBe(true);
    term.options.disableStdin = false;
    expect(term.options.disableStdin).toBe(false);
  });
});

// ==========================================================================
// xterm.js Compatibility: Options Proxy Triggering handleOptionChange
// ==========================================================================

describe('Options Proxy handleOptionChange', () => {
  let container: HTMLElement | null = null;

  beforeEach(async () => {
    if (typeof document !== 'undefined') {
      container = document.createElement('div');
      document.body.appendChild(container);
    }
  });

  afterEach(() => {
    if (container && container.parentNode) {
      container.parentNode.removeChild(container);
      container = null;
    }
  });

  test('changing cursorStyle updates renderer', async () => {
    if (!container) return;

    const term = await createIsolatedTerminal({ cursorStyle: 'block' });
    term.open(container);

    // Verify initial state
    expect(term.options.cursorStyle).toBe('block');

    // Change cursor style via options proxy
    term.options.cursorStyle = 'underline';

    // Verify option was updated
    expect(term.options.cursorStyle).toBe('underline');

    // Access renderer to verify it was updated
    // @ts-ignore - accessing private for test
    const renderer = term.renderer;
    expect(renderer).toBeDefined();
    // @ts-ignore - accessing private for test
    expect(renderer.cursorStyle).toBe('underline');

    term.dispose();
  });

  test('changing cursorBlink starts/stops blink timer', async () => {
    if (!container) return;

    const term = await createIsolatedTerminal({ cursorBlink: false });
    term.open(container);

    // Verify initial state
    expect(term.options.cursorBlink).toBe(false);

    // Enable cursor blink
    term.options.cursorBlink = true;
    expect(term.options.cursorBlink).toBe(true);

    // @ts-ignore - accessing private for test
    const renderer = term.renderer;
    // @ts-ignore - accessing private for test
    expect(renderer.cursorBlink).toBe(true);
    // @ts-ignore - accessing private for test
    expect(renderer.cursorBlinkInterval).toBeDefined();

    // Disable cursor blink
    term.options.cursorBlink = false;
    expect(term.options.cursorBlink).toBe(false);
    // @ts-ignore - accessing private for test
    expect(renderer.cursorBlink).toBe(false);

    term.dispose();
  });

  test('changing cols/rows triggers resize', async () => {
    if (!container) return;

    const term = await createIsolatedTerminal({ cols: 80, rows: 24 });
    term.open(container);

    let resizeEventFired = false;
    let resizedCols = 0;
    let resizedRows = 0;

    term.onResize(({ cols, rows }) => {
      resizeEventFired = true;
      resizedCols = cols;
      resizedRows = rows;
    });

    // Change dimensions via options proxy
    term.options.cols = 100;

    expect(resizeEventFired).toBe(true);
    expect(resizedCols).toBe(100);
    expect(term.cols).toBe(100);

    // Reset and test rows
    resizeEventFired = false;
    term.options.rows = 40;

    expect(resizeEventFired).toBe(true);
    expect(resizedRows).toBe(40);
    expect(term.rows).toBe(40);

    term.dispose();
  });

  test('handleOptionChange not called before terminal is open', async () => {
    const term = await createIsolatedTerminal({ cursorStyle: 'block' });

    // Changing options before open() should not throw
    // (handleOptionChange checks isOpen internally)
    expect(() => {
      term.options.cursorStyle = 'underline';
    }).not.toThrow();

    expect(term.options.cursorStyle).toBe('underline');
  });

  test('changing fontSize updates renderer and resizes canvas', async () => {
    if (!container) return;

    const term = await createIsolatedTerminal({ fontSize: 15, cols: 80, rows: 24 });
    term.open(container);

    // @ts-ignore - accessing private for test
    const renderer = term.renderer;

    // Verify initial font size
    // @ts-ignore - accessing private for test
    expect(renderer.fontSize).toBe(15);

    // Change font size
    term.options.fontSize = 20;

    // Verify option was updated
    expect(term.options.fontSize).toBe(20);

    // Verify renderer's internal fontSize was updated
    // @ts-ignore - accessing private for test
    expect(renderer.fontSize).toBe(20);

    // Verify metrics were recalculated (getMetrics returns a copy)
    const metrics = renderer.getMetrics();
    expect(metrics).toBeDefined();
    expect(metrics.width).toBeGreaterThan(0);
    expect(metrics.height).toBeGreaterThan(0);

    term.dispose();
  });

  test('changing fontFamily updates renderer', async () => {
    if (!container) return;

    const term = await createIsolatedTerminal({ fontFamily: 'monospace', cols: 80, rows: 24 });
    term.open(container);

    // @ts-ignore - accessing private for test
    const renderer = term.renderer;

    // Change font family
    term.options.fontFamily = 'Courier New, monospace';

    // Verify option was updated
    expect(term.options.fontFamily).toBe('Courier New, monospace');

    // Verify renderer was updated
    // @ts-ignore - accessing private for test
    expect(renderer.fontFamily).toBe('Courier New, monospace');

    term.dispose();
  });

  test('font change clears active selection', async () => {
    if (!container) return;

    const term = await createIsolatedTerminal({ fontSize: 15, cols: 80, rows: 24 });
    term.open(container);

    // Write some text and select it
    term.write('Hello World');
    term.select(0, 0, 5); // Select "Hello"
    expect(term.hasSelection()).toBe(true);

    // Change font size
    term.options.fontSize = 20;

    // Selection should be cleared (pixel positions changed)
    expect(term.hasSelection()).toBe(false);

    term.dispose();
  });

  test('font change maintains terminal dimensions (cols/rows)', async () => {
    if (!container) return;

    const term = await createIsolatedTerminal({ fontSize: 15, cols: 80, rows: 24 });
    term.open(container);

    const initialCols = term.cols;
    const initialRows = term.rows;

    // Change font size
    term.options.fontSize = 20;

    // Cols and rows should remain the same (canvas grows instead)
    expect(term.cols).toBe(initialCols);
    expect(term.rows).toBe(initialRows);

    term.dispose();
  });
});

// ==========================================================================
// xterm.js Compatibility: disableStdin Functionality
// ==========================================================================

describe('disableStdin', () => {
  let container: HTMLElement | null = null;

  beforeEach(async () => {
    if (typeof document !== 'undefined') {
      container = document.createElement('div');
      document.body.appendChild(container);
    }
  });

  afterEach(() => {
    if (container && container.parentNode) {
      container.parentNode.removeChild(container);
      container = null;
    }
  });

  test('blocks keyboard input from firing onData when enabled', async () => {
    if (!container) return;

    const term = await createIsolatedTerminal();
    term.open(container);

    const receivedData: string[] = [];
    term.onData((data) => receivedData.push(data));

    // Enable disableStdin
    term.options.disableStdin = true;

    // Simulate keyboard input by calling the internal method
    // Since we can't easily simulate keyboard events, we test via paste() and input()
    term.paste('should-not-appear');
    term.input('also-should-not-appear', true);

    expect(receivedData).toHaveLength(0);

    term.dispose();
  });

  test('allows input when disableStdin is false', async () => {
    if (!container) return;

    const term = await createIsolatedTerminal();
    term.open(container);

    const receivedData: string[] = [];
    term.onData((data) => receivedData.push(data));

    // disableStdin defaults to false
    expect(term.options.disableStdin).toBe(false);

    // Paste should work
    term.paste('hello');
    expect(receivedData.length).toBeGreaterThan(0);
    expect(receivedData.join('')).toContain('hello');

    term.dispose();
  });

  test('can toggle disableStdin at runtime', async () => {
    if (!container) return;

    const term = await createIsolatedTerminal();
    term.open(container);

    const receivedData: string[] = [];
    term.onData((data) => receivedData.push(data));

    // Start with input enabled
    term.paste('first');
    expect(receivedData.join('')).toContain('first');

    // Disable input
    term.options.disableStdin = true;
    const countBefore = receivedData.length;
    term.paste('blocked');
    expect(receivedData.length).toBe(countBefore); // No new data

    // Re-enable input
    term.options.disableStdin = false;
    term.paste('second');
    expect(receivedData.join('')).toContain('second');

    term.dispose();
  });

  test('blocks real keyboard events when disableStdin is true', async () => {
    if (!container) return;

    const term = await createIsolatedTerminal();
    term.open(container);

    const receivedData: string[] = [];
    term.onData((data) => receivedData.push(data));

    // Enable disableStdin
    term.options.disableStdin = true;

    // Simulate a real keyboard event on the container
    const keyEvent = new KeyboardEvent('keydown', {
      key: 'a',
      code: 'KeyA',
      keyCode: 65,
      bubbles: true,
      cancelable: true,
    });
    container.dispatchEvent(keyEvent);

    // No data should be received
    expect(receivedData).toHaveLength(0);

    term.dispose();
  });

  test('allows real keyboard events when disableStdin is false', async () => {
    if (!container) return;

    const term = await createIsolatedTerminal();
    term.open(container);

    const receivedData: string[] = [];
    term.onData((data) => receivedData.push(data));

    // disableStdin defaults to false
    expect(term.options.disableStdin).toBe(false);

    // Simulate a real keyboard event on the container
    const keyEvent = new KeyboardEvent('keydown', {
      key: 'a',
      code: 'KeyA',
      keyCode: 65,
      bubbles: true,
      cancelable: true,
    });
    container.dispatchEvent(keyEvent);

    // Data should be received
    expect(receivedData.length).toBeGreaterThan(0);

    term.dispose();
  });

  test('keyboard events blocked after toggling disableStdin on', async () => {
    if (!container) return;

    const term = await createIsolatedTerminal();
    term.open(container);

    const receivedData: string[] = [];
    term.onData((data) => receivedData.push(data));

    // First verify keyboard works
    const keyEvent1 = new KeyboardEvent('keydown', {
      key: 'a',
      code: 'KeyA',
      keyCode: 65,
      bubbles: true,
      cancelable: true,
    });
    container.dispatchEvent(keyEvent1);
    expect(receivedData.length).toBeGreaterThan(0);

    const countBefore = receivedData.length;

    // Now disable stdin
    term.options.disableStdin = true;

    // Send another key
    const keyEvent2 = new KeyboardEvent('keydown', {
      key: 'b',
      code: 'KeyB',
      keyCode: 66,
      bubbles: true,
      cancelable: true,
    });
    container.dispatchEvent(keyEvent2);

    // Count should not have increased
    expect(receivedData.length).toBe(countBefore);

    term.dispose();
  });
});

// ==========================================================================
// xterm.js Compatibility: unicode API
// ==========================================================================

describe('unicode API', () => {
  test('activeVersion returns 15.1', async () => {
    const term = await createIsolatedTerminal();
    expect(term.unicode.activeVersion).toBe('15.1');
  });

  test('unicode object is readonly', async () => {
    const term = await createIsolatedTerminal();
    // The unicode property should be accessible
    expect(term.unicode).toBeDefined();
    expect(typeof term.unicode.activeVersion).toBe('string');
  });
});

// ==========================================================================
// Grapheme Cluster Support (Unicode complex scripts)
// ==========================================================================

describe('Grapheme Cluster Support', () => {
  let container: HTMLElement | null = null;

  beforeEach(async () => {
    if (typeof document !== 'undefined') {
      container = document.createElement('div');
      document.body.appendChild(container);
    }
  });

  afterEach(() => {
    if (container && container.parentNode) {
      container.parentNode.removeChild(container);
      container = null;
    }
  });

  test('cell grapheme_len is 0 for simple ASCII characters', async () => {
    const term = await createIsolatedTerminal();
    term.open(container!);
    term.write('Hello');

    // Get the viewport and check the first cell
    const viewport = term.wasmTerm!.getViewport();
    expect(viewport[0].codepoint).toBe(0x48); // 'H'
    expect(viewport[0].grapheme_len).toBe(0);

    term.dispose();
  });

  test('getGraphemeString returns simple characters correctly', async () => {
    const term = await createIsolatedTerminal();
    term.open(container!);
    term.write('Test');

    // Test basic ASCII
    const grapheme = term.wasmTerm!.getGraphemeString(0, 0);
    expect(grapheme).toBe('T');

    term.dispose();
  });

  test('getGrapheme returns null for invalid coordinates', async () => {
    const term = await createIsolatedTerminal();
    term.open(container!);
    term.write('Test');

    // Test out of bounds
    const result = term.wasmTerm!.getGrapheme(100, 100);
    expect(result).toBeNull();

    term.dispose();
  });

  test('getGrapheme returns array of codepoints', async () => {
    const term = await createIsolatedTerminal();
    term.open(container!);
    term.write('A');

    const codepoints = term.wasmTerm!.getGrapheme(0, 0);
    expect(codepoints).not.toBeNull();
    expect(codepoints!.length).toBeGreaterThanOrEqual(1);
    expect(codepoints![0]).toBe(0x41); // 'A'

    term.dispose();
  });

  test('grapheme cluster mode 2027 is enabled by default', async () => {
    const term = await createIsolatedTerminal();
    term.open(container!);

    // Mode 2027 should be enabled by default for proper Unicode handling
    // This is a DEC private mode, not ANSI
    const graphemeClusterEnabled = term.wasmTerm!.getMode(2027, false);
    expect(graphemeClusterEnabled).toBe(true);

    term.dispose();
  });
});

// ==========================================================================
// xterm.js Compatibility: Write Behavior
// ==========================================================================

describe('Write Behavior', () => {
  let container: HTMLElement | null = null;

  beforeEach(async () => {
    if (typeof document !== 'undefined') {
      container = document.createElement('div');
      document.body.appendChild(container);
    }
  });

  afterEach(() => {
    if (container && container.parentNode) {
      container.parentNode.removeChild(container);
      container = null;
    }
  });

  test('writes are processed immediately after open', async () => {
    if (!container) return;

    const term = await createIsolatedTerminal();
    term.open(container);

    term.write('Line1\r\n');
    term.write('Line2\r\n');
    term.write('Line3\r\n');

    const line0 = term.buffer.active.getLine(0)?.translateToString().trim();
    const line1 = term.buffer.active.getLine(1)?.translateToString().trim();
    const line2 = term.buffer.active.getLine(2)?.translateToString().trim();

    expect(line0).toBe('Line1');
    expect(line1).toBe('Line2');
    expect(line2).toBe('Line3');

    term.dispose();
  });

  test('write callbacks are called after processing', async () => {
    if (!container) return;

    const term = await createIsolatedTerminal();
    term.open(container);

    const callbackOrder: number[] = [];

    term.write('First', () => callbackOrder.push(1));
    term.write('Second', () => callbackOrder.push(2));
    term.write('Third', () => callbackOrder.push(3));

    // Give callbacks time to fire (they use requestAnimationFrame)
    await new Promise((r) => setTimeout(r, 50));

    expect(callbackOrder).toEqual([1, 2, 3]);

    term.dispose();
  });
});

// ==========================================================================
// xterm.js Compatibility: Synchronous open()
// ==========================================================================

describe('Synchronous open()', () => {
  let container: HTMLElement | null = null;

  beforeEach(async () => {
    if (typeof document !== 'undefined') {
      container = document.createElement('div');
      document.body.appendChild(container);
    }
  });

  afterEach(() => {
    if (container && container.parentNode) {
      container.parentNode.removeChild(container);
      container = null;
    }
  });

  test('open() returns void (synchronous)', async () => {
    if (!container) return;

    const term = await createIsolatedTerminal();
    const result = term.open(container);

    expect(result).toBeUndefined();

    term.dispose();
  });

  test('element is set after open', async () => {
    if (!container) return;

    const term = await createIsolatedTerminal();
    term.open(container);

    expect(term.element).toBe(container);

    term.dispose();
  });

  test('cols and rows are available after open', async () => {
    if (!container) return;

    const term = await createIsolatedTerminal({ cols: 100, rows: 50 });
    term.open(container);

    expect(term.cols).toBe(100);
    expect(term.rows).toBe(50);

    term.dispose();
  });

  test('wasmTerm is available after open', async () => {
    if (!container) return;

    const term = await createIsolatedTerminal();
    term.open(container);

    expect(term.wasmTerm).toBeDefined();

    term.dispose();
  });

  test('resize works after open', async () => {
    if (!container) return;

    const term = await createIsolatedTerminal({ cols: 80, rows: 24 });
    term.open(container);

    term.resize(120, 40);

    expect(term.cols).toBe(120);
    expect(term.rows).toBe(40);

    term.dispose();
  });
});
