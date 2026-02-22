import { Registry, type PolicyInput } from "@finny-ai/registry"

export async function guard(input: PolicyInput) {
  const res = await Registry.policies.check(input)
  if (res.allowed) return
  const msg = res.reason ?? "Action blocked by policy"
  throw new Error(msg)
}
