/**
 * Unit tests for InputHandler
 */

import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { Ghostty } from './ghostty';
import { InputHandler } from './input-handler';
import { Key, KeyAction, Mods } from './types';

// Mock DOM types for testing
interface MockKeyboardEvent {
  code: string;
  key: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
  repeat: boolean;
  preventDefault: () => void;
  stopPropagation: () => void;
}

interface MockClipboardEvent {
  type: string;
  clipboardData: {
    getData: (format: string) => string;
    setData: (format: string, data: string) => void;
  } | null;
  preventDefault: () => void;
  stopPropagation: () => void;
}
interface MockInputEvent {
  type: string;
  inputType: string;
  data: string | null;
  isComposing?: boolean;
  preventDefault: () => void;
  stopPropagation: () => void;
}

interface MockHTMLElement {
  addEventListener: (event: string, handler: (e: any) => void) => void;
  removeEventListener: (event: string, handler: (e: any) => void) => void;
  childNodes: Node[];
  removeChild: (node: Node) => Node;
  appendChild: (node: Node) => Node;
}

// Helper to create mock keyboard event
function createKeyEvent(
  code: string,
  key: string,
  modifiers: { ctrl?: boolean; alt?: boolean; shift?: boolean; meta?: boolean } = {}
): MockKeyboardEvent {
  return {
    code,
    key,
    ctrlKey: modifiers.ctrl ?? false,
    altKey: modifiers.alt ?? false,
    shiftKey: modifiers.shift ?? false,
    metaKey: modifiers.meta ?? false,
    repeat: false,
    preventDefault: mock(() => {}),
    stopPropagation: mock(() => {}),
  };
}

// Helper to create mock clipboard event
function createClipboardEvent(text: string | null): MockClipboardEvent {
  const data = new Map<string, string>();
  if (text !== null) {
    data.set('text/plain', text);
  }

  return {
    type: 'paste',
    clipboardData:
      text !== null
        ? {
            getData: (format: string) => data.get(format) || '',
            setData: (format: string, value: string) => {
              data.set(format, value);
            },
          }
        : null,
    preventDefault: mock(() => {}),
    stopPropagation: mock(() => {}),
  };
}

// Helper to create mock beforeinput event
function createBeforeInputEvent(inputType: string, data: string | null): MockInputEvent {
  return {
    type: 'beforeinput',
    inputType,
    data,
    isComposing: false,
    preventDefault: mock(() => {}),
    stopPropagation: mock(() => {}),
  };
}
interface MockCompositionEvent {
  type: string;
  data: string | null;
  preventDefault: () => void;
  stopPropagation: () => void;
}

// Helper to create mock composition event
function createCompositionEvent(
  type: 'compositionstart' | 'compositionupdate' | 'compositionend',
  data: string | null
): MockCompositionEvent {
  return {
    type,
    data,
    preventDefault: mock(() => {}),
    stopPropagation: mock(() => {}),
  };
}
// Helper to create mock container
function createMockContainer(): MockHTMLElement & {
  _listeners: Map<string, ((e: any) => void)[]>;
  dispatchEvent: (event: any) => void;
} {
  const listeners = new Map<string, ((e: any) => void)[]>();

  return {
    _listeners: listeners,
    addEventListener(event: string, handler: (e: any) => void) {
      if (!listeners.has(event)) {
        listeners.set(event, []);
      }
      listeners.get(event)!.push(handler);
    },
    removeEventListener(event: string, handler: (e: any) => void) {
      const handlers = listeners.get(event);
      if (handlers) {
        const index = handlers.indexOf(handler);
        if (index >= 0) {
          handlers.splice(index, 1);
        }
      }
    },
    dispatchEvent(event: any) {
      const handlers = listeners.get(event.type) || [];
      for (const handler of handlers) {
        handler(event);
      }
    },
    // Mock childNodes and removeChild for text node cleanup test
    childNodes: [] as Node[],
    removeChild(node: Node) {
      const index = this.childNodes.indexOf(node);
      if (index >= 0) {
        this.childNodes.splice(index, 1);
      }
      return node;
    },
    appendChild(node: Node) {
      this.childNodes.push(node);
      return node;
    },
  };
}

