export type PluginOptions = Readonly<Record<string, any>>

export type ReadonlyDeep<T> = T extends (...args: any[]) => any
  ? T
  : T extends ReadonlyMap<infer K, infer V>
    ? ReadonlyMap<ReadonlyDeep<K>, ReadonlyDeep<V>>
    : T extends readonly (infer U)[]
      ? readonly ReadonlyDeep<U>[]
      : T extends object
        ? { readonly [K in keyof T]: ReadonlyDeep<T[K]> }
        : T
