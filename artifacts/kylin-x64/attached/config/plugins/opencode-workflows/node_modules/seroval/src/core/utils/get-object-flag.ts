import { SerovalObjectFlags } from '../constants';

export function getObjectFlag(obj: unknown): SerovalObjectFlags {
  if (Object.isFrozen(obj)) {
    return SerovalObjectFlags.Frozen;
  }
  if (Object.isSealed(obj)) {
    return SerovalObjectFlags.Sealed;
  }
  if (Object.isExtensible(obj)) {
    return SerovalObjectFlags.None;
  }
  return SerovalObjectFlags.NonExtensible;
}
