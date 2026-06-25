// Mammouth Code manages its own updates, so the upstream opencode auto-update
// check is intentionally a no-op (suppresses all update-available notifications).
export async function upgrade() {
  return
}
