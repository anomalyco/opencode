import { ErrorBoundary, type ValidComponent } from "solid-js"
import { Dynamic } from "solid-js/web"

function fn(value: unknown): value is (...args: never[]) => unknown {
  return typeof value === "function"
}

function pick(mod: Record<string, unknown>, name?: string) {
  if (name && fn(mod[name])) return mod[name]
  if (fn(mod.default)) return mod.default

  const preferred = Object.keys(mod)
    .filter((k) => k[0] && k[0] === k[0].toUpperCase())
    .find((k) => fn(mod[k]))
  if (preferred) return mod[preferred]

  const first = Object.keys(mod).find((k) => fn(mod[k]))
  if (first) return mod[first]

  return () => {
    return (
      <div data-component="storybook-missing">
        <div>Missing component export.</div>
        <div style="opacity:0.7;font-size:12px">Exports: {Object.keys(mod).join(", ") || "(none)"}</div>
      </div>
    )
  }
}

export function create(input: {
  title: string
  mod: Record<string, unknown>
  name?: string
  args?: Record<string, unknown>
}) {
  const component = pick(input.mod, input.name) as unknown as ValidComponent

  return {
    meta: {
      title: input.title,
      component,
    },
    Basic: {
      args: input.args ?? {},
      render: (args: Record<string, unknown>) => {
        return (
          <ErrorBoundary
            fallback={(err) => {
              return (
                <pre data-component="storybook-error" style="white-space:pre-wrap">
                  {String(err)}
                </pre>
              )
            }}
          >
            <Dynamic component={component} {...args} />
          </ErrorBoundary>
        )
      },
    },
  }
}
