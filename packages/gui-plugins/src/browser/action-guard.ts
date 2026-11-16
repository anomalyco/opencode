/** Input protection for a page-triggered bar. Make a new guard for each presentation/token, not each render.
 * A click must finish a press on this same control that started after the bar settled. */
export function actionGuard(shown: number) {
  const ready = shown + 500
  let pressed: EventTarget | null = null

  return {
    press(event: Pick<Event, "isTrusted" | "timeStamp" | "currentTarget">, repeat = false) {
      pressed = event.isTrusted && !repeat && event.timeStamp >= ready ? event.currentTarget : null
    },
    cancel() {
      pressed = null
    },
    accept(event: Pick<Event, "isTrusted" | "timeStamp" | "currentTarget">) {
      const allowed = !!pressed && pressed === event.currentTarget && event.isTrusted && event.timeStamp >= ready
      pressed = null

      return allowed
    },
  }
}
