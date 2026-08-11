export interface Registration {
  readonly dispose: () => Promise<void>
}

// Mirrors the Effect flavor's HookSpec; Promise hooks signal failure by throwing, so the
// declared failure channel documents which throws are meaningful rather than typing them.
export interface HookSpec {
  readonly event: unknown
  readonly failure: unknown
}

export type Hooks<Spec extends Record<keyof Spec, HookSpec>> = <Name extends keyof Spec>(
  name: Name,
  callback: (input: Spec[Name]["event"]) => Promise<void> | void,
) => Promise<Registration>

export type Transform<Input> = (callback: (input: Input) => void) => Promise<Registration>
