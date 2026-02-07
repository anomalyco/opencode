import { createSignal } from "solid-js"
import { Dropdown } from "~/component/dropdown"
import "./role-dropdown.css"

interface RoleOption {
  value: string
  label: string
  description: string
}

interface RoleDropdownProps {
  value: string
  options: RoleOption[]
  onChange: (value: string) => void
}

export function RoleDropdown(props: RoleDropdownProps) {
  const [open, setOpen] = createSignal(false)
  const selected = () => props.options.find((option) => option.value === props.value)?.label ?? props.value

  const handleSelect = (value: string) => {
    props.onChange(value)
    setOpen(false)
  }

  return (
    <Dropdown trigger={selected()} open={open()} onOpenChange={setOpen} class="role-dropdown">
      <>
        {props.options.map((option) => (
          <button
            data-slot="role-item"
            data-selected={props.value === option.value}
            type="button"
            onClick={() => handleSelect(option.value)}
          >
            <div>
              <strong>{option.label}</strong>
              <p>{option.description}</p>
            </div>
          </button>
        ))}
      </>
    </Dropdown>
  )
}
