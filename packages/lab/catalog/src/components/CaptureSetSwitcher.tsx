import type { Variant } from "../catalog"

interface CaptureSetSwitcherProps {
  readonly sets: ReadonlyArray<Variant>
  readonly active: Variant
  readonly onSelect: (id: string) => void
}

export function CaptureSetSwitcher({ sets, active, onSelect }: CaptureSetSwitcherProps) {
  return (
    <label className="variant-switcher" title="Switch theme">
      <select aria-label="Select theme" value={active.id} onChange={(event) => onSelect(event.target.value)}>
        {sets.map((set) => (
          <option key={set.id} value={set.id}>
            {set.label}
          </option>
        ))}
      </select>
      <span className="variant-hint" aria-hidden="true">
        Theme
      </span>
      <span className="variant-name" aria-hidden="true">
        {active.label}
      </span>
      <span className="variant-chevron" aria-hidden="true">
        ▾
      </span>
    </label>
  )
}
