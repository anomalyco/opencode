import { Select } from "@kobalte/core/select"
import { createMemo } from "solid-js"

export type BreadcrumbSelectOption = {
  href: string
  label: string
  value: string
}

export function BreadcrumbSelect(props: {
  ariaLabel: string
  current?: boolean
  label: string
  options: BreadcrumbSelectOption[]
  value: string
  variant: "lab" | "model"
}) {
  const selected = createMemo(() => props.options.find((option) => option.value === props.value) ?? null)

  return (
    <Select<BreadcrumbSelectOption>
      data-component="stats-breadcrumb-select"
      data-variant={props.variant}
      options={props.options}
      optionValue="value"
      optionTextValue="label"
      value={selected()}
      placeholder={props.label}
      disallowEmptySelection
      closeOnSelection
      shouldFocusWrap
      placement="bottom"
      gutter={8}
      sameWidth={false}
      itemComponent={(itemProps) => (
        <Select.Item
          item={itemProps.item}
          data-slot="stats-breadcrumb-select-option"
          data-current={itemProps.item.rawValue.value === props.value ? "true" : undefined}
        >
          <Select.ItemLabel>{itemProps.item.rawValue.label}</Select.ItemLabel>
        </Select.Item>
      )}
      onChange={(option) => {
        if (!option || option.value === props.value) return
        window.location.assign(option.href)
      }}
    >
      <Select.Trigger
        data-slot="stats-breadcrumb-select-trigger"
        data-current={props.current ? "true" : undefined}
        data-variant={props.variant}
        aria-label={props.ariaLabel}
        aria-current={props.current ? "page" : undefined}
      >
        <Select.Value<BreadcrumbSelectOption> data-slot="stats-breadcrumb-select-value">
          {(state) => <span>{state.selectedOption()?.label ?? props.label}</span>}
        </Select.Value>
        <Select.Icon data-slot="stats-breadcrumb-select-icon">
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M5 6.5L8 9.5L11 6.5" fill="none" stroke="currentColor" />
          </svg>
        </Select.Icon>
      </Select.Trigger>
      <Select.HiddenSelect />
      <Select.Content data-component="stats-breadcrumb-select-content" data-variant={props.variant}>
        <Select.Listbox data-slot="stats-breadcrumb-select-listbox" />
      </Select.Content>
    </Select>
  )
}
