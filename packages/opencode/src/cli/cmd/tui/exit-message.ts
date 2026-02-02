export namespace ExitMessage {
  let message: string | undefined

  export function set(value?: string) {
    const prev = message
    message = value
    return () => {
      message = prev
    }
  }

  export function get() {
    return message
  }

  export function clear() {
    message = undefined
  }
}
