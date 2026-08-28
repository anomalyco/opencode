import { Effect, Equal, Hash, LayerMap, RcMap } from "effect"
import type { Instance } from "../instance.js"
import type { InstanceMap } from "../instance-map.js"
import { Location } from "../location.js"

/** The first acquisition retains construction input; only the key determines sharing. */
export class Entry implements Equal.Equal {
  constructor(
    readonly key: Instance.Key,
    readonly location: Location.Ref,
  ) {}

  [Hash.symbol]() {
    return Hash.hash(this.key)
  }

  [Equal.symbol](other: unknown) {
    return other instanceof Entry && this.key === other.key
  }

  static forLocation(ref: Location.Ref) {
    const location = Location.canonical(ref)
    return new Entry(Location.instanceKey(location), location)
  }
}

export function fromMap(map: LayerMap.LayerMap<Entry, Instance.Services, Instance.Error>): InstanceMap.Interface {
  return {
    get: (ref) => map.get(Entry.forLocation(ref)),
    contextEffect: (ref) => map.contextEffect(Entry.forLocation(ref)),
    invalidate: (ref) => map.invalidate(Entry.forLocation(ref)),
    has: (ref) => RcMap.has(map.rcMap, Entry.forLocation(ref)),
    forSession: (session) => map.get(Entry.forLocation(session.location)),
    entries: RcMap.keys(map.rcMap).pipe(
      Effect.map((entries) => Array.from(entries, (entry) => ({ key: entry.key, location: entry.location }))),
    ),
  }
}
