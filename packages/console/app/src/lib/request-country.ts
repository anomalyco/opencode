export function countryFromRequest(request: Request | undefined) {
  if (!request) return undefined
  const cloudflareRequest = request as Request & { cf?: { country?: string } }
  return cloudflareRequest.cf?.country ?? request.headers.get("cf-ipcountry") ?? undefined
}
