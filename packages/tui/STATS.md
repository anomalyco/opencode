# Stats Smoke Test

From the worktree root:

```sh
bun run dev:stats-tui
```

Type `/stats` in the prompt and select **Usage statistics**. You can also find it in the command palette.

The launcher creates a new temporary SQLite database with two years of synthetic session/message rows, then starts a private server and the development TUI. The fixture ramps up usage over time, with quieter weekends, vacation gaps, a long streak, and activity through today. Stats are fetched through the real API. It uses separate config, cache, state, and data directories; it does not replace the live background service or use your existing sessions. Seeding does not call any models. The printed temporary directory contains `stats.db` and is retained for inspection after exit.

The poster opens with all-time tokens and the full two-year totals. Press `tab` to switch between **All time** and **This year**. Its header shows the date range. The heatmap currently caps its display at the latest 53 weeks (fewer on narrow terminals).

These are synthetic read-model fixtures for exploring stats, not sessions intended for resuming model work. Each launch starts fresh, so there is no reset step.

For light mode:

```sh
bun run dev:stats-tui --light
```

For a synthetic high-volume fixture with 50x token usage (roughly 1.2T tokens across two years):

```sh
bun run dev:stats-tui --max
```

`--max` can be combined with `--light`. It only changes the isolated demo data.

## Controls

Click the date range or press `tab` to switch. Controls are intentionally invisible on the poster; there are no keybind hints or range-toggle command-palette entries.

- `tab`: show this year / show all time.
- `esc`: return to the previous screen.
- `ctrl+c`: normal TUI exit.

Try a wide terminal (112 x 38) and a narrow one (48 x 30). Narrow views show the latest weeks and label the cropped activity range. The heatmap measures daily steps, as in the CLI; totals cover the selected range. Reopening `/stats` loads a new snapshot.

## Fixture Story

To explore the production poster with a fixed fixture and an empty-state toggle:

```sh
OPENCODE_STORY=stats bun run dev:live
```

This uses the existing live server connection but the story's stats stay local. `e` toggles empty activity, `r` resets, and `esc` returns to storybook.
