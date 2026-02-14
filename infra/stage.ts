export const domain = (() => {
  if ($app.stage === "production") return "cyberstrike.io"
  if ($app.stage === "dev") return "dev.cyberstrike.io"
  return `${$app.stage}.dev.cyberstrike.io`
})()

export const zoneID = "430ba34c138cfb5360826c4909f99be8"

new cloudflare.RegionalHostname("RegionalHostname", {
  hostname: domain,
  regionKey: "us",
  zoneId: zoneID,
})

export const shortDomain = (() => {
  if ($app.stage === "production") return "opncd.ai"
  if ($app.stage === "dev") return "dev.opncd.ai"
  return `${$app.stage}.dev.opncd.ai`
})()
