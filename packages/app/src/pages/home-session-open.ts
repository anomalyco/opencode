export function shouldOpenSessionInBackground(input: {
  mac: boolean
  meta: boolean
  ctrl: boolean
  shift: boolean
  alt: boolean
}) {
  if (input.shift || input.alt) return false
  if (input.mac) return input.meta && !input.ctrl
  return input.ctrl && !input.meta
}
