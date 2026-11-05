import type { Pointer } from "./types.js";
export declare const ptr: (value: ArrayBufferLike | ArrayBufferView) => Pointer;
export declare const toArrayBuffer: (pointer: Pointer, offset: number | undefined, length: number) => ArrayBuffer;
