const MUSE_SPARK_BLOCKED_COUNTRIES = new Set([
  "AD",
  "AF",
  "AT",
  "AU",
  "BE",
  "BG",
  "BR",
  "BY",
  "CA",
  "CH",
  "CN",
  "CU",
  "CY",
  "CZ",
  "DE",
  "DK",
  "EE",
  "EH",
  "ER",
  "ES",
  "ET",
  "FI",
  "FR",
  "GB",
  "GR",
  "HK",
  "HR",
  "HT",
  "HU",
  "IE",
  "IQ",
  "IR",
  "IS",
  "IT",
  "KH",
  "KP",
  "KR",
  "LI",
  "LT",
  "LU",
  "LV",
  "LY",
  "MC",
  "MM",
  "MO",
  "MT",
  "NI",
  "NL",
  "NO",
  "PK",
  "PL",
  "PT",
  "RO",
  "RU",
  "SE",
  "SI",
  "SK",
  "SM",
  "SO",
  "SY",
  "VA",
  "VE",
])

export function countryFromRequest(request: Request | undefined) {
  if (!request) return undefined
  const cloudflareRequest = request as Request & { cf?: { country?: string } }
  return cloudflareRequest.cf?.country ?? request.headers.get("cf-ipcountry") ?? undefined
}

export function isModelCountryRestricted(model: string, country: string | undefined) {
  return (
    ["muse-spark-1.2-contributor", "muse-spark-1.2-contributor-free"].includes(model) &&
    country !== undefined &&
    MUSE_SPARK_BLOCKED_COUNTRIES.has(country.toUpperCase())
  )
}
