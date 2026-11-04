declare module "node:ffi" {
  type Signature = {
    readonly arguments?: readonly string[]
    readonly return?: string
  }

  type ForeignFunction = (...args: ReadonlyArray<unknown>) => number | bigint

  export function dlopen(
    path: string,
    definitions: Readonly<Record<string, Signature>>,
  ): {
    readonly lib: { close(): void }
    readonly functions: Readonly<Record<string, ForeignFunction>>
  }

  export function getInt32(pointer: number | bigint, offset?: number): number
}
