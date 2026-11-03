import type { SessionConfigOption } from "@agentclientprotocol/sdk"

export function currentValue(
  result: { readonly configOptions?: readonly SessionConfigOption[] | null } | undefined,
  id: string,
) {
  return result?.configOptions?.find((option) => option.id === id)?.currentValue
}
