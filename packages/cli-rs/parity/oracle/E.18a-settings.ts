// E.18a helper, driven by crates/tui/tests/all/settings.rs: prints the TS `settings` table of
// packages/tui/src/component/dialog-config.tsx as JSON, every field the Rust `SETTINGS` copies. `format` becomes
// its output at min, min + step, the default, and max. Run it from parity/ so the TUI preloads apply.
const { settings } = await import("../../../tui/src/component/dialog-config.tsx")

console.log(
  JSON.stringify(
    settings.map((setting: Record<string, any>) => ({
      title: setting.title,
      category: setting.category,
      path: setting.path,
      description: setting.description,
      default: setting.default,
      values: setting.values ?? [],
      labels: setting.labels ?? [],
      range:
        setting.step === undefined
          ? null
          : {
              step: setting.step,
              min: setting.min,
              max: setting.max,
              formatted: [setting.min, setting.min + setting.step, setting.default, setting.max].map(
                (value: number) => [value, setting.format?.(value) ?? String(value)],
              ),
            },
      keywords: setting.keywords ?? [],
    })),
  ),
)
