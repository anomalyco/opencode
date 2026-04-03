export async function GET() {
  const response = await fetch(
    "https://raw.githubusercontent.com/f5xc-salesdemos/xcsh/refs/heads/dev/packages/sdk/openapi.json",
  )
  const json = await response.json()
  return json
}
