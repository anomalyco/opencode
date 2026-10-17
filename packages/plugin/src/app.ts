export interface App {
  readonly name: string
  readonly version: string
  readonly channel: string
  readonly server?: {
    readonly url: string
    readonly password: string
  }
}
