import { useKeyboard } from "@opentui/solid"
export function test() {
  useKeyboard((evt) => {
    console.log(evt.eventType)
    console.log(evt.name)
  })
}
