# Stats Smoke Test

From the worktree root:

```sh
bun run dev:stats-tui
```

Type `/stats` in the prompt and select **Usage statistics**. You can also find it in the command palette.

The launcher creates a new temporary SQLite database with two years of synthetic session/message rows, then starts a private server and the development TUI. The fixture ramps up usage over time, with quieter weekends, vacation gaps, a long streak, and activity through today. Stats are fetched through the real API. It uses separate config, cache, state, and data directories; it does not replace the live background service or use your existing sessions. Seeding does not call any models. The printed temporary directory contains `stats.db` and is retained for inspection after exit.

The poster shows **this year only**, from January 1 through today. The header displays the date range. Older seeded history stays in the demo database but is not included in the poster. Narrow terminals show the latest weeks and label the cropped activity range.

These are synthetic read-model fixtures for exploring stats, not sessions intended for resuming model work. Each launch starts fresh, so there is no reset step.

For light mode:

```sh
bun run dev:stats-tui --light
```

For a synthetic high-volume fixture averaging roughly 370M tokens per active day this year (about 67B year-to-date in the September fixture), with varying daily usage and lighter prior years:

```sh
bun run dev:stats-tui --max
```

`--max` can be combined with `--light`. It only changes the isolated demo data.

## Controls

There are no range controls, footer keybind hints, hidden toggles, or range-toggle command-palette entries.

- `esc`: return to the previous screen.
- `ctrl+c`: normal TUI exit.

Try a wide terminal (112 x 38) and a narrow one (48 x 30). The heatmap measures daily steps, as in the CLI; totals cover this year. Reopening `/stats` loads a new snapshot.

## Colors

The heatmap uses `text.emphasis`, the theme token for non-interactive emphasis. Native V2 themes default to `$hue.accent.600` in light mode and `$hue.accent.400` in dark mode; migrated V1 themes retain their original accent color. Custom themes can override `text.emphasis` without changing action or status colors. The token headline, labels, and logo stay neutral.

## Fixture Story

To explore the production poster with a fixed fixture and an empty-state toggle:

```sh
OPENCODE_STORY=stats bun run dev:live
```

This uses the existing live server connection but the story's stats stay local. `e` toggles empty activity, `r` resets, and `esc` returns to storybook.
