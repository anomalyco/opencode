// Based on https://github.com/octet-stream/form-data/blob/2d0f0dc371517444ce1f22cdde13f51995d0953a/lib/File.ts (MIT)
/// <reference types="node" />

import { Blob } from 'buffer'

export interface BlobPropertyBag {
  type?: string
  endings?: 'native' | 'transparent'
}

export interface FilePropertyBag extends BlobPropertyBag {
  /**
   * The last modified date of the file as the number of milliseconds since the Unix epoch (January 1, 1970 at midnight). Files without a known last modified date return the current date.
   */
  lastModified?: number
}

export declare class File extends Blob {
  /**
   * Creates a new File instance.
   *
   * @param fileBits An `Array` strings, or [`ArrayBuffer`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/ArrayBuffer), [`ArrayBufferView`](https://developer.mozilla.org/en-US/docs/Web/API/ArrayBufferView), [`Blob`](https://developer.mozilla.org/en-US/docs/Web/API/Blob) objects, or a mix of any of such objects, that will be put inside the [`File`](https://developer.mozilla.org/en-US/docs/Web/API/File).
   * @param fileName The name of the file.
   * @param options An options object containing optional attributes for the file.
   */
  constructor(fileBits: ReadonlyArray<string | NodeJS.ArrayBufferView | Blob>, fileName: string, options?: FilePropertyBag)

  /**
   * Name of the file referenced by the File object.
   */
  readonly name: string

  /**
   * The last modified date of the file as the number of milliseconds since the Unix epoch (January 1, 1970 at midnight). Files without a known last modified date return the current date.
   */
  readonly lastModified: number

  readonly [Symbol.toStringTag]: string
}
