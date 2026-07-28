export interface Registration {
  readonly dispose: () => Promise<void>
}

export type Hooks<Spec> = <Name extends keyof Spec>(
  name: Name,
  callback: (input: Spec[Name]) => Promise<void> | void,
) => Promise<Registration>

export type Transform<Input> = (callback: (input: Input) => void) => Promise<Registration>
