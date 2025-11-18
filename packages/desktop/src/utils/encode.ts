export function base64Encode(value: string) {
  return btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "")
}

export function base64Decode(value: string) {
  return atob(value.replace(/-/g, "+").replace(/_/g, "/"))
}
