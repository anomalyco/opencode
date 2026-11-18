import { Input, all } from "@pulumi/pulumi";

export module Hint {
  let hints = {} as Record<string, Input<string>>;
  export function reset() {
    hints = {};
  }

  export function register(name: Input<string>, hint: Input<string>) {
    all([name]).apply(([name]) => {
      hints[name] = hint;
    });
  }

  export function list() {
    return hints;
  }
}
