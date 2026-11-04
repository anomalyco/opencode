# TUI Experiments

- Temporary, opt-in UI experiments belong in the `experiments` registry in `src/component/dialog-experiments.tsx`, with behavior gated by the matching `config.experimental` key.
- The Experiments framework is permanent infrastructure. Keep the registry, dialog, settings persistence, toggle handling, and UI entry point even when there are no active experiments.
- Graduating an experiment means removing only its registry entry and feature-specific gate, making that feature's behavior unconditional. Abandoning an experiment means removing its entry, gate, and experimental behavior.
- Do not remove or simplify away the reusable Experiments infrastructure because the registry is empty. An empty registry is intentional and ready for future experiments, not dead code.
