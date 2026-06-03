import { SerovalUnknownTypedArrayError } from '../errors';

type TypedArrayConstructor =
  | Int8ArrayConstructor
  | Int16ArrayConstructor
  | Int32ArrayConstructor
  | Uint8ArrayConstructor
  | Uint16ArrayConstructor
  | Uint32ArrayConstructor
  | Uint8ClampedArrayConstructor
  | Float32ArrayConstructor
  | Float64ArrayConstructor
  | BigInt64ArrayConstructor
  | BigUint64ArrayConstructor;

export type TypedArrayValue =
  | Int8Array
  | Int16Array
  | Int32Array
  | Uint8Array
  | Uint16Array
  | Uint32Array
  | Uint8ClampedArray
  | Float32Array
  | Float64Array;

export type BigIntTypedArrayValue = BigInt64Array | BigUint64Array;

export function getTypedArrayConstructor(name: string): TypedArrayConstructor {
  switch (name) {
    case 'Int8Array':
      return Int8Array;
    case 'Int16Array':
      return Int16Array;
    case 'Int32Array':
      return Int32Array;
    case 'Uint8Array':
      return Uint8Array;
    case 'Uint16Array':
      return Uint16Array;
    case 'Uint32Array':
      return Uint32Array;
    case 'Uint8ClampedArray':
      return Uint8ClampedArray;
    case 'Float32Array':
      return Float32Array;
    case 'Float64Array':
      return Float64Array;
    case 'BigInt64Array':
      return BigInt64Array;
    case 'BigUint64Array':
      return BigUint64Array;
    default:
      throw new SerovalUnknownTypedArrayError(name);
  }
}
