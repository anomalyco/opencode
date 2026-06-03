export function runUpdateAndRestart(
  updateAndRestart: (() => Promise<void>) | undefined,
  setInstalling: (installing: boolean) => void,
) {
  if (!updateAndRestart) return
  setInstalling(true)
  void updateAndRestart()
    .catch(() => undefined)
    .finally(() => setInstalling(false))
}
