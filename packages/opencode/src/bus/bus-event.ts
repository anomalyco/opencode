import type { ZodType } from "zod"

export interface Event<T extends string = string, P = unknown> {
  readonly type: T
  readonly schema: ZodType<P>
}

export namespace BusEvent {
  export function define<T extends string, P>(type: T, schema: ZodType<P>): Event<T, P> {
    return { type, schema }
  }
}
