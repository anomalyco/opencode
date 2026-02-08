/**
 * Organization roles from Clerk JWT
 */
export type OrganizationRole = "admin" | "member"

export interface AuthenticatedIdentity {
  ok: true
  token: string
  userId: string
  organizationId: string
  role: OrganizationRole
}

export interface UnauthenticatedIdentity {
  ok: false
  status: 401 | 403 | 500
  error: string
}

export type Identity = AuthenticatedIdentity | UnauthenticatedIdentity

/**
 * Role hierarchy check
 * admin > member
 */
export function hasRole(userRole: OrganizationRole, requiredRole: OrganizationRole): boolean {
  const hierarchy: OrganizationRole[] = ["member", "admin"]
  return hierarchy.indexOf(userRole) >= hierarchy.indexOf(requiredRole)
}
