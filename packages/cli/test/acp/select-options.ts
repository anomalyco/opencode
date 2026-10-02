import type { SessionConfigOption, SessionConfigSelectOption } from "@agentclientprotocol/sdk"

type SelectOption = Extract<SessionConfigOption, { type: "select" }>

export function selectConfigOption(options: SessionConfigOption[] | null | undefined, id: string) {
  return options?.find((option): option is SelectOption => option.id === id && option.type === "select")
}

export function requireSelectOption(options: SessionConfigOption[] | null | undefined, id: string) {
  const option = selectConfigOption(options, id)
  if (!option) throw new Error(`Missing ACP config option: ${id}`)
  return option
}

export function flattenSelectOptions(option: SelectOption) {
  return option.options.flatMap((item): SessionConfigSelectOption[] => ("value" in item ? [item] : item.options))
}

export function selectValues(options: SessionConfigOption[] | null | undefined, id: string) {
  return flattenSelectOptions(requireSelectOption(options, id)).map((option) => option.value)
}

export function alternateValue(option: SelectOption) {
  const value = flattenSelectOptions(option).find((item) => item.value !== option.currentValue)?.value
  if (!value) throw new Error(`ACP config option ${option.id} has no alternate value`)
  return value
}

export function currentValue(
  result: { readonly configOptions?: readonly SessionConfigOption[] | null } | undefined,
  id: string,
) {
  return result?.configOptions?.find((option) => option.id === id)?.currentValue
}
