import { fixedSessionResolver } from "@veritly/auth-shared"

export const user = "univer-compat-test-user"
export const auth = fixedSessionResolver(user)
/** OpenCode `directory` / project id scope for S3 keys in tests. */
export const proj = "compat-test-project"
export const projHdr = { "x-veritly-project-id": proj } as const
