export type AuthConfig = {
  enabled?: boolean
  pam?: {
    service?: string
  }
}

export type Filesystem = {
  exists: (path: string) => Promise<boolean>
}

export type Logger = {
  info: (message: string, data?: unknown) => void
}

export type MissingPamErrorFactory = (input: { service: string; path: string }) => Error

export type ValidateAuthConfigInput = {
  auth?: AuthConfig
  filesystem: Filesystem
  log?: Logger
  onMissingPam?: MissingPamErrorFactory
}

export async function validateAuthConfig(input: ValidateAuthConfigInput) {
  if (!input.auth?.enabled) return
  const pamService = input.auth.pam?.service ?? "opencode"
  const pamPath = `/etc/pam.d/${pamService}`
  const pamExists = await input.filesystem.exists(pamPath)
  if (pamExists) {
    input.log?.info("PAM service file validated", { service: pamService, path: pamPath })
    return
  }
  const error = input.onMissingPam?.({ service: pamService, path: pamPath })
  if (error) throw error
  throw new Error(`PAM service file not found at ${pamPath}`)
}

export function registerAuthRoutes<T>(authRoutes: () => T): T {
  return authRoutes()
}
