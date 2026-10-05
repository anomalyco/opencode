// The Go endpoint bills the Zen balance only as the opt-in "Use balance" overflow. That setting is
// cleared when the Go subscription ends, so a cancelled subscriber is never billed through Go.
export function allowsGoBalanceFallback(lite: { useBalance?: boolean } | null) {
  return lite?.useBalance === true
}
