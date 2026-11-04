import {
  ANSI,
  CliRenderer
} from "./chunk-node-51kpf0mz.js";
import {
  SystemClock,
  TreeSitterClient
} from "./chunk-node-q0cwyvm9.js";

// src/testing/mock-keys.ts
import { Buffer as Buffer2 } from "node:buffer";
function pasteBytes(text) {
  return Uint8Array.from(Buffer2.from(text));
}
var KeyCodes = {
  RETURN: "\r",
  LINEFEED: `
`,
  TAB: "\t",
  BACKSPACE: "\b",
  DELETE: "\x1B[3~",
  HOME: "\x1B[H",
  END: "\x1B[F",
  ESCAPE: "\x1B",
  ARROW_UP: "\x1B[A",
  ARROW_DOWN: "\x1B[B",
  ARROW_RIGHT: "\x1B[C",
  ARROW_LEFT: "\x1B[D",
  F1: "\x1BOP",
  F2: "\x1BOQ",
  F3: "\x1BOR",
  F4: "\x1BOS",
  F5: "\x1B[15~",
  F6: "\x1B[17~",
  F7: "\x1B[18~",
  F8: "\x1B[19~",
  F9: "\x1B[20~",
  F10: "\x1B[21~",
  F11: "\x1B[23~",
  F12: "\x1B[24~"
};
var kittyKeyCodeMap = {
  escape: 27,
  tab: 9,
  return: 13,
  backspace: 127,
  insert: 57348,
  delete: 57349,
  left: 57350,
  right: 57351,
  up: 57352,
  down: 57353,
  pageup: 57354,
  pagedown: 57355,
  home: 57356,
  end: 57357,
  f1: 57364,
  f2: 57365,
  f3: 57366,
  f4: 57367,
  f5: 57368,
  f6: 57369,
  f7: 57370,
  f8: 57371,
  f9: 57372,
  f10: 57373,
  f11: 57374,
  f12: 57375
};
function encodeKittySequence(codepoint, modifiers) {
  let modMask = 0;
  if (modifiers?.shift)
    modMask |= 1;
  if (modifiers?.meta)
    modMask |= 2;
  if (modifiers?.ctrl)
    modMask |= 4;
  if (modifiers?.super)
    modMask |= 8;
  if (modifiers?.hyper)
    modMask |= 16;
  if (modMask === 0) {
    return `\x1B[${codepoint}u`;
  } else {
    return `\x1B[${codepoint};${modMask + 1}u`;
  }
}
function encodeModifyOtherKeysSequence(charCode, modifiers) {
  let modMask = 0;
  if (modifiers?.shift)
    modMask |= 1;
  if (modifiers?.meta)
    modMask |= 2;
  if (modifiers?.ctrl)
    modMask |= 4;
  if (modifiers?.super)
    modMask |= 8;
  if (modifiers?.hyper)
    modMask |= 16;
  if (modMask === 0) {
    return String.fromCharCode(charCode);
  }
  return `\x1B[27;${modMask + 1};${charCode}~`;
}
function resolveKeyInput(key) {
  let keyValue;
  let keyName;
  if (typeof key === "string") {
    if (key in KeyCodes) {
      keyValue = KeyCodes[key];
      keyName = key.toLowerCase();
    } else {
      keyValue = key;
      keyName = undefined;
    }
  } else {
    keyValue = KeyCodes[key];
    if (!keyValue) {
      throw new Error(`Unknown key: ${key}`);
    }
    keyName = String(key).toLowerCase();
  }
  return { keyValue, keyName };
}
function createMockKeys(renderer, options) {
  const useKittyKeyboard = options?.kittyKeyboard ?? false;
  const useOtherModifiersMode = options?.otherModifiersMode ?? false;
  const effectiveOtherModifiersMode = useOtherModifiersMode && !useKittyKeyboard;
  const pressKeys = async (keys, delayMs = 0) => {
    for (const key of keys) {
      const { keyValue: keyCode } = resolveKeyInput(key);
      renderer.stdin.emit("data", Buffer2.from(keyCode));
      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  };
  const pressKey = (key, modifiers) => {
    if (useKittyKeyboard) {
      let { keyValue, keyName } = resolveKeyInput(key);
      const valueToKeyNameMap = {
        "\b": "backspace",
        "\r": "return",
        "\n": "return",
        "\t": "tab",
        "\x1B": "escape",
        "\x1B[A": "up",
        "\x1B[B": "down",
        "\x1B[C": "right",
        "\x1B[D": "left",
        "\x1B[H": "home",
        "\x1B[F": "end",
        "\x1B[3~": "delete"
      };
      if (keyValue && valueToKeyNameMap[keyValue]) {
        keyName = valueToKeyNameMap[keyValue];
      }
      if (keyName && keyName.startsWith("arrow_")) {
        keyName = keyName.substring(6);
      }
      if (keyName && kittyKeyCodeMap[keyName]) {
        const kittyCode = kittyKeyCodeMap[keyName];
        const sequence = encodeKittySequence(kittyCode, modifiers);
        renderer.stdin.emit("data", Buffer2.from(sequence));
        return;
      }
      if (keyValue && keyValue.length === 1 && !keyValue.startsWith("\x1B")) {
        const codepoint = keyValue.codePointAt(0);
        if (codepoint) {
          const sequence = encodeKittySequence(codepoint, modifiers);
          renderer.stdin.emit("data", Buffer2.from(sequence));
          return;
        }
      }
    }
    if (effectiveOtherModifiersMode && modifiers) {
      let { keyValue, keyName } = resolveKeyInput(key);
      const valueToCharCodeMap = {
        "\b": 127,
        "\r": 13,
        "\n": 13,
        "\t": 9,
        "\x1B": 27,
        " ": 32
      };
      let charCode;
      if (keyValue && valueToCharCodeMap[keyValue] !== undefined) {
        charCode = valueToCharCodeMap[keyValue];
      } else if (keyValue && keyValue.length === 1 && !keyValue.startsWith("\x1B")) {
        charCode = keyValue.charCodeAt(0);
      }
      if (charCode !== undefined) {
        const sequence = encodeModifyOtherKeysSequence(charCode, modifiers);
        renderer.stdin.emit("data", Buffer2.from(sequence));
        return;
      }
    }
    let keyCode = resolveKeyInput(key).keyValue;
    if (modifiers) {
      if (keyCode.startsWith("\x1B[") && keyCode.length > 2) {
        const modifier = 1 + (modifiers.shift ? 1 : 0) + (modifiers.meta ? 2 : 0) + (modifiers.ctrl ? 4 : 0) + (modifiers.super ? 8 : 0) + (modifiers.hyper ? 16 : 0);
        if (modifier > 1) {
          const tildeMatch = keyCode.match(/^\x1b\[(\d+)~$/);
          if (tildeMatch) {
            keyCode = `\x1B[${tildeMatch[1]};${modifier}~`;
          } else {
            const ending = keyCode.slice(-1);
            keyCode = `\x1B[1;${modifier}${ending}`;
          }
        }
      } else if (keyCode.length === 1) {
        let char = keyCode;
        if (char === "\t" && modifiers.shift) {
          keyCode = modifiers.meta ? "\x1B\x1B[Z" : "\x1B[Z";
          renderer.stdin.emit("data", Buffer2.from(keyCode));
          return;
        }
        if (char === "\b" && (modifiers.ctrl || modifiers.super || modifiers.hyper)) {
          const modifier = 1 + (modifiers.shift ? 1 : 0) + (modifiers.meta ? 2 : 0) + (modifiers.ctrl ? 4 : 0) + (modifiers.super ? 8 : 0) + (modifiers.hyper ? 16 : 0);
          keyCode = `\x1B[27;${modifier};127~`;
        } else if (modifiers.ctrl) {
          if (char >= "a" && char <= "z") {
            keyCode = String.fromCharCode(char.charCodeAt(0) - 96);
          } else if (char >= "A" && char <= "Z") {
            keyCode = String.fromCharCode(char.charCodeAt(0) - 64);
          } else {
            const specialCtrlMap = {
              "[": "\x1B",
              "\\": "\x1C",
              "]": "\x1D",
              "^": "\x1E",
              _: "\x1F",
              "?": "",
              "/": "\x1F",
              "-": "\x1F",
              ".": "\x1E",
              ",": "\x1C",
              "@": "\x00",
              " ": "\x00"
            };
            if (char in specialCtrlMap) {
              keyCode = specialCtrlMap[char];
            }
          }
          if (modifiers.meta) {
            keyCode = `\x1B${keyCode}`;
          }
        } else {
          if (modifiers.shift && char >= "a" && char <= "z") {
            char = char.toUpperCase();
          }
          if (modifiers.meta) {
            keyCode = `\x1B${char}`;
          } else {
            keyCode = char;
          }
        }
      } else if (modifiers.meta && !keyCode.startsWith("\x1B")) {
        keyCode = `\x1B${keyCode}`;
      }
    }
    renderer.stdin.emit("data", Buffer2.from(keyCode));
  };
  const typeText = async (text, delayMs = 0) => {
    const keys = text.split("");
    await pressKeys(keys, delayMs);
  };
  const pressReturn = (modifiers) => {
    pressKey(KeyCodes.RETURN, modifiers);
  };
  const pressEscape = (modifiers) => {
    pressKey(KeyCodes.ESCAPE, modifiers);
  };
  const pressTab = (modifiers) => {
    pressKey(KeyCodes.TAB, modifiers);
  };
  const pressBackspace = (modifiers) => {
    pressKey(KeyCodes.BACKSPACE, modifiers);
  };
  const pressArrow = (direction, modifiers) => {
    const keyMap = {
      up: KeyCodes.ARROW_UP,
      down: KeyCodes.ARROW_DOWN,
      left: KeyCodes.ARROW_LEFT,
      right: KeyCodes.ARROW_RIGHT
    };
    pressKey(keyMap[direction], modifiers);
  };
  const pressCtrlC = () => {
    pressKey("c", { ctrl: true });
  };
  const pasteBracketedText = (text) => {
    return pressKeys([ANSI.bracketedPasteStart, text, ANSI.bracketedPasteEnd]);
  };
  return {
    pressKeys,
    pressKey,
    typeText,
    pressEnter: pressReturn,
    pressEscape,
    pressTab,
    pressBackspace,
    pressArrow,
    pressCtrlC,
    pasteBracketedText
  };
}

// src/testing/mock-mouse.ts
var MouseButtons = {
  LEFT: 0,
  MIDDLE: 1,
  RIGHT: 2,
  WHEEL_UP: 64,
  WHEEL_DOWN: 65,
  WHEEL_LEFT: 66,
  WHEEL_RIGHT: 67
};
function createMockMouse(renderer) {
  let currentPosition = { x: 0, y: 0 };
  let buttonsPressed = new Set;
  const generateMouseEvent = (type, x, y, button = MouseButtons.LEFT, modifiers = {}) => {
    let buttonCode = button;
    if (modifiers.shift)
      buttonCode |= 4;
    if (modifiers.alt)
      buttonCode |= 8;
    if (modifiers.ctrl)
      buttonCode |= 16;
    switch (type) {
      case "move":
        buttonCode = 32 | 3;
        if (modifiers.shift)
          buttonCode |= 4;
        if (modifiers.alt)
          buttonCode |= 8;
        if (modifiers.ctrl)
          buttonCode |= 16;
        break;
      case "drag":
        buttonCode = (buttonsPressed.size > 0 ? Array.from(buttonsPressed)[0] : button) | 32;
        if (modifiers.shift)
          buttonCode |= 4;
        if (modifiers.alt)
          buttonCode |= 8;
        if (modifiers.ctrl)
          buttonCode |= 16;
        break;
      case "scroll":
        break;
    }
    const ansiX = x + 1;
    const ansiY = y + 1;
    let pressRelease = "M";
    if (type === "up" || type === "move" || type === "drag") {
      pressRelease = "m";
    }
    return `\x1B[<${buttonCode};${ansiX};${ansiY}${pressRelease}`;
  };
  const emitMouseEvent = async (type, x, y, button = MouseButtons.LEFT, options = {}) => {
    const { modifiers = {}, delayMs = 0 } = options;
    const eventSequence = generateMouseEvent(type, x, y, button, modifiers);
    renderer.stdin.emit("data", Buffer.from(eventSequence));
    currentPosition = { x, y };
    if (type === "down" && button < 64) {
      buttonsPressed.add(button);
    } else if (type === "up") {
      buttonsPressed.delete(button);
    }
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  };
  const moveTo = async (x, y, options = {}) => {
    const { button = MouseButtons.LEFT, delayMs = 0, modifiers = {} } = options;
    if (buttonsPressed.size > 0) {
      await emitMouseEvent("drag", x, y, Array.from(buttonsPressed)[0], { modifiers, delayMs });
    } else {
      await emitMouseEvent("move", x, y, button, { modifiers, delayMs });
    }
    currentPosition = { x, y };
  };
  const click = async (x, y, button = MouseButtons.LEFT, options = {}) => {
    const { delayMs = 10, modifiers = {} } = options;
    await emitMouseEvent("down", x, y, button, { modifiers, delayMs });
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    await emitMouseEvent("up", x, y, button, { modifiers, delayMs });
  };
  const doubleClick = async (x, y, button = MouseButtons.LEFT, options = {}) => {
    const { delayMs = 10, modifiers = {} } = options;
    await click(x, y, button, { modifiers, delayMs });
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    await click(x, y, button, { modifiers, delayMs });
  };
  const pressDown = async (x, y, button = MouseButtons.LEFT, options = {}) => {
    const { modifiers = {}, delayMs = 0 } = options;
    await emitMouseEvent("down", x, y, button, { modifiers, delayMs });
  };
  const release = async (x, y, button = MouseButtons.LEFT, options = {}) => {
    const { modifiers = {}, delayMs = 0 } = options;
    await emitMouseEvent("up", x, y, button, { modifiers, delayMs });
  };
  const drag = async (startX, startY, endX, endY, button = MouseButtons.LEFT, options = {}) => {
    const { delayMs = 10, modifiers = {} } = options;
    await pressDown(startX, startY, button, { modifiers });
    const steps = 5;
    const dx = (endX - startX) / steps;
    const dy = (endY - startY) / steps;
    for (let i = 1;i <= steps; i++) {
      const currentX = Math.round(startX + dx * i);
      const currentY = Math.round(startY + dy * i);
      await emitMouseEvent("drag", currentX, currentY, button, { modifiers, delayMs });
    }
    await release(endX, endY, button, { modifiers });
  };
  const scroll = async (x, y, direction, options = {}) => {
    const { modifiers = {}, delayMs = 0 } = options;
    let button;
    switch (direction) {
      case "up":
        button = MouseButtons.WHEEL_UP;
        break;
      case "down":
        button = MouseButtons.WHEEL_DOWN;
        break;
      case "left":
        button = MouseButtons.WHEEL_LEFT;
        break;
      case "right":
        button = MouseButtons.WHEEL_RIGHT;
        break;
    }
    await emitMouseEvent("scroll", x, y, button, { modifiers, delayMs });
  };
  const getCurrentPosition = () => {
    return { ...currentPosition };
  };
  const getPressedButtons = () => {
    return Array.from(buttonsPressed);
  };
  return {
    moveTo,
    click,
    doubleClick,
    pressDown,
    release,
    drag,
    scroll,
    getCurrentPosition,
    getPressedButtons,
    emitMouseEvent
  };
}

// src/testing/test-streams.ts
import { Readable, Writable } from "stream";

class TestWriteStream extends Writable {
  isTTY = true;
  columns;
  rows;
  constructor(columns = 80, rows = 24) {
    super();
    this.columns = columns;
    this.rows = rows;
  }
  _write(_chunk, _encoding, callback) {
    callback();
  }
  getColorDepth() {
    return 24;
  }
}
function createTestStdin() {
  return new Readable({ read() {} });
}
function createTestStdout(columns = 80, rows = 24) {
  return new TestWriteStream(columns, rows);
}

// src/testing/test-renderer.ts
var decoder = new TextDecoder;
var DEFAULT_MAX_PASSES = 20;
var DEFAULT_MAX_VISUAL_IDLE_FRAMES = 20;
var DEFAULT_QUIET_FRAMES = 1;
async function drainImmediateWork() {
  await Promise.resolve();
  await new Promise((resolve) => process.nextTick(resolve));
  await Promise.resolve();
}
function normalizePositiveInteger(value, fallback) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return Math.floor(value);
}
function createWaitError(renderer, message, frame) {
  const stats = renderer.getStats();
  const scheduler = renderer.getSchedulerState();
  const details = [
    message,
    `frameId: ${renderer.frameId}`,
    `nativeFrameCount: ${stats.nativeFrameCount}`,
    `cellsUpdated: ${stats.cellsUpdated}`,
    `isRunning: ${scheduler.isRunning}`,
    `isRendering: ${scheduler.isRendering}`,
    `hasScheduledRender: ${scheduler.hasScheduledRender}`
  ];
  if (frame !== undefined) {
    details.push(`lastFrame:
${frame}`);
  }
  return new Error(details.join(`
`));
}

class TestExternalOutputRecorder {
  commits = [];
  constructor(renderer) {
    renderer.on("external_output" /* EXTERNAL_OUTPUT */, this.record);
    renderer.once("destroy" /* DESTROY */, () => {
      renderer.off("external_output" /* EXTERNAL_OUTPUT */, this.record);
    });
  }
  record = (event) => {
    const raw = decoder.decode(event.snapshot.getRealCharBytes(false));
    const rows = Array.from({ length: event.snapshot.height }, (_, index) => raw.slice(index * event.snapshot.width, (index + 1) * event.snapshot.width).trimEnd());
    this.commits.push({
      text: rows.join(`
`),
      rows,
      width: event.snapshot.width,
      height: event.snapshot.height,
      rowColumns: event.rowColumns,
      startOnNewLine: event.startOnNewLine,
      trailingNewline: event.trailingNewline
    });
  };
  take() {
    const commits = this.commits;
    this.commits = [];
    return commits;
  }
  takeText() {
    return this.take().flatMap((commit) => commit.rows).join(`
`);
  }
  clear() {
    this.commits = [];
  }
}
function waitForNextFrameOrIdle(renderer) {
  const scheduler = renderer.getSchedulerState();
  if (!scheduler.isRunning && !scheduler.isRendering && !scheduler.hasScheduledRender) {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    let settled = false;
    const cleanup = () => {
      renderer.off("frame" /* FRAME */, onFrame);
      renderer.off("destroy" /* DESTROY */, onDestroy);
    };
    const finish = (event) => {
      if (settled)
        return;
      settled = true;
      cleanup();
      resolve(event);
    };
    const onFrame = (event) => {
      finish(event);
    };
    const onDestroy = () => {
      finish(null);
    };
    renderer.on("frame" /* FRAME */, onFrame);
    renderer.once("destroy" /* DESTROY */, onDestroy);
    if (!scheduler.isRunning) {
      renderer.idle().then(() => finish(null));
    }
  });
}
async function createTestRenderer(options) {
  const useKittyKeyboard = options.kittyKeyboard ? { events: true } : options.useKittyKeyboard;
  const renderer = await setupTestRenderer({
    ...options,
    useKittyKeyboard,
    screenMode: options.screenMode ?? "main-screen",
    footerHeight: options.footerHeight ?? 12,
    consoleMode: options.consoleMode ?? "disabled",
    externalOutputMode: options.externalOutputMode ?? "passthrough"
  });
  const externalOutput = new TestExternalOutputRecorder(renderer);
  const mockInput = createMockKeys(renderer, {
    kittyKeyboard: options.kittyKeyboard,
    otherModifiersMode: options.otherModifiersMode
  });
  const mockMouse = createMockMouse(renderer);
  const renderOnce = async () => {
    const feed = renderer._feed;
    if (feed?.isBackpressured()) {
      await feed.idle();
    }
    await renderer.loop();
  };
  const captureCharFrame = () => {
    const currentBuffer = renderer.currentRenderBuffer;
    const frameBytes = currentBuffer.getRealCharBytes(true);
    return decoder.decode(frameBytes);
  };
  const waitForVisualIdle = async (waitOptions = {}) => {
    const maxFrames = normalizePositiveInteger(waitOptions.maxFrames, DEFAULT_MAX_VISUAL_IDLE_FRAMES);
    const quietFrames = normalizePositiveInteger(waitOptions.quietFrames, DEFAULT_QUIET_FRAMES);
    let consecutiveQuietFrames = 0;
    for (let frame = 0;frame < maxFrames; frame++) {
      await drainImmediateWork();
      const scheduler2 = renderer.getSchedulerState();
      if (!scheduler2.isRunning && !scheduler2.isRendering && !scheduler2.hasScheduledRender) {
        return;
      }
      const event = await waitForNextFrameOrIdle(renderer);
      if (!event) {
        return;
      }
      if (renderer.getNativeStats().cellsUpdated === 0) {
        consecutiveQuietFrames++;
        if (consecutiveQuietFrames >= quietFrames) {
          return;
        }
      } else {
        consecutiveQuietFrames = 0;
      }
    }
    await drainImmediateWork();
    const scheduler = renderer.getSchedulerState();
    if (!scheduler.isRunning && !scheduler.isRendering && !scheduler.hasScheduledRender) {
      return;
    }
    throw createWaitError(renderer, `Timed out waiting for visual idle after ${maxFrames} frames`);
  };
  const flush = async (flushOptions = {}) => {
    await waitForVisualIdle({ maxFrames: normalizePositiveInteger(flushOptions.maxPasses, DEFAULT_MAX_PASSES) });
  };
  const waitFor = async (predicate, waitOptions = {}) => {
    const maxPasses = normalizePositiveInteger(waitOptions.maxPasses, DEFAULT_MAX_PASSES);
    for (let pass = 0;pass <= maxPasses; pass++) {
      await drainImmediateWork();
      if (await predicate()) {
        return;
      }
      if (pass === maxPasses) {
        break;
      }
      const scheduler = renderer.getSchedulerState();
      if (!scheduler.isRunning && !scheduler.isRendering && !scheduler.hasScheduledRender) {
        break;
      }
      await waitForNextFrameOrIdle(renderer);
    }
    throw createWaitError(renderer, `Timed out waiting for predicate after ${maxPasses} passes`);
  };
  const waitForFrame = async (predicate, waitOptions = {}) => {
    const maxPasses = normalizePositiveInteger(waitOptions.maxPasses, DEFAULT_MAX_PASSES);
    let frame = captureCharFrame();
    for (let pass = 0;pass <= maxPasses; pass++) {
      await drainImmediateWork();
      frame = captureCharFrame();
      if (await predicate(frame)) {
        return frame;
      }
      if (pass === maxPasses) {
        break;
      }
      const scheduler = renderer.getSchedulerState();
      if (!scheduler.isRunning && !scheduler.isRendering && !scheduler.hasScheduledRender) {
        break;
      }
      await waitForNextFrameOrIdle(renderer);
    }
    frame = captureCharFrame();
    throw createWaitError(renderer, `Timed out waiting for frame predicate after ${maxPasses} passes`, frame);
  };
  return {
    renderer,
    mockInput,
    mockMouse,
    renderOnce,
    flush,
    waitFor,
    waitForFrame,
    waitForVisualIdle,
    externalOutput,
    getNativeStats: () => renderer.getNativeStats(),
    captureCharFrame,
    captureSpans: () => {
      const currentBuffer = renderer.currentRenderBuffer;
      const lines = currentBuffer.getSpanLines();
      const cursorState = renderer.getCursorState();
      return {
        cols: currentBuffer.width,
        rows: currentBuffer.height,
        cursor: [cursorState.x, cursorState.y],
        lines
      };
    },
    resize: (width, height) => {
      renderer.processResize(width, height);
    }
  };
}
async function setupTestRenderer(config) {
  const stdin = config.stdin || createTestStdin();
  const width = config.width || config.stdout?.columns || process.stdout.columns || 80;
  const height = config.height || config.stdout?.rows || process.stdout.rows || 24;
  const stdout = config.stdout || createTestStdout(width, height);
  return new CliRenderer(stdin, stdout, width, height, {
    ...config,
    bufferedOutput: config.bufferedOutput ?? "memory"
  });
}
// src/testing/mock-tree-sitter-client.ts
class MockTreeSitterClient extends TreeSitterClient {
  _highlightPromises = [];
  _mockResult = { highlights: [] };
  _autoResolveTimeout;
  _clock;
  constructor(options) {
    super({ dataPath: "/tmp/mock" }, { autoStartWorker: false });
    this._autoResolveTimeout = options?.autoResolveTimeout;
    this._clock = options?.clock ?? new SystemClock;
  }
  async destroy() {
    this.resolveAllHighlightOnce();
    await super.destroy();
  }
  async highlightOnce(content, filetype) {
    const { promise, resolve } = Promise.withResolvers();
    let timeout;
    if (this._autoResolveTimeout !== undefined) {
      timeout = this._clock.setTimeout(() => {
        const index = this._highlightPromises.findIndex((p) => p.promise === promise);
        if (index !== -1) {
          resolve(this._mockResult);
          this._highlightPromises.splice(index, 1);
        }
      }, this._autoResolveTimeout);
    }
    this._highlightPromises.push({ promise, resolve, timeout });
    return promise;
  }
  setMockResult(result) {
    this._mockResult = result;
  }
  resolveHighlightOnce(index = 0) {
    if (index >= 0 && index < this._highlightPromises.length) {
      const item = this._highlightPromises[index];
      if (item.timeout) {
        this._clock.clearTimeout(item.timeout);
      }
      item.resolve(this._mockResult);
      this._highlightPromises.splice(index, 1);
    }
  }
  resolveAllHighlightOnce() {
    for (const { resolve, timeout } of this._highlightPromises) {
      if (timeout) {
        this._clock.clearTimeout(timeout);
      }
      resolve(this._mockResult);
    }
    this._highlightPromises = [];
  }
  isHighlighting() {
    return this._highlightPromises.length > 0;
  }
}
// src/testing/terminal-capabilities.ts
function createTerminalCapabilities(overrides = {}) {
  return {
    kitty_keyboard: false,
    kitty_graphics: false,
    rgb: false,
    ansi256: false,
    unicode: "unicode",
    sgr_pixels: false,
    color_scheme_updates: false,
    explicit_width: false,
    scaled_text: false,
    sixel: false,
    focus_tracking: false,
    sync: false,
    bracketed_paste: false,
    hyperlinks: false,
    osc52: false,
    osc52_support: "unknown",
    notifications: false,
    explicit_cursor_positioning: false,
    remote: false,
    multiplexer: "none",
    ...overrides,
    terminal: {
      name: "",
      version: "",
      from_xtversion: false,
      ...overrides.terminal
    }
  };
}
function setRendererCapabilities(renderer, overrides = {}) {
  const capabilities = createTerminalCapabilities(overrides);
  renderer._capabilities = capabilities;
  return capabilities;
}
// src/testing/spy.ts
function createSpy() {
  const calls = [];
  const spy = (...args) => {
    calls.push(args);
  };
  spy.calls = calls;
  spy.callCount = () => calls.length;
  spy.calledWith = (...expected) => {
    return calls.some((call) => JSON.stringify(call) === JSON.stringify(expected));
  };
  spy.reset = () => calls.length = 0;
  return spy;
}
// src/testing/manual-clock.ts
function compareTimers(left, right) {
  if (left.fireAt !== right.fireAt) {
    return left.fireAt - right.fireAt;
  }
  return left.order - right.order;
}

