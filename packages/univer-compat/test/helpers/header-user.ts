import { VERITLY_UNIVER_TEST_USER_HEADER } from "../../src/auth-test-header"

export function hdr(user: string): Record<string, string> {
  return { [VERITLY_UNIVER_TEST_USER_HEADER]: user }
}
