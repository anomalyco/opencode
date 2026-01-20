
export class SelectionUtils {
  static codeAround(contents: string, startIndex: number, endIndex: number, contextLines: number) {
    // Validate inputs
    if (startIndex < 0 || endIndex < 0 || startIndex > contents.length || endIndex > contents.length || startIndex > endIndex) {
      throw new Error('Invalid start or end index');
    }

    if (contextLines < 0) {
      throw new Error('Context lines must be non-negative');
    }

    // Split content into lines
    const lines = contents.split('\n');

    // Find line numbers for start and end indices
    let currentPos = 0;
    let startLine = 0;
    let endLine = 0;

    for (let i = 0; i < lines.length; i++) {
      const lineLength = lines[i].length + 1; // +1 for the newline character

      if (currentPos <= startIndex && startIndex < currentPos + lineLength) {
        startLine = i;
      }

      if (currentPos <= endIndex && endIndex < currentPos + lineLength) {
        endLine = i;
        break;
      }

      currentPos += lineLength;
    }

    // Calculate the range of lines to include with context
    const startRange = Math.max(0, startLine - contextLines);
    const endRange = Math.min(lines.length - 1, endLine + contextLines);

    // Extract the contextual lines
    const contextualLines = lines.slice(startRange, endRange + 1);

    // Join the lines back together
    return contextualLines.join('\n');
  }

  // Helper method to find all occurrences of a pattern in content
  static findAllOccurrences(content: string, pattern: string, requireNewLine = true, requireEol = true): number[] {
    const indices: number[] = [];
    for (let i = 0; i <= content.length - pattern.length; i++) {
      if (content.substring(i, i + pattern.length) === pattern) {
        if (requireNewLine) {
          if (i !== 0 && content[i - 1] !== '\n') {
            continue;
          }
        }
        if (requireEol) {
          if (i + pattern.length < content.length && content[i + pattern.length] !== '\n') {
            continue;
          }
        }

        indices.push(i);
      }
    }
    return indices;
  }

  static multiplePatterns(patternName: string, pattern: string, indices: number[], content: string): string {
    const codeArounds = indices.slice(0, 4).map(i => this.codeAround(content, i, i + pattern.length, 3)).join("\n\n------------\n\n");
    return `Error: Multiple occurrences of ${patternName} pattern found. Please ensure the pattern is unique by matching longer patterns or multiple lines. Matches found include (max 4):\n\n${codeArounds}`;
  }

  // try to find a string uniquely in content, first by exact match, then by fuzzy match ignoring leading whitespace
  static fuzzyFind(content: string, pattern: string, patternName: string): [boolean, number] {
    for (const eol of [true, false]) {
      let indices = this.findAllOccurrences(content, pattern, true, eol);
      if (indices.length === 1) {
        return [true, indices[0]];
      }
      else if (indices.length) {
        throw new Error(SelectionUtils.multiplePatterns(patternName, pattern, indices, content));
      }
    }

    for (const eol of [true, false]) {
      let indices = this.findAllOccurrences(content, pattern, false, eol);
      if (indices.length === 1) {
        return [false, indices[0]];
      }
      else if (indices.length) {
        throw new Error(SelectionUtils.multiplePatterns(patternName, pattern, indices, content));
      }
    }

    throw new Error(`Error: ${patternName} not found.`);
  }

  static getLeadingIndent(content: string, index: number): string|undefined {
    let indent = '';
    for (let i = index - 1; i >= 0; i--) {
      const char = content[i];
      if (char === '\n') {
        return indent;
      }
      if (char === ' ' || char === '\t') {
        indent = char + indent;
      }
      else {
        // non whitespace, so this index is not indented.
        return;
      }
    }

    return indent;
  }

  static findStartEndIndices(content: string, searchStart: string, searchEnd: string): [boolean, number, number] {
    const [startIndexMatchesNewLine, startIndex] = this.fuzzyFind(content, searchStart, 'searchStart');
    if (!searchEnd) {
      return [startIndexMatchesNewLine, startIndex, startIndex + searchStart.length];
    }

    const leadingIndent = this.getLeadingIndent(content, startIndex);
    // when a leading indent is found for searchStart, try to apply it to searchEnd to for a more precise search.
    if (leadingIndent) {
      const indentedSearchEnd = leadingIndent + searchEnd;

      for (const eol of [true, false]) {
        const indices = this.findAllOccurrences(content.substring(startIndex + searchStart.length), indentedSearchEnd, true, eol)
          .map(i => i + startIndex + searchStart.length);

        if (indices.length === 1) {
          return [startIndexMatchesNewLine, startIndex, indices[0] + indentedSearchEnd.length];
        }
        else if (indices.length) {
          throw new Error(SelectionUtils.multiplePatterns('searchEnd', searchEnd, indices, content));
        }
      }
    }

    for (const newline of [true, false]) {
      for (const eol of [true, false]) {
        const indices = this.findAllOccurrences(content.substring(startIndex + searchStart.length), searchEnd, newline, eol)
          .map(i => i + startIndex + searchStart.length);

        if (indices.length === 1) {
          return [startIndexMatchesNewLine, startIndex, indices[0] + searchEnd.length];
        }
        else if (indices.length) {
          throw new Error(SelectionUtils.multiplePatterns('searchEnd', searchEnd, indices, content));
        }
      }
    }

    throw new Error(`Error: searchEnd not found.`);
  }
}
