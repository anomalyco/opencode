import fs from 'fs';
import type { ResponseLike } from '@opencode-ai/sdk/internal/to-file';
import { toFile } from '@opencode-ai/sdk/core/uploads';
import { File } from 'node:buffer';

class MyClass {
  name: string = 'foo';
}

function mockResponse({ url, content }: { url: string; content?: Blob }): ResponseLike {
  return {
    url,
    blob: async () => content || new Blob([]),
  };
}

describe('toFile', () => {
  it('throws a helpful error for mismatched types', async () => {
    await expect(
      // @ts-expect-error intentionally mismatched type
      toFile({ foo: 'string' }),
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `"Unexpected data type: object; constructor: Object; props: ["foo"]"`,
    );

    await expect(
      // @ts-expect-error intentionally mismatched type
      toFile(new MyClass()),
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `"Unexpected data type: object; constructor: MyClass; props: ["name"]"`,
    );
  });

  it('disallows string at the type-level', async () => {
    // @ts-expect-error we intentionally do not type support for `string`
    // to help people avoid passing a file path
    const file = await toFile('contents');
    expect(file.text()).resolves.toEqual('contents');
  });

  it('extracts a file name from a Response', async () => {
    const response = mockResponse({ url: 'https://example.com/my/audio.mp3' });
    const file = await toFile(response);
    expect(file.name).toEqual('audio.mp3');
  });

  it('extracts a file name from a File', async () => {
    const input = new File(['foo'], 'input.jsonl');
    const file = await toFile(input);
    expect(file.name).toEqual('input.jsonl');
  });

  it('extracts a file name from a ReadStream', async () => {
    const input = fs.createReadStream(__filename);
    const file = await toFile(input);
    expect(file.name).toEqual('uploads.test.ts');
  });

  it('does not copy File objects', async () => {
    const input = new File(['foo'], 'input.jsonl', { type: 'jsonl' });
    const file = await toFile(input);
    expect(file).toBe(input);
    expect(file.name).toEqual('input.jsonl');
    expect(file.type).toBe('jsonl');
  });

  it('is assignable to File and Blob', async () => {
    const input = new File(['foo'], 'input.jsonl', { type: 'jsonl' });
    const result = await toFile(input);
    const file: File = result;
    const blob: Blob = result;
    void file, blob;
  });
});

describe('missing File error message', () => {
  let prevGlobalFile: unknown;
  let prevNodeFile: unknown;
  beforeEach(() => {
    // The file shim captures the global File object when it's first imported.
    const buffer = require('node:buffer');
    // @ts-ignore
    prevGlobalFile = globalThis.File;
    prevNodeFile = buffer.File;
    // @ts-ignore
    globalThis.File = undefined;
    buffer.File = undefined;
  });
  afterEach(() => {
    // Clean up
    // @ts-ignore
    globalThis.File = prevGlobalFile;
    require('node:buffer').File = prevNodeFile;
  });

  test('is thrown', async () => {
    const uploads = await import('@opencode-ai/sdk/core/uploads');
    await expect(
      uploads.toFile(mockResponse({ url: 'https://example.com/my/audio.mp3' })),
    ).rejects.toMatchInlineSnapshot(
      `[Error: \`File\` is not defined as a global, which is required for file uploads.]`,
    );
  });
});
