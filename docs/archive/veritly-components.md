# Veritly Components (archived)

SolidJS components for MDX rendering with interactive charts. Removed from the monorepo to fix typecheck; not needed atm.

## Architecture

- **SolidJS + ApexCharts** — chart components (`Chart`, `LineChart`, `BarChart`, `RadarChart`, `ChartAreaInteractive`) use solid-js signals/effects with lazy `apexcharts` import and cleanup via `onCleanup`.
- **MDX rendering** — `MDXContent` uses `@mdx-js/mdx` `evaluate()` + `remark-gfm` to compile MDX strings into SolidJS components at runtime, injecting custom chart components.
- **`index.tsx`** re-exports chart types + `MDXContent` / `defaultComponents`.

## Key source files (were in `packages/veritly-components/src/`)

| File              | Purpose                                                                                                                                             |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `chart.tsx`       | `Chart`, `LineChart`, `BarChart`, `RadarChart`, `ChartAreaInteractive` + types (`ChartData`, `ChartDataset`, `ChartType`, `AreaPoint`, `AreaRange`) |
| `mdx-content.tsx` | `MDXContent`, `MDXComponents`, `MDXContentProps`, `defaultComponents`, `compileMdx()`                                                               |
| `index.tsx`       | Barrel re-exports                                                                                                                                   |

## Chart component API

```tsx
<Chart
  data={{
    labels: ["Jan", "Feb", "Mar"],
    datasets: [
      { label: "Sales", data: [10, 20, 30], color: "#06b6d4" },
      { label: "Revenue", data: [15, 25, 35] },
    ],
  }}
  type="line"
/>
```

Types: `ChartType = "line" | "bar" | "radar"`, `AreaRange = "7d" | "30d" | "90d"`.

Data can be passed as a JSON string or object (auto-parsed via `parse()`).

## MDXContent component

```tsx
<MDXContent
  content="# Hello\n\n<Chart data={data} type=\"line\" />"
  components={defaultComponents}
/>
```

Internally: `evaluate(content, { ...runtime, remarkPlugins: [remarkGfm] })` → SolidJS `Component`.

## Dependencies

- `solid-js`, `apexcharts`, `@mdx-js/mdx`, `remark-gfm`, `vfile`
- devDeps: `@types/mdx`, `@types/bun`, `typescript`

## tsconfig specifics

```json
{
  "compilerOptions": {
    "jsx": "preserve",
    "jsxImportSource": "solid-js",
    "types": ["vite/client", "bun", "@types/mdx"]
  }
}
```

The `vite/client` type caused the typecheck failure (type def not installed). Fix: either `bun add -d vite` or remove `"vite/client"` from `types` if not using Vite-specific globals.
