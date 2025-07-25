import { findDoubleNewlineIndex, LineDecoder } from '@opencode-ai/sdk/internal/decoders/line';

function decodeChunks(chunks: string[], { flush }: { flush: boolean } = { flush: false }): string[] {
  const decoder = new LineDecoder();
  const lines: string[] = [];
  for (const chunk of chunks) {
    lines.push(...decoder.decode(chunk));
  }

  if (flush) {
    lines.push(...decoder.flush());
  }

  return lines;
}

describe('line decoder', () => {
  test('basic', () => {
    // baz is not included because the line hasn't ended yet
    expect(decodeChunks(['foo', ' bar\nbaz'])).toEqual(['foo bar']);
  });

  test('basic with \\r', () => {
    expect(decodeChunks(['foo', ' bar\r\nbaz'])).toEqual(['foo bar']);
    expect(decodeChunks(['foo', ' bar\r\nbaz'], { flush: true })).toEqual(['foo bar', 'baz']);
  });

  test('trailing new lines', () => {
    expect(decodeChunks(['foo', ' bar', 'baz\n', 'thing\n'])).toEqual(['foo barbaz', 'thing']);
  });

  test('trailing new lines with \\r', () => {
    expect(decodeChunks(['foo', ' bar', 'baz\r\n', 'thing\r\n'])).toEqual(['foo barbaz', 'thing']);
  });

  test('escaped new lines', () => {
    expect(decodeChunks(['foo', ' bar\\nbaz\n'])).toEqual(['foo bar\\nbaz']);
  });

  test('escaped new lines with \\r', () => {
    expect(decodeChunks(['foo', ' bar\\r\\nbaz\n'])).toEqual(['foo bar\\r\\nbaz']);
  });

  test('\\r & \\n split across multiple chunks', () => {
    expect(decodeChunks(['foo\r', '\n', 'bar'], { flush: true })).toEqual(['foo', 'bar']);
  });

  test('single \\r', () => {
    expect(decodeChunks(['foo\r', 'bar'], { flush: true })).toEqual(['foo', 'bar']);
  });

  test('double \\r', () => {
    expect(decodeChunks(['foo\r', 'bar\r'], { flush: true })).toEqual(['foo', 'bar']);
    expect(decodeChunks(['foo\r', '\r', 'bar'], { flush: true })).toEqual(['foo', '', 'bar']);
    // implementation detail that we don't yield the single \r line until a new \r or \n is encountered
    expect(decodeChunks(['foo\r', '\r', 'bar'], { flush: false })).toEqual(['foo']);
  });

  test('double \\r then \\r\\n', () => {
    expect(decodeChunks(['foo\r', '\r', '\r', '\n', 'bar', '\n'])).toEqual(['foo', '', '', 'bar']);
    expect(decodeChunks(['foo\n', '\n', '\n', 'bar', '\n'])).toEqual(['foo', '', '', 'bar']);
  });

  test('double newline', () => {
    expect(decodeChunks(['foo\n\nbar'], { flush: true })).toEqual(['foo', '', 'bar']);
    expect(decodeChunks(['foo', '\n', '\nbar'], { flush: true })).toEqual(['foo', '', 'bar']);
    expect(decodeChunks(['foo\n', '\n', 'bar'], { flush: true })).toEqual(['foo', '', 'bar']);
    expect(decodeChunks(['foo', '\n', '\n', 'bar'], { flush: true })).toEqual(['foo', '', 'bar']);
  });

  test('multi-byte characters across chunks', () => {
    const decoder = new LineDecoder();

    // bytes taken from the string 'известни' and arbitrarily split
    // so that some multi-byte characters span multiple chunks
    expect(decoder.decode(new Uint8Array([0xd0]))).toHaveLength(0);
    expect(decoder.decode(new Uint8Array([0xb8, 0xd0, 0xb7, 0xd0]))).toHaveLength(0);
    expect(
      decoder.decode(new Uint8Array([0xb2, 0xd0, 0xb5, 0xd1, 0x81, 0xd1, 0x82, 0xd0, 0xbd, 0xd0, 0xb8])),
    ).toHaveLength(0);

    const decoded = decoder.decode(new Uint8Array([0xa]));
    expect(decoded).toEqual(['известни']);
  });

  test('flushing trailing newlines', () => {
    expect(decodeChunks(['foo\n', '\nbar'], { flush: true })).toEqual(['foo', '', 'bar']);
  });

  test('flushing empty buffer', () => {
    expect(decodeChunks([], { flush: true })).toEqual([]);
  });
});

describe('findDoubleNewlineIndex', () => {
  test('finds \\n\\n', () => {
    expect(findDoubleNewlineIndex(new TextEncoder().encode('foo\n\nbar'))).toBe(5);
    expect(findDoubleNewlineIndex(new TextEncoder().encode('\n\nbar'))).toBe(2);
    expect(findDoubleNewlineIndex(new TextEncoder().encode('foo\n\n'))).toBe(5);
    expect(findDoubleNewlineIndex(new TextEncoder().encode('\n\n'))).toBe(2);
  });

  test('finds \\r\\r', () => {
    expect(findDoubleNewlineIndex(new TextEncoder().encode('foo\r\rbar'))).toBe(5);
    expect(findDoubleNewlineIndex(new TextEncoder().encode('\r\rbar'))).toBe(2);
    expect(findDoubleNewlineIndex(new TextEncoder().encode('foo\r\r'))).toBe(5);
    expect(findDoubleNewlineIndex(new TextEncoder().encode('\r\r'))).toBe(2);
  });

  test('finds \\r\\n\\r\\n', () => {
    expect(findDoubleNewlineIndex(new TextEncoder().encode('foo\r\n\r\nbar'))).toBe(7);
    expect(findDoubleNewlineIndex(new TextEncoder().encode('\r\n\r\nbar'))).toBe(4);
    expect(findDoubleNewlineIndex(new TextEncoder().encode('foo\r\n\r\n'))).toBe(7);
    expect(findDoubleNewlineIndex(new TextEncoder().encode('\r\n\r\n'))).toBe(4);
  });

  test('returns -1 when no double newline found', () => {
    expect(findDoubleNewlineIndex(new TextEncoder().encode('foo\nbar'))).toBe(-1);
    expect(findDoubleNewlineIndex(new TextEncoder().encode('foo\rbar'))).toBe(-1);
    expect(findDoubleNewlineIndex(new TextEncoder().encode('foo\r\nbar'))).toBe(-1);
    expect(findDoubleNewlineIndex(new TextEncoder().encode(''))).toBe(-1);
  });

  test('handles incomplete patterns', () => {
    expect(findDoubleNewlineIndex(new TextEncoder().encode('foo\r\n\r'))).toBe(-1);
    expect(findDoubleNewlineIndex(new TextEncoder().encode('foo\r\n'))).toBe(-1);
  });
});
