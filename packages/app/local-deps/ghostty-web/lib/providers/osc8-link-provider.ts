/**
 * OSC 8 Hyperlink Provider
 *
 * Detects hyperlinks created with OSC 8 escape sequences.
 * Supports multi-line links that wrap across lines.
 *
 * OSC 8 format: \x1b]8;;URL\x07TEXT\x1b]8;;\x07
 *
 * The Ghostty WASM automatically assigns hyperlink_id to cells,
 * so we just need to scan for contiguous regions with the same ID.
 */

import type { IBufferRange, ILink, ILinkProvider } from '../types';

/**
 * OSC 8 Hyperlink Provider
 *
 * Detects OSC 8 hyperlinks by scanning for hyperlink_id in cells.
 * Automatically handles multi-line links since Ghostty WASM preserves
 * hyperlink_id across wrapped lines.
 */
export class OSC8LinkProvider implements ILinkProvider {
  constructor(private terminal: ITerminalForOSC8Provider) {}

  /**
   * Provide all OSC 8 links on the given row
   * Note: This may return links that span multiple rows
   */
  provideLinks(y: number, callback: (links: ILink[] | undefined) => void): void {
    const links: ILink[] = [];
    const visitedPositions = new Set<number>(); // Track which columns we've already processed

    const line = this.terminal.buffer.active.getLine(y);
    if (!line) {
      callback(undefined);
      return;
    }

    // Scan through this line looking for hyperlink_id
    for (let x = 0; x < line.length; x++) {
      // Skip already processed positions
      if (visitedPositions.has(x)) continue;

      const cell = line.getCell(x);
      if (!cell) continue;

      const hyperlinkId = cell.getHyperlinkId();

      // Skip cells without links
      if (hyperlinkId === 0) {
        continue;
      }

      // Get the URI from WASM
      // The y parameter is a buffer row - we need to determine if it's in
      // scrollback or the active viewport and use the appropriate API
      if (!this.terminal.wasmTerm) continue;
      const scrollbackLength = this.terminal.wasmTerm.getScrollbackLength();
      const viewportRow = y - scrollbackLength;

      let uri: string | null;
      if (viewportRow < 0) {
        // Row is in scrollback - use scrollback API
        // y is the buffer row (0 = oldest), scrollback offset is also 0 = oldest
        uri = this.terminal.wasmTerm.getScrollbackHyperlinkUri(y, x);
      } else {
        // Row is in active viewport
        uri = this.terminal.wasmTerm.getHyperlinkUri(viewportRow, x);
      }

      if (uri) {
        // Find the end of this link by scanning forward until we hit a cell
        // without a hyperlink or with a different URI
        let endX = x;
        for (let col = x + 1; col < line.length; col++) {
          const nextCell = line.getCell(col);
          if (!nextCell || nextCell.getHyperlinkId() === 0) break;

          // Check if this cell has the same URI (use appropriate API for scrollback vs viewport)
          const nextUri =
            viewportRow < 0
              ? this.terminal.wasmTerm!.getScrollbackHyperlinkUri(y, col)
              : this.terminal.wasmTerm!.getHyperlinkUri(viewportRow, col);
          if (nextUri !== uri) break;

          endX = col;
        }

        // Mark all columns in this link as visited
        for (let col = x; col <= endX; col++) {
          visitedPositions.add(col);
        }

        const range: IBufferRange = {
          start: { x, y },
          end: { x: endX, y },
        };

        links.push({
          text: uri,
          range,
          activate: (event) => {
            // Open link if Ctrl/Cmd is pressed
            if (event.ctrlKey || event.metaKey) {
              window.open(uri, '_blank', 'noopener,noreferrer');
            }
          },
        });
      }
    }

    callback(links.length > 0 ? links : undefined);
  }

  /**
   * Find the full extent of a link by scanning for contiguous cells
   * with the same hyperlink_id. Handles multi-line links.
   */
  private findLinkRange(hyperlinkId: number, startY: number, startX: number): IBufferRange {
    const buffer = this.terminal.buffer.active;

    // Find the start of the link (scan backwards)
    let minY = startY;
    let minX = startX;

    // Scan backwards on current line
    while (minX > 0) {
      const line = buffer.getLine(minY);
      if (!line) break;

      const cell = line.getCell(minX - 1);
      if (!cell || cell.getHyperlinkId() !== hyperlinkId) break;
      minX--;
    }

    // If at start of line, check if link continues from previous line
    if (minX === 0 && minY > 0) {
      let prevY = minY - 1;

      while (prevY >= 0) {
        const prevLine = buffer.getLine(prevY);
        if (!prevLine || prevLine.length === 0) break;

        // Check if last cell of previous line has same hyperlink_id
        const lastCell = prevLine.getCell(prevLine.length - 1);
        if (!lastCell || lastCell.getHyperlinkId() !== hyperlinkId) break;

        // Link continues from previous line - find where it starts
        minY = prevY;
        minX = 0;

        // Scan backwards on this line
        for (let x = prevLine.length - 1; x >= 0; x--) {
          const cell = prevLine.getCell(x);
          if (!cell || cell.getHyperlinkId() !== hyperlinkId) {
            minX = x + 1;
            break;
          }
        }

        // If entire line is part of link, continue to previous line
        if (minX === 0) {
          prevY--;
        } else {
          break;
        }
      }
    }

    // Find the end of the link (scan forwards)
    let maxY = startY;
    let maxX = startX;

    // Scan forwards on current line
    const currentLine = buffer.getLine(maxY);
    if (currentLine) {
      while (maxX < currentLine.length - 1) {
        const cell = currentLine.getCell(maxX + 1);
        if (!cell || cell.getHyperlinkId() !== hyperlinkId) break;
        maxX++;
      }

      // If at end of line, check if link continues to next line
      if (maxX === currentLine.length - 1) {
        let nextY = maxY + 1;
        const maxBuffer = buffer.length;

        while (nextY < maxBuffer) {
          const nextLine = buffer.getLine(nextY);
          if (!nextLine || nextLine.length === 0) break;

          // Check if first cell of next line has same hyperlink_id
          const firstCell = nextLine.getCell(0);
          if (!firstCell || firstCell.getHyperlinkId() !== hyperlinkId) break;

          // Link continues to next line - find where it ends
          maxY = nextY;
          maxX = 0;

          // Scan forwards on this line
          for (let x = 0; x < nextLine.length; x++) {
            const cell = nextLine.getCell(x);
            if (!cell) break;
            if (cell.getHyperlinkId() !== hyperlinkId) {
              maxX = x - 1;
              break;
            }
            maxX = x;
          }

          // If entire line is part of link, continue to next line
          if (maxX === nextLine.length - 1) {
            nextY++;
          } else {
            break;
          }
        }
      }
    }

    return {
      start: { x: minX, y: minY },
      end: { x: maxX, y: maxY },
    };
  }

  dispose(): void {
    // No resources to clean up
  }
}

/**
 * Minimal terminal interface required by OSC8LinkProvider
 */
export interface ITerminalForOSC8Provider {
  buffer: {
    active: {
      length: number;
      getLine(y: number):
        | {
            length: number;
            getCell(x: number):
              | {
                  getHyperlinkId(): number;
                }
              | undefined;
          }
        | undefined;
    };
  };
  wasmTerm?: {
    getHyperlinkUri(row: number, col: number): string | null;
    getScrollbackHyperlinkUri(offset: number, col: number): string | null;
    getScrollbackLength(): number;
  };
}
