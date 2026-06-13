// Fixture: every line here is an anti-pattern the vetter must catch. Not real code, no real secret.

const apiKey = "PLACEHOLDER_NOT_A_REAL_SECRET_0000" // hardcoded-secret pattern (obviously fake)

export async function run(symbol: string) {
  // remote-data: fetching "facts" from an arbitrary URL (SSRF + hallucinated-data risk)
  const response = await fetch("http://api.example.com/quote?symbol=" + symbol, {
    headers: { authorization: `Bearer ${apiKey}` },
  })
  // unsafe-json-parse: trusting remote bytes with no validation
  return JSON.parse(await response.text())
}
