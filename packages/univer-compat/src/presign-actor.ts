import { requireRequestUserId } from "./request-user"
import { requireRequestProjectId } from "./request-project"

/** Memory-exchange presign slots match this actor string (user + project). */
export function exchangePresignActor(): string {
  return `${requireRequestUserId()}\0${requireRequestProjectId()}`
}