// Helper to simulate key event
function simulateKey(
  container: ReturnType<typeof createMockContainer>,
  event: MockKeyboardEvent
): void {
  const handlers = container._listeners.get('keydown') || [];
  for (const handler of handlers) {
    handler(event);
  }
}

describe('InputHandler', () => {
  let ghostty: Ghostty;
  let container: ReturnType<typeof createMockContainer>;
  let dataReceived: string[];
  let bellCalled: boolean;

  beforeEach(async () => {
    // Create a fresh Ghostty WASM instance for complete test isolation
    ghostty = await Ghostty.load();

    // Create mock container for each test
    container = createMockContainer();

    // Reset data tracking
    dataReceived = [];
    bellCalled = false;
  });

  describe('Constructor and Lifecycle', () => {
    test('creates handler and attaches listeners', () => {
      const handler = new InputHandler(
        ghostty,
        container as any,
        (data) => dataReceived.push(data),
        () => {
          bellCalled = true;
        }
      );

      expect(handler.isActive()).toBe(true);
      expect(container._listeners.has('keydown')).toBe(true);
      expect(container._listeners.get('keydown')!.length).toBe(1);
    });

    test('dispose removes listeners and marks inactive', () => {
      const handler = new InputHandler(
        ghostty,
        container as any,
        (data) => dataReceived.push(data),
        () => {
          bellCalled = true;
        }
      );

      handler.dispose();

      expect(handler.isActive()).toBe(false);
      expect(container._listeners.get('keydown')!.length).toBe(0);
    });

    test('dispose is idempotent', () => {
      const handler = new InputHandler(
        ghostty,
        container as any,
        (data) => dataReceived.push(data),
        () => {
          bellCalled = true;
        }
      );

      handler.dispose();
      handler.dispose(); // Second call should not throw

      expect(handler.isActive()).toBe(false);
    });
  });

  describe('Printable Characters', () => {
    test('encodes lowercase letters', () => {
      const handler = new InputHandler(
        ghostty,
        container as any,
        (data) => dataReceived.push(data),
        () => {
          bellCalled = true;
        }
      );

      simulateKey(container, createKeyEvent('KeyA', 'a'));
      expect(dataReceived).toEqual(['a']);

      simulateKey(container, createKeyEvent('KeyZ', 'z'));
      expect(dataReceived).toEqual(['a', 'z']);
    });

    test('encodes uppercase letters (with shift)', () => {
      const handler = new InputHandler(
        ghostty,
        container as any,
        (data) => dataReceived.push(data),
        () => {
          bellCalled = true;
        }
      );

      simulateKey(container, createKeyEvent('KeyA', 'A', { shift: true }));
      expect(dataReceived).toEqual(['A']);
    });

    test('encodes digits', () => {
      const handler = new InputHandler(
        ghostty,
        container as any,
        (data) => dataReceived.push(data),
        () => {
          bellCalled = true;
        }
      );

      simulateKey(container, createKeyEvent('Digit0', '0'));
      simulateKey(container, createKeyEvent('Digit5', '5'));
      simulateKey(container, createKeyEvent('Digit9', '9'));

      expect(dataReceived).toEqual(['0', '5', '9']);
    });

    test('encodes punctuation', () => {
      const handler = new InputHandler(
        ghostty,
        container as any,
        (data) => dataReceived.push(data),
        () => {
          bellCalled = true;
        }
      );

      simulateKey(container, createKeyEvent('Comma', ','));
      simulateKey(container, createKeyEvent('Period', '.'));
      simulateKey(container, createKeyEvent('Slash', '/'));

      expect(dataReceived).toEqual([',', '.', '/']);
    });

    test('encodes space', () => {
      const handler = new InputHandler(
        ghostty,
        container as any,
        (data) => dataReceived.push(data),
        () => {
          bellCalled = true;
        }
      );

      simulateKey(container, createKeyEvent('Space', ' '));
      expect(dataReceived).toEqual([' ']);
    });
  });

  describe('IME Composition', () => {
    test('handles composition sequence', () => {
      const handler = new InputHandler(
        ghostty,
        container as any,
        (data) => dataReceived.push(data),
        () => {
          bellCalled = true;
        }
      );

      // Start composition
      const startEvent = createCompositionEvent('compositionstart', '');
      container.dispatchEvent(startEvent);

      // Update composition (typing)
      const updateEvent1 = createCompositionEvent('compositionupdate', 'n');
      container.dispatchEvent(updateEvent1);

      // Keydown events during composition should be ignored
      const keyEvent1 = createKeyEvent('KeyN', 'n');
      Object.defineProperty(keyEvent1, 'isComposing', { value: true });
      simulateKey(container, keyEvent1);

      // Update composition (more typing)
      const updateEvent2 = createCompositionEvent('compositionupdate', 'ni');
      container.dispatchEvent(updateEvent2);

      // End composition (commit)
      const endEvent = createCompositionEvent('compositionend', '你好');
      container.dispatchEvent(endEvent);

      // Should only receive the final committed text
      expect(dataReceived).toEqual(['你好']);
    });

    test('ignores keydown during composition', () => {
      const handler = new InputHandler(
        ghostty,
        container as any,
        (data) => dataReceived.push(data),
        () => {
          bellCalled = true;
        }
      );

      // Start composition
      container.dispatchEvent(createCompositionEvent('compositionstart', ''));

      // Simulate keydown with isComposing=true
      const keyEvent = createKeyEvent('KeyA', 'a');
      Object.defineProperty(keyEvent, 'isComposing', { value: true });
      simulateKey(container, keyEvent);

      // Simulate keydown with keyCode 229
      const keyEvent229 = createKeyEvent('KeyB', 'b');
      Object.defineProperty(keyEvent229, 'keyCode', { value: 229 });
      simulateKey(container, keyEvent229);

      // Should not receive any data
      expect(dataReceived.length).toBe(0);

      // End composition
      container.dispatchEvent(createCompositionEvent('compositionend', 'a'));
      expect(dataReceived).toEqual(['a']);
    });

    test('cleans up text nodes in container after composition', () => {
      const handler = new InputHandler(
        ghostty,
        container as any,
        (data) => dataReceived.push(data),
        () => {
          bellCalled = true;
        }
      );

      // Simulate browser inserting text node during composition
      const textNode = { nodeType: 3, textContent: '你好' } as Node;
      container.appendChild(textNode);

      // Also add a non-text node (e.g. canvas) to ensure it's not removed
      const elementNode = { nodeType: 1, nodeName: 'CANVAS' } as Node;
      container.appendChild(elementNode);

      expect(container.childNodes.length).toBe(2);

      // End composition
      const endEvent = createCompositionEvent('compositionend', '你好');
      container.dispatchEvent(endEvent);

      // Should have removed the text node but kept the element node
      expect(container.childNodes.length).toBe(1);
      expect(container.childNodes[0]).toBe(elementNode);
      expect(dataReceived).toEqual(['你好']);
    });

    test('avoids duplicate commit when compositionend fires before beforeinput', () => {
      const inputElement = createMockContainer();
      const handler = new InputHandler(
        ghostty,
        container as any,
        (data) => dataReceived.push(data),
        () => {
          bellCalled = true;
        },
        undefined,
        undefined,
        undefined,
        undefined,
        inputElement as any
      );

      container.dispatchEvent(createCompositionEvent('compositionend', '你好'));
      inputElement.dispatchEvent(createBeforeInputEvent('insertText', '你好'));

      expect(dataReceived).toEqual(['你好']);
    });

    test('avoids duplicate commit when beforeinput fires before compositionend', () => {
      const inputElement = createMockContainer();
      const handler = new InputHandler(
        ghostty,
        container as any,
        (data) => dataReceived.push(data),
        () => {
          bellCalled = true;
        },
        undefined,
        undefined,
        undefined,
        undefined,
        inputElement as any
      );

      inputElement.dispatchEvent(createBeforeInputEvent('insertText', '你好'));
      container.dispatchEvent(createCompositionEvent('compositionend', '你好'));

      expect(dataReceived).toEqual(['你好']);
    });
  });

  describe('Control Characters', () => {
    test('encodes Ctrl+A', () => {
      const handler = new InputHandler(
        ghostty,
        container as any,
        (data) => dataReceived.push(data),
        () => {
          bellCalled = true;
        }
      );

      simulateKey(container, createKeyEvent('KeyA', 'a', { ctrl: true }));

      expect(dataReceived.length).toBe(1);
      // Ctrl+A should produce 0x01
      expect(dataReceived[0].charCodeAt(0)).toBe(0x01);
    });

    test('encodes Ctrl+C', () => {
      const handler = new InputHandler(
        ghostty,
        container as any,
        (data) => dataReceived.push(data),
        () => {
          bellCalled = true;
        }
      );

      simulateKey(container, createKeyEvent('KeyC', 'c', { ctrl: true }));

      expect(dataReceived.length).toBe(1);
      // Ctrl+C should produce 0x03
      expect(dataReceived[0].charCodeAt(0)).toBe(0x03);
    });

    test('encodes Ctrl+D', () => {
      const handler = new InputHandler(
        ghostty,
        container as any,
        (data) => dataReceived.push(data),
        () => {
          bellCalled = true;
        }
      );

      simulateKey(container, createKeyEvent('KeyD', 'd', { ctrl: true }));

      expect(dataReceived.length).toBe(1);
      // Ctrl+D should produce 0x04
      expect(dataReceived[0].charCodeAt(0)).toBe(0x04);
    });

    test('encodes Ctrl+Z', () => {
      const handler = new InputHandler(
        ghostty,
        container as any,
        (data) => dataReceived.push(data),
        () => {
          bellCalled = true;
        }
      );

      simulateKey(container, createKeyEvent('KeyZ', 'z', { ctrl: true }));

      expect(dataReceived.length).toBe(1);
      // Ctrl+Z should produce 0x1A (26)
      expect(dataReceived[0].charCodeAt(0)).toBe(0x1a);
    });

    test('Cmd+C allows copy (no data sent)', () => {
      const handler = new InputHandler(
        ghostty,
        container as any,
        (data) => dataReceived.push(data),
        () => {
          bellCalled = true;
        }
      );

      simulateKey(container, createKeyEvent('KeyC', 'c', { meta: true }));

      // Cmd+C should NOT send data - it should allow copy operation
      // SelectionManager handles the actual copying
      expect(dataReceived.length).toBe(0);
    });
  });

  describe('Special Keys', () => {
    test('encodes Enter', () => {
      const handler = new InputHandler(
        ghostty,
        container as any,
        (data) => dataReceived.push(data),
        () => {
          bellCalled = true;
        }
      );

      simulateKey(container, createKeyEvent('Enter', 'Enter'));

      expect(dataReceived.length).toBe(1);
      // Enter should produce \r (0x0D)
      expect(dataReceived[0]).toBe('\r');
    });

    test('encodes Tab', () => {
      const handler = new InputHandler(
        ghostty,
        container as any,
        (data) => dataReceived.push(data),
        () => {
          bellCalled = true;
        }
      );

      simulateKey(container, createKeyEvent('Tab', 'Tab'));

      expect(dataReceived.length).toBe(1);
      // Tab should produce \t (0x09)
      expect(dataReceived[0]).toBe('\t');
    });

    test('encodes Escape', () => {
      const handler = new InputHandler(
        ghostty,
        container as any,
        (data) => dataReceived.push(data),
        () => {
          bellCalled = true;
        }
      );

      simulateKey(container, createKeyEvent('Escape', 'Escape'));

      expect(dataReceived.length).toBe(1);
      // Escape should produce ESC (0x1B)
      expect(dataReceived[0].charCodeAt(0)).toBe(0x1b);
    });

    test('encodes Backspace', () => {
      const handler = new InputHandler(
        ghostty,
        container as any,
        (data) => dataReceived.push(data),
        () => {
          bellCalled = true;
        }
      );

      simulateKey(container, createKeyEvent('Backspace', 'Backspace'));

      expect(dataReceived.length).toBe(1);
      // Backspace should produce 0x7F (DEL) or 0x08 (BS)
      const code = dataReceived[0].charCodeAt(0);
      expect(code === 0x7f || code === 0x08).toBe(true);
    });
  });

  describe('Arrow Keys', () => {
    test('encodes Up arrow', () => {
      const handler = new InputHandler(
        ghostty,
        container as any,
        (data) => dataReceived.push(data),
        () => {
          bellCalled = true;
        }
      );

      simulateKey(container, createKeyEvent('ArrowUp', 'ArrowUp'));

      expect(dataReceived.length).toBe(1);
      // Arrow keys produce ESC[A, ESC[B, ESC[C, ESC[D or ESCOA, ESCOB, ESCOC, ESCOD
      expect(dataReceived[0]).toMatch(/\x1b(\[A|OA)/);
    });

    test('encodes Down arrow', () => {
      const handler = new InputHandler(
        ghostty,
        container as any,
        (data) => dataReceived.push(data),
        () => {
          bellCalled = true;
        }
      );

      simulateKey(container, createKeyEvent('ArrowDown', 'ArrowDown'));

      expect(dataReceived.length).toBe(1);
      expect(dataReceived[0]).toMatch(/\x1b(\[B|OB)/);
    });

    test('encodes Left arrow', () => {
      const handler = new InputHandler(
        ghostty,
        container as any,
        (data) => dataReceived.push(data),
        () => {
          bellCalled = true;
        }
      );

      simulateKey(container, createKeyEvent('ArrowLeft', 'ArrowLeft'));

      expect(dataReceived.length).toBe(1);
      expect(dataReceived[0]).toMatch(/\x1b(\[D|OD)/);
    });

    test('encodes Right arrow', () => {
      const handler = new InputHandler(
        ghostty,
        container as any,
        (data) => dataReceived.push(data),
        () => {
          bellCalled = true;
        }
      );

      simulateKey(container, createKeyEvent('ArrowRight', 'ArrowRight'));

      expect(dataReceived.length).toBe(1);
      expect(dataReceived[0]).toMatch(/\x1b(\[C|OC)/);
    });

    test('sends CSI sequences in normal cursor mode (mode 1 off)', () => {
      // Create handler with getMode callback that returns false (normal mode)
      const handler = new InputHandler(
        ghostty,
        container as any,
        (data) => dataReceived.push(data),
        () => {
          bellCalled = true;
        },
        undefined,
        undefined,
        (_mode: number) => false // Normal cursor mode
      );

      simulateKey(container, createKeyEvent('ArrowUp', 'ArrowUp'));
      simulateKey(container, createKeyEvent('ArrowDown', 'ArrowDown'));
      simulateKey(container, createKeyEvent('ArrowLeft', 'ArrowLeft'));
      simulateKey(container, createKeyEvent('ArrowRight', 'ArrowRight'));

      expect(dataReceived.length).toBe(4);
      // Normal mode: CSI sequences (ESC[A, ESC[B, ESC[D, ESC[C)
      expect(dataReceived[0]).toBe('\x1b[A');
      expect(dataReceived[1]).toBe('\x1b[B');
      expect(dataReceived[2]).toBe('\x1b[D');
      expect(dataReceived[3]).toBe('\x1b[C');
    });

    test('sends SS3 sequences in application cursor mode (mode 1 on)', () => {
      // Create handler with getMode callback that returns true for mode 1
      const handler = new InputHandler(
        ghostty,
        container as any,
        (data) => dataReceived.push(data),
        () => {
          bellCalled = true;
        },
        undefined,
        undefined,
        (mode: number) => mode === 1 // Application cursor mode enabled
      );

      simulateKey(container, createKeyEvent('ArrowUp', 'ArrowUp'));
      simulateKey(container, createKeyEvent('ArrowDown', 'ArrowDown'));
      simulateKey(container, createKeyEvent('ArrowLeft', 'ArrowLeft'));
      simulateKey(container, createKeyEvent('ArrowRight', 'ArrowRight'));

      expect(dataReceived.length).toBe(4);
      // Application mode: SS3 sequences (ESCOA, ESCOB, ESCOD, ESCOC)
      expect(dataReceived[0]).toBe('\x1bOA');
      expect(dataReceived[1]).toBe('\x1bOB');
      expect(dataReceived[2]).toBe('\x1bOD');
      expect(dataReceived[3]).toBe('\x1bOC');
    });
  });

  describe('Function Keys', () => {
    test('encodes F1', () => {
      const handler = new InputHandler(
        ghostty,
        container as any,
        (data) => dataReceived.push(data),
        () => {
          bellCalled = true;
        }
      );

      simulateKey(container, createKeyEvent('F1', 'F1'));

      expect(dataReceived.length).toBe(1);
      // F1 produces ESC[11~ or ESCOP
      expect(dataReceived[0]).toMatch(/\x1b(\[11~|OP)/);
    });

    test('encodes F12', () => {
      const handler = new InputHandler(
        ghostty,
        container as any,
        (data) => dataReceived.push(data),
        () => {
          bellCalled = true;
        }
      );

      simulateKey(container, createKeyEvent('F12', 'F12'));

      expect(dataReceived.length).toBe(1);
      // F12 produces ESC[24~
      expect(dataReceived[0].includes('\x1b')).toBe(true);
    });
  });

  describe('Navigation Keys', () => {
    test('encodes Home', () => {
      const handler = new InputHandler(
        ghostty,
        container as any,
        (data) => dataReceived.push(data),
        () => {
          bellCalled = true;
        }
      );

      simulateKey(container, createKeyEvent('Home', 'Home'));

      expect(dataReceived.length).toBe(1);
      expect(dataReceived[0].includes('\x1b')).toBe(true);
    });

    test('encodes End', () => {
      const handler = new InputHandler(
        ghostty,
        container as any,
        (data) => dataReceived.push(data),
        () => {
          bellCalled = true;
        }
      );

      simulateKey(container, createKeyEvent('End', 'End'));

      expect(dataReceived.length).toBe(1);
      expect(dataReceived[0].includes('\x1b')).toBe(true);
    });

    test('encodes PageUp', () => {
      const handler = new InputHandler(
        ghostty,
        container as any,
        (data) => dataReceived.push(data),
        () => {
          bellCalled = true;
        }
      );

      simulateKey(container, createKeyEvent('PageUp', 'PageUp'));

      expect(dataReceived.length).toBe(1);
      expect(dataReceived[0].includes('\x1b')).toBe(true);
    });

    test('encodes PageDown', () => {
      const handler = new InputHandler(
        ghostty,
        container as any,
        (data) => dataReceived.push(data),
        () => {
          bellCalled = true;
        }
      );

      simulateKey(container, createKeyEvent('PageDown', 'PageDown'));

      expect(dataReceived.length).toBe(1);
      expect(dataReceived[0].includes('\x1b')).toBe(true);
    });

    test('encodes Delete', () => {
      const handler = new InputHandler(
        ghostty,
        container as any,
        (data) => dataReceived.push(data),
        () => {
          bellCalled = true;
        }
      );

      simulateKey(container, createKeyEvent('Delete', 'Delete'));

      expect(dataReceived.length).toBe(1);
      expect(dataReceived[0].includes('\x1b')).toBe(true);
    });

    test('encodes Insert', () => {
      const handler = new InputHandler(
        ghostty,
        container as any,
        (data) => dataReceived.push(data),
        () => {
          bellCalled = true;
        }
      );

      simulateKey(container, createKeyEvent('Insert', 'Insert'));

      expect(dataReceived.length).toBe(1);
      expect(dataReceived[0].includes('\x1b')).toBe(true);
    });
  });

  describe('Event Prevention', () => {
    test('prevents default on printable characters', () => {
      const handler = new InputHandler(
        ghostty,
        container as any,
        (data) => dataReceived.push(data),
        () => {
          bellCalled = true;
        }
      );

      const event = createKeyEvent('KeyA', 'a');
      simulateKey(container, event);

      expect(event.preventDefault).toHaveBeenCalled();
    });

    test('prevents default on special keys', () => {
      const handler = new InputHandler(
        ghostty,
        container as any,
        (data) => dataReceived.push(data),
        () => {
          bellCalled = true;
        }
      );

      const event = createKeyEvent('Enter', 'Enter');
      simulateKey(container, event);

      expect(event.preventDefault).toHaveBeenCalled();
    });

    test('prevents default on Ctrl+keys', () => {
      const handler = new InputHandler(
        ghostty,
        container as any,
        (data) => dataReceived.push(data),
        () => {
          bellCalled = true;
        }
      );

      const event = createKeyEvent('KeyC', 'c', { ctrl: true });
      simulateKey(container, event);

      expect(event.preventDefault).toHaveBeenCalled();
    });
  });

  describe('Unknown Keys', () => {
    test('ignores unmapped keys', () => {
      const handler = new InputHandler(
        ghostty,
        container as any,
        (data) => dataReceived.push(data),
        () => {
          bellCalled = true;
        }
      );

      // Simulate a key that's not in KEY_MAP
      simulateKey(container, createKeyEvent('Unknown', 'Unknown'));

      // Should not crash or produce output
      expect(dataReceived.length).toBe(0);
    });
  });

  describe('Modifier Combinations', () => {
    test('handles Ctrl+Shift combinations', () => {
      const handler = new InputHandler(
        ghostty,
        container as any,
        (data) => dataReceived.push(data),
        () => {
          bellCalled = true;
        }
      );

      simulateKey(container, createKeyEvent('KeyA', 'A', { ctrl: true, shift: true }));

      expect(dataReceived.length).toBe(1);
      // Should still encode something
      expect(dataReceived[0].length).toBeGreaterThan(0);
    });

    test('handles Alt combinations', () => {
      const handler = new InputHandler(
        ghostty,
        container as any,
        (data) => dataReceived.push(data),
        () => {
          bellCalled = true;
        }
      );

      simulateKey(container, createKeyEvent('KeyA', 'a', { alt: true }));

      expect(dataReceived.length).toBe(1);
      // Alt+A often produces ESC a or similar
      expect(dataReceived[0].length).toBeGreaterThan(0);
    });
  });

  describe('Clipboard Operations', () => {
    test('handles paste event', () => {
      const handler = new InputHandler(
        ghostty,
        container as any,
        (data) => dataReceived.push(data),
        () => {
          bellCalled = true;
        }
      );

      const pasteText = 'Hello, World!';
      const pasteEvent = createClipboardEvent(pasteText);

      container.dispatchEvent(pasteEvent);

      expect(dataReceived.length).toBe(1);
      expect(dataReceived[0]).toBe(pasteText);
    });

    test('handles beforeinput insertFromPaste with data', () => {
      const inputElement = createMockContainer();
      const handler = new InputHandler(
        ghostty,
        container as any,
        (data) => dataReceived.push(data),
        () => {
          bellCalled = true;
        },
        undefined,
        undefined,
        undefined,
        undefined,
        inputElement as any
      );

      const pasteText = 'Hello, beforeinput!';
      const beforeInputEvent = createBeforeInputEvent('insertFromPaste', pasteText);

      inputElement.dispatchEvent(beforeInputEvent);

      expect(dataReceived.length).toBe(1);
      expect(dataReceived[0]).toBe(pasteText);
    });

    test('uses bracketed paste for beforeinput insertFromPaste', () => {
      const inputElement = createMockContainer();
      const handler = new InputHandler(
        ghostty,
        container as any,
        (data) => dataReceived.push(data),
        () => {
          bellCalled = true;
        },
        undefined,
        undefined,
        (mode) => mode === 2004,
        undefined,
        inputElement as any
      );

      const pasteText = 'Bracketed paste';
      const beforeInputEvent = createBeforeInputEvent('insertFromPaste', pasteText);

      inputElement.dispatchEvent(beforeInputEvent);

      expect(dataReceived.length).toBe(1);
      expect(dataReceived[0]).toBe(`\x1b[200~${pasteText}\x1b[201~`);
    });

    test('handles multi-line paste', () => {
      const handler = new InputHandler(
        ghostty,
        container as any,
        (data) => dataReceived.push(data),
        () => {
          bellCalled = true;
        }
      );

      const pasteText = 'Line 1\nLine 2\nLine 3';
      const pasteEvent = createClipboardEvent(pasteText);

      container.dispatchEvent(pasteEvent);

      expect(dataReceived.length).toBe(1);
      expect(dataReceived[0]).toBe(pasteText);
    });

    test('ignores beforeinput insertFromPaste when paste already handled', () => {
      const inputElement = createMockContainer();
      const handler = new InputHandler(
        ghostty,
        container as any,
        (data) => dataReceived.push(data),
        () => {
          bellCalled = true;
        },
        undefined,
        undefined,
        undefined,
        undefined,
        inputElement as any
      );

      const pasteText = 'Hello, World!';
      const pasteEvent = createClipboardEvent(pasteText);
      const beforeInputEvent = createBeforeInputEvent('insertFromPaste', pasteText);

      container.dispatchEvent(pasteEvent);
      inputElement.dispatchEvent(beforeInputEvent);

      expect(dataReceived.length).toBe(1);
      expect(dataReceived[0]).toBe(pasteText);
    });

    test('ignores paste when beforeinput insertFromPaste already handled', () => {
      const inputElement = createMockContainer();
      const handler = new InputHandler(
        ghostty,
        container as any,
        (data) => dataReceived.push(data),
        () => {
          bellCalled = true;
        },
        undefined,
        undefined,
        undefined,
        undefined,
        inputElement as any
      );

      const pasteText = 'Hello, World!';
      const beforeInputEvent = createBeforeInputEvent('insertFromPaste', pasteText);
      const pasteEvent = createClipboardEvent(pasteText);

      inputElement.dispatchEvent(beforeInputEvent);
      container.dispatchEvent(pasteEvent);

      expect(dataReceived.length).toBe(1);
      expect(dataReceived[0]).toBe(pasteText);
    });

    test('ignores paste with no clipboard data', () => {
      const handler = new InputHandler(
        ghostty,
        container as any,
        (data) => dataReceived.push(data),
        () => {
          bellCalled = true;
        }
      );

      const pasteEvent = createClipboardEvent(null);

      container.dispatchEvent(pasteEvent);

      expect(dataReceived.length).toBe(0);
    });

    test('ignores paste with empty text', () => {
      const handler = new InputHandler(
        ghostty,
        container as any,
        (data) => dataReceived.push(data),
        () => {
          bellCalled = true;
        }
      );

      const pasteEvent = createClipboardEvent('');

      container.dispatchEvent(pasteEvent);

      expect(dataReceived.length).toBe(0);
    });

    test('allows Ctrl+V to trigger paste', () => {
      const handler = new InputHandler(
        ghostty,
        container as any,
        (data) => dataReceived.push(data),
        () => {
          bellCalled = true;
        }
      );

      // Ctrl+V should NOT call onData callback (lets paste event handle it)
      simulateKey(container, createKeyEvent('KeyV', 'v', { ctrl: true }));

      expect(dataReceived.length).toBe(0);
    });

    test('allows Cmd+V to trigger paste', () => {
      const handler = new InputHandler(
        ghostty,
        container as any,
        (data) => dataReceived.push(data),
        () => {
          bellCalled = true;
        }
      );

      // Cmd+V should NOT call onData callback (lets paste event handle it)
      simulateKey(container, createKeyEvent('KeyV', 'v', { meta: true }));

      expect(dataReceived.length).toBe(0);
    });
  });
});
