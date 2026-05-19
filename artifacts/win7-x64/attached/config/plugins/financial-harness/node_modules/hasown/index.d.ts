declare function hasOwn<O, K extends PropertyKey>(o: O, p: K): p is K & keyof O;
declare function hasOwn<O, K extends PropertyKey, V = unknown>(o: O, p: K): o is O & Record<K, V>;

export = hasOwn;
