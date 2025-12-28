export const ArrayBuffer4 = typeof ArrayBuffer !== 'undefined' ? ArrayBuffer : class ArrayBuffer4 {}
export const JSCallback = function () { throw new Error('bun:ffi JSCallback is not available in Node'); }
export const ptr = function () { throw new Error('bun:ffi ptr is not available in Node'); }
