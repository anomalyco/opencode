import { assertHostWorkosForUniverE2e } from "./assert-univer-workos-env"

export default async function globalSetup() {
  const raw = process.env.PLAYWRIGHT_E2E_INFRA?.trim()
  if (!raw) return
  if (!raw.split(",").some((s) => s.trim() === "univer")) return
  assertHostWorkosForUniverE2e()
}
