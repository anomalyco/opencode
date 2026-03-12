/**
 * URL Regex Link Provider
 *
 * Detects plain text URLs using regex pattern matching.
 * Supports common protocols but excludes file paths.
 *
 * This provider runs after OSC8LinkProvider, so explicit hyperlinks
 * take precedence over regex-detected URLs.
 */

import type { IBufferRange, ILink, ILinkProvider } from '../types';

/**
 * URL Regex Provider
 *
 * Detects plain text URLs on a single line using regex.
 * Does not support multi-line URLs or file paths.
 *
 * Supported protocols:
 * - https://, http://
 * - mailto:
 * - ftp://, ssh://, git://
 * - tel:, magnet:
 * - gemini://, gopher://, news:
 */
export class UrlRegexProvider implements ILinkProvider {
  /**
   * URL regex pattern
   * Matches common protocols followed by valid URL characters
   * Excludes file paths (no ./ or ../ or bare /)
   */
  private static readonly URL_REGEX =
    /(?:https?:\/\/|mailto:|ftp:\/\/|ssh:\/\/|git:\/\/|tel:|magnet:|gemini:\/\/|gopher:\/\/|news:)[\w\-.~:\/?#@!$&*+,;=%]+/gi;

  /**
   * Characters to strip from end of URLs
   * Common punctuation that's unlikely to be part of the URL
   */
  private static readonly TRAILING_PUNCTUATION = /[.,;!?)\]]+$/;

  constructor(private terminal: ITerminalForUrlProvider) {}

  /**
   * Provide all regex-detected URLs on the given row
   */
  provideLinks(y: number, callback: (links: ILink[] | undefined) => void): void {
    const links: ILink[] = [];

    const line = this.terminal.buffer.active.getLine(y);
    if (!line) {
      callback(undefined);
      return;
    }

    // Convert line cells to text
    const lineText = this.lineToText(line);

    // Reset regex state (global flag maintains state)
    UrlRegexProvider.URL_REGEX.lastIndex = 0;

    // Find all URL matches in the line
    let match: RegExpExecArray | null = UrlRegexProvider.URL_REGEX.exec(lineText);
    while (match !== null) {
      let url = match[0];
      const startX = match.index;
      let endX = match.index + url.length - 1; // Inclusive end

      // Strip trailing punctuation
      const stripped = url.replace(UrlRegexProvider.TRAILING_PUNCTUATION, '');
      if (stripped.length < url.length) {
        url = stripped;
        endX = startX + url.length - 1;
      }

      // Skip if URL is too short (e.g., just "http://")
      if (url.length > 8) {
        links.push({
          text: url,
          range: {
            start: { x: startX, y },
            end: { x: endX, y },
          },
          activate: (event) => {
            // Open link if Ctrl/Cmd is pressed
            if (event.ctrlKey || event.metaKey) {
              window.open(url, '_blank', 'noopener,noreferrer');
            }
          },
        });
      }

      // Get next match
      match = UrlRegexProvider.URL_REGEX.exec(lineText);
    }

    callback(links.length > 0 ? links : undefined);
  }

  /**
   * Convert a buffer line to plain text string
   */
  private lineToText(line: IBufferLineForUrlProvider): string {
    const chars: string[] = [];

    for (let x = 0; x < line.length; x++) {
      const cell = line.getCell(x);
      if (!cell) {
        chars.push(' ');
        continue;
      }

      const codepoint = cell.getCodepoint();
      // Skip null characters and control characters
      if (codepoint === 0 || codepoint < 32) {
        chars.push(' ');
      } else {
        chars.push(String.fromCodePoint(codepoint));
      }
    }

    return chars.join('');
  }

  dispose(): void {
    // No resources to clean up
  }
}

/**
 * Minimal terminal interface required by UrlRegexProvider
 */
export interface ITerminalForUrlProvider {
  buffer: {
    active: {
      getLine(y: number): IBufferLineForUrlProvider | undefined;
    };
  };
}

/**
 * Minimal buffer line interface for URL detection
 */
interface IBufferLineForUrlProvider {
  length: number;
  getCell(x: number):
    | {
        getCodepoint(): number;
      }
    | undefined;
}