class ManualClock {
  time = 0;
  nextId = 1;
  nextOrder = 0;
  timers = new Map;
  now() {
    return this.time;
  }
  setTime(time) {
    const targetTime = Math.floor(time);
    if (targetTime >= this.time) {
      this.advance(targetTime - this.time);
      return;
    }
    this.time = targetTime;
  }
  setTimeout(fn, delayMs) {
    return this.schedule(fn, delayMs, false);
  }
  clearTimeout(handle) {
    this.timers.delete(Number(handle));
  }
  setInterval(fn, delayMs) {
    return this.schedule(fn, delayMs, true);
  }
  clearInterval(handle) {
    this.clearTimeout(handle);
  }
  advance(delayMs) {
    const targetTime = this.time + Math.max(0, Math.floor(delayMs));
    while (true) {
      const nextTimer = this.peekNextTimer();
      if (!nextTimer || nextTimer.fireAt > targetTime) {
        break;
      }
      this.timers.delete(nextTimer.id);
      this.time = nextTimer.fireAt;
      nextTimer.fn();
      if (nextTimer.repeat && !this.timers.has(nextTimer.id)) {
        this.timers.set(nextTimer.id, {
          ...nextTimer,
          fireAt: this.time + nextTimer.delayMs,
          order: this.nextOrder++
        });
      }
    }
    this.time = targetTime;
  }
  runAll() {
    while (true) {
      const nextTimer = this.peekNextTimer();
      if (!nextTimer) {
        return;
      }
      this.advance(nextTimer.fireAt - this.time);
    }
  }
  schedule(fn, delayMs, repeat) {
    const id = this.nextId++;
    const normalizedDelay = Math.max(0, Math.floor(delayMs));
    this.timers.set(id, {
      id,
      fireAt: this.time + normalizedDelay,
      order: this.nextOrder++,
      delayMs: normalizedDelay,
      repeat,
      fn
    });
    return id;
  }
  peekNextTimer() {
    let nextTimer = null;
    for (const timer of this.timers.values()) {
      if (!nextTimer || compareTimers(timer, nextTimer) < 0) {
        nextTimer = timer;
      }
    }
    return nextTimer;
  }
}
// src/testing/test-recorder.ts
class TestRecorder {
  renderer;
  frames = [];
  recording = false;
  frameNumber = 0;
  startTime = 0;
  decoder = new TextDecoder;
  recordBuffers;
  now;
  onFrame = () => {
    if (!this.recording)
      return;
    this.captureFrame();
  };
  constructor(renderer, options) {
    this.renderer = renderer;
    this.recordBuffers = options?.recordBuffers || {};
    this.now = options?.now ?? (() => performance.now());
  }
  rec() {
    if (this.recording) {
      return;
    }
    this.recording = true;
    this.frames = [];
    this.frameNumber = 0;
    this.startTime = this.now();
    this.renderer.on("frame" /* FRAME */, this.onFrame);
  }
  stop() {
    if (!this.recording) {
      return;
    }
    this.recording = false;
    this.renderer.off("frame" /* FRAME */, this.onFrame);
  }
  get recordedFrames() {
    return [...this.frames];
  }
  clear() {
    this.frames = [];
    this.frameNumber = 0;
  }
  get isRecording() {
    return this.recording;
  }
  captureFrame() {
    const currentBuffer = this.renderer.currentRenderBuffer;
    const frameBytes = currentBuffer.getRealCharBytes(true);
    const frame = this.decoder.decode(frameBytes);
    const recordedFrame = {
      frame,
      timestamp: this.now() - this.startTime,
      frameNumber: this.frameNumber++
    };
    if (this.recordBuffers.fg || this.recordBuffers.bg || this.recordBuffers.attributes) {
      const buffers = currentBuffer.buffers;
      recordedFrame.buffers = {};
      if (this.recordBuffers.fg) {
        recordedFrame.buffers.fg = new Uint16Array(buffers.fg);
      }
      if (this.recordBuffers.bg) {
        recordedFrame.buffers.bg = new Uint16Array(buffers.bg);
      }
      if (this.recordBuffers.attributes) {
        recordedFrame.buffers.attributes = new Uint8Array(buffers.attributes);
      }
    }
    this.frames.push(recordedFrame);
  }
}
export {
  setRendererCapabilities,
  pasteBytes,
  createTestRenderer,
  createTerminalCapabilities,
  createSpy,
  createMockMouse,
  createMockKeys,
  TestRecorder,
  MouseButtons,
  MockTreeSitterClient,
  ManualClock,
  KeyCodes
};

//# debugId=08D19767EB8430A064756E2164756E21
//# sourceMappingURL=testing.js.map
