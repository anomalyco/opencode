/**
 * Buffer API - xterm.js-compatible buffer access
 *
 * Provides read-only access to terminal buffer contents, cursor state,
 * and viewport position. Wraps Ghostty WASM terminal state.
 *
 * Usage:
 * ```typescript
 * const cell = term.buffer.active.getLine(0)?.getCell(5);
 * console.log(cell?.getChars(), cell?.isBold());
 *
 * if (term.buffer.active.type === 'alternate') {
 *   console.log('Full-screen app running');
 * }
 * ```
 */

import { EventEmitter } from './event-emitter';
import type { GhosttyTerminal } from './ghostty';
import { CellFlags } from './ghostty';
import type {
  IBuffer,
  IBufferCell,
  IBufferLine,
  IBufferNamespace,
  IDisposable,
  IEvent,
} from './interfaces';
import type { Terminal } from './terminal';
import type { GhosttyCell } from './types';

// ============================================================================
// BufferNamespace - Top-level buffer API
// ============================================================================

/**
 * Top-level buffer API namespace
 * Provides access to active, normal, and alternate screen buffers
 */
export class BufferNamespace implements IBufferNamespace {
  private terminal: Terminal;
  private bufferChangeEmitter = new EventEmitter<IBuffer>();

  // Lazy-initialized buffer wrappers (stateless, so we can cache them)
  private _normalBuffer?: Buffer;
  private _alternateBuffer?: Buffer;

  constructor(terminal: Terminal) {
    this.terminal = terminal;
  }

  get active(): IBuffer {
    // Query WASM to determine which buffer is active
    const wasmTerm = (this.terminal as any).wasmTerm as GhosttyTerminal | undefined;
    if (!wasmTerm) {
      return this.normal; // Default to normal if not initialized
    }

    return wasmTerm.isAlternateScreen() ? this.alternate : this.normal;
  }

  get normal(): IBuffer {
    if (!this._normalBuffer) {
      this._normalBuffer = new Buffer(this.terminal, 'normal');
    }
    return this._normalBuffer;
  }

  get alternate(): IBuffer {
    if (!this._alternateBuffer) {
      this._alternateBuffer = new Buffer(this.terminal, 'alternate');
    }
    return this._alternateBuffer;
  }

  get onBufferChange(): IEvent<IBuffer> {
    return this.bufferChangeEmitter.event;
  }

  /**
   * Internal: Fire buffer change event when screen switches
   * Should be called by Terminal when detecting screen change
   */
  _fireBufferChange(buffer: IBuffer): void {
    this.bufferChangeEmitter.fire(buffer);
  }
}

// ============================================================================
// Buffer - Represents a terminal buffer (normal or alternate)
// ============================================================================

/**
 * A terminal buffer (normal or alternate screen)
 */
export class Buffer implements IBuffer {
  private terminal: Terminal;
  private bufferType: 'normal' | 'alternate';
  private nullCell: BufferCell;

  constructor(terminal: Terminal, type: 'normal' | 'alternate') {
    this.terminal = terminal;
    this.bufferType = type;

    // Create a null cell (codepoint=0, default colors, no flags)
    const nullCellData: GhosttyCell = {
      codepoint: 0,
      fg_r: 204,
      fg_g: 204,
      fg_b: 204,
      bg_r: 0,
      bg_g: 0,
      bg_b: 0,
      flags: 0,
      width: 1,
      hyperlink_id: 0,
      grapheme_len: 0,
    };
    this.nullCell = new BufferCell(nullCellData, 0);
  }

  get type(): 'normal' | 'alternate' {
    return this.bufferType;
  }

  get cursorX(): number {
    const wasmTerm = this.getWasmTerm();
    if (!wasmTerm) return 0;
    return wasmTerm.getCursor().x;
  }

  get cursorY(): number {
    const wasmTerm = this.getWasmTerm();
    if (!wasmTerm) return 0;
    return wasmTerm.getCursor().y;
  }

  get viewportY(): number {
    // Get viewport offset from Terminal
    // For now, return 0 (no scrollback navigation implemented yet)
    return 0;
  }

  get baseY(): number {
    // For normal buffer: 0
    // For alternate buffer: 0 (alternate has no scrollback)
    return 0;
  }

  get length(): number {
    const wasmTerm = this.getWasmTerm();
    if (!wasmTerm) return 0;

    if (this.bufferType === 'alternate') {
      // Alternate buffer has no scrollback, just visible rows
      return wasmTerm.rows;
    } else {
      // Normal buffer: scrollback + visible rows
      const scrollback = wasmTerm.getScrollbackLength();
      return scrollback + wasmTerm.rows;
    }
  }

  getLine(y: number): IBufferLine | undefined {
    const wasmTerm = this.getWasmTerm();
    if (!wasmTerm) return undefined;

    // Check bounds
    if (y < 0 || y >= this.length) {
      return undefined;
    }

    // Determine if accessing scrollback or visible screen
    const scrollbackLength = wasmTerm.getScrollbackLength();
    let cells: GhosttyCell[] | null;
    let lineNumber: number;
    let isWrapped: boolean;

    if (this.bufferType === 'normal' && y < scrollbackLength) {
      // Accessing scrollback
      // WASM getScrollbackLine: offset 0 = oldest, offset (length-1) = newest
      // Buffer coords: y=0 = oldest, y=(length-1) = newest
      // So scrollbackOffset = y directly!
      const scrollbackOffset = y;
      cells = wasmTerm.getScrollbackLine(scrollbackOffset);
      // TODO: We'd need WASM API to check if scrollback line is wrapped
      // For now, assume not wrapped
      isWrapped = false;
    } else {
      // Accessing visible screen
      lineNumber = this.bufferType === 'normal' ? y - scrollbackLength : y;
      cells = wasmTerm.getLine(lineNumber);
      isWrapped = wasmTerm.isRowWrapped(lineNumber);
    }

    if (!cells) {
      return undefined;
    }

    return new BufferLine(cells, isWrapped, wasmTerm.cols);
  }

