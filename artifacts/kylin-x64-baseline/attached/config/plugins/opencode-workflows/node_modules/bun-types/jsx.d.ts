export {};

type ReactElement = typeof globalThis extends { React: infer React }
  ? React extends { createElement(...args: any): infer R }
    ? R
    : never
  : unknown;

export namespace JSX {
  export type Element = ReactElement;
}
