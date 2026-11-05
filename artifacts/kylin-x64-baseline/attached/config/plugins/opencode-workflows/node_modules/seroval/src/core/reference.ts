import {
  SerovalMissingReferenceError,
  SerovalMissingReferenceForIdError,
} from '..';
import { REFERENCES_KEY } from './keys';

const REFERENCE = new Map<unknown, string>();
const INV_REFERENCE = new Map<string, unknown>();

export function createReference<T>(id: string, value: T): T {
  REFERENCE.set(value, id);
  INV_REFERENCE.set(id, value);
  return value;
}

export function hasReferenceID<T>(value: T): boolean {
  return REFERENCE.has(value);
}

export function hasReference(id: string): boolean {
  return INV_REFERENCE.has(id);
}

export function getReferenceID<T>(value: T): string {
  if (hasReferenceID(value)) {
    return REFERENCE.get(value)!;
  }
  throw new SerovalMissingReferenceError(value);
}

export function getReference<T>(id: string): T {
  if (hasReference(id)) {
    return INV_REFERENCE.get(id) as T;
  }
  throw new SerovalMissingReferenceForIdError(id);
}

if (typeof globalThis !== 'undefined') {
  Object.defineProperty(globalThis, REFERENCES_KEY, {
    value: INV_REFERENCE,
    configurable: true,
    writable: false,
    enumerable: false,
  });
} else if (typeof window !== 'undefined') {
  Object.defineProperty(window, REFERENCES_KEY, {
    value: INV_REFERENCE,
    configurable: true,
    writable: false,
    enumerable: false,
  });
} else if (typeof self !== 'undefined') {
  Object.defineProperty(self, REFERENCES_KEY, {
    value: INV_REFERENCE,
    configurable: true,
    writable: false,
    enumerable: false,
  });
} else if (typeof global !== 'undefined') {
  Object.defineProperty(global, REFERENCES_KEY, {
    value: INV_REFERENCE,
    configurable: true,
    writable: false,
    enumerable: false,
  });
}
