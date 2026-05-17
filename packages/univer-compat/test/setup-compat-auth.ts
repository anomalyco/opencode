import { fixedSessionResolver } from "@veritly/auth-shared"

export const user = "univer-compat-test-user"
export const auth = fixedSessionResolver(user)
