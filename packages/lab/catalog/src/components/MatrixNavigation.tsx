import type { Screen } from "../catalog"
import { label, screenFamily } from "../catalog"

interface MatrixNavigationProps {
  readonly screens: ReadonlyArray<Screen>
}

export function MatrixNavigation({ screens }: MatrixNavigationProps) {
  const categories = Array.from(
    screens.reduce((counts, screen) => {
      const family = screenFamily(screen)
      return counts.set(family, (counts.get(family) ?? 0) + 1)
    }, new Map<string, number>()),
  )
  if (categories.length < 2) return undefined

  return (
    <nav className="matrix-navigation" aria-label="Browse matrix">
      <div className="matrix-categories" aria-label="Screen families">
        <span className="matrix-label">Jump to</span>
        {categories.map(([category, count]) => (
          <a key={category} href={`#family-${category}`}>
            {label(category)} <small>{count}</small>
          </a>
        ))}
      </div>
    </nav>
  )
}
