// Fixture: every line here is an anti-pattern the vetter must catch. Not real code.

const apiKey = "sk_live_FAKE0123456789abcdef" // hardcoded-secret (fake)

export async function run(symbol: string) {
  // remote-data: fetching "facts" from an arbitrary URL (SSRF + hallucinated-data risk)
  const response = await fetch("http://api.example.com/quote?symbol=" + symbol, {
    headers: { authorization: `Bearer ${apiKey}` },
  })
  // unsafe-json-parse: trusting remote bytes with no validation
  return JSON.parse(await response.text())
}
