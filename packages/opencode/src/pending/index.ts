export namespace Pending {
  export class RejectedError extends Error {
    constructor(message = "The user rejected this request") {
      super(message)
    }
  }

  export type Entry<Info, ResolveValue = void> = {
    info: Info
    resolve: (value: ResolveValue) => void
    reject: (e: any) => void
  }
}