  getNullCell(): IBufferCell {
    return this.nullCell;
  }

  private getWasmTerm(): GhosttyTerminal | undefined {
    return (this.terminal as any).wasmTerm as GhosttyTerminal | undefined;
  }
}

// ============================================================================
// BufferLine - Represents a single line in the buffer
// ============================================================================

/**
 * A single line in the buffer
 */
export class BufferLine implements IBufferLine {
  private cells: GhosttyCell[];
  private _isWrapped: boolean;
  private _length: number;

  constructor(cells: GhosttyCell[], isWrapped: boolean, length: number) {
    this.cells = cells;
    this._isWrapped = isWrapped;
    this._length = length;
  }

  get length(): number {
    return this._length;
  }

  get isWrapped(): boolean {
    return this._isWrapped;
  }

  getCell(x: number): IBufferCell | undefined {
    if (x < 0 || x >= this._length) {
      return undefined;
    }

    if (x >= this.cells.length) {
      // Cell beyond what was returned (empty/null cell)
      return new BufferCell(
        {
          codepoint: 0,
          fg_r: 204,
          fg_g: 204,
          fg_b: 204,
          bg_r: 0,
          bg_g: 0,
          bg_b: 0,
          flags: 0,
          width: 1,
          hyperlink_id: 0,
          grapheme_len: 0,
        },
        x
      );
    }

    return new BufferCell(this.cells[x], x);
  }

  translateToString(trimRight = false, startColumn = 0, endColumn = this._length): string {
    // Clamp bounds
    const start = Math.max(0, Math.min(startColumn, this._length));
    const end = Math.max(start, Math.min(endColumn, this._length));

    let result = '';
    for (let x = start; x < end; x++) {
      const cell = this.getCell(x);
      if (cell) {
        const chars = cell.getChars();
        result += chars;
      }
    }

    if (trimRight) {
      result = result.trimEnd();
    }

    return result;
  }
}

// ============================================================================
// BufferCell - Represents a single cell in the buffer
// ============================================================================

/**
 * A single cell in the buffer
 */
export class BufferCell implements IBufferCell {
  private cell: GhosttyCell;
  private x: number;

  constructor(cell: GhosttyCell, x: number) {
    this.cell = cell;
    this.x = x;
  }

  getChars(): string {
    const codepoint = this.cell.codepoint;

    // Return empty string for null character or invalid codepoints
    if (codepoint === 0) {
      return '';
    }

    // Validate codepoint is within valid Unicode range
    // Valid: 0x0000 to 0x10FFFF, excluding surrogates (0xD800-0xDFFF)
    if (codepoint < 0 || codepoint > 0x10ffff || (codepoint >= 0xd800 && codepoint <= 0xdfff)) {
      // Return replacement character for invalid codepoints
      return '\uFFFD';
    }

    return String.fromCodePoint(codepoint);
  }

  getCode(): number {
    return this.cell.codepoint;
  }

  getWidth(): number {
    return this.cell.width;
  }

  getFgColorMode(): number {
    // Return -1 for RGB (we always use RGB in our WASM implementation)
    // xterm.js uses different values:
    // 0 = default, 1 = palette 16, 2 = palette 256, 3 = RGB
    // For simplicity, we return -1 for RGB
    return -1;
  }

  getBgColorMode(): number {
    return -1;
  }

  getFgColor(): number {
    // Pack RGB into a single number: 0xRRGGBB
    return (this.cell.fg_r << 16) | (this.cell.fg_g << 8) | this.cell.fg_b;
  }

  getBgColor(): number {
    // Pack RGB into a single number: 0xRRGGBB
    return (this.cell.bg_r << 16) | (this.cell.bg_g << 8) | this.cell.bg_b;
  }

  isBold(): number {
    return (this.cell.flags & CellFlags.BOLD) !== 0 ? 1 : 0;
  }

  isItalic(): number {
    return (this.cell.flags & CellFlags.ITALIC) !== 0 ? 1 : 0;
  }

  isUnderline(): number {
    return (this.cell.flags & CellFlags.UNDERLINE) !== 0 ? 1 : 0;
  }

  isStrikethrough(): number {
    return (this.cell.flags & CellFlags.STRIKETHROUGH) !== 0 ? 1 : 0;
  }

  isBlink(): number {
    return (this.cell.flags & CellFlags.BLINK) !== 0 ? 1 : 0;
  }

  isInverse(): number {
    return (this.cell.flags & CellFlags.INVERSE) !== 0 ? 1 : 0;
  }

  isInvisible(): number {
    return (this.cell.flags & CellFlags.INVISIBLE) !== 0 ? 1 : 0;
  }

  isFaint(): number {
    return (this.cell.flags & CellFlags.FAINT) !== 0 ? 1 : 0;
  }

  /**
   * Get hyperlink ID for this cell (0 = no link)
   * Used by link detection system
   */
  getHyperlinkId(): number {
    return this.cell.hyperlink_id;
  }

  /**
   * Get the Unicode codepoint for this cell
   * Used by link detection system
   */
  getCodepoint(): number {
    return this.cell.codepoint;
  }

  /**
   * Check if cell has dim/faint attribute
   * Added for IBufferCell compatibility
   */
  isDim(): boolean {
    return (this.cell.flags & CellFlags.FAINT) !== 0;
  }
}
