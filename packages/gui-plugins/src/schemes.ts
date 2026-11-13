import type { CustomScheme } from "electron"

export const previewScheme = "oc-preview"

// Registered before app.ready. Only the owning plugin's partition installs a handler. In particular the scheme
// is not local, cannot bypass CSP, and does not support service workers or persistent background registrations.
export const schemes: CustomScheme[] = [
  { scheme: previewScheme, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]
