export async function moveSessionLocation(input: {
  selection: string | string[] | null
  moving: boolean
  setMoving: (moving: boolean) => void
  move: (directory: string) => Promise<unknown>
  failed: (error: unknown) => void
}) {
  const directory = Array.isArray(input.selection) ? input.selection[0] : input.selection
  if (!directory || input.moving) return false

  input.setMoving(true)
  return input
    .move(directory)
    .then(() => true)
    .catch((error) => {
      input.failed(error)
      return false
    })
    .finally(() => input.setMoving(false))
}
