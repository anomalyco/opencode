declare module "node:ffi" {
  type Signature = {
    readonly arguments?: readonly string[]
    readonly return?: string
  }

  type ForeignFunction = (...args: ReadonlyArray<unknown>) => number | bigint

  export function dlopen(
    path: string,
    definitions: Readonly<Record<string, Signature>>,
  ): { readonly functions: Readonly<Record<string, ForeignFunction>> }
}
