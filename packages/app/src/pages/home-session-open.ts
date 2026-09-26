export function shouldOpenSessionInBackground(input: {
  button: number
  mac: boolean
  meta: boolean
  ctrl: boolean
  shift: boolean
  alt: boolean
}) {
  if (input.button === 1) return true
  if (input.button !== 0) return false
  if (input.shift || input.alt) return false
  if (input.mac) return input.meta && !input.ctrl
  return input.ctrl && !input.meta
}
