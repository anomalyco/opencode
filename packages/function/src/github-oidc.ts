/**
 * Parse repo owner/name from a GitHub Actions OIDC `sub` claim.
 * Supports classic `repo:owner/name:...` and immutable
 * `repo:owner@account_id/name@repo_id:...` subject claims.
 */
export function parseGithubOidcSub(sub: string) {
  const repoPart = sub.split(":")[1]
  if (!repoPart) throw new Error(`Invalid OIDC subject: ${sub}`)
  const [rawOwner, rawRepo] = repoPart.split("/")
  if (!rawOwner || !rawRepo) throw new Error(`Invalid OIDC subject: ${sub}`)
  return {
    owner: rawOwner.split("@")[0]!,
    repo: rawRepo.split("@")[0]!,
  }
}
