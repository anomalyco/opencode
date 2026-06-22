export interface Registration {
  readonly dispose: () => Promise<void>
}

export type Hooks<Spec> = {
  readonly [Name in keyof Spec]: (callback: (input: Spec[Name]) => Promise<void> | void) => Promise<Registration>
}
