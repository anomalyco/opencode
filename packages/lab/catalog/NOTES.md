# Notes

This project started as a prototype inside the experiments repo and now lives as a standalone catalog for reviewing OpenCode terminal states.

The durable idea being tested:

- Source terminal frames are real PNG screenshots produced by a scripted OpenCode Drive run.
- The canonical artifact is a normalized terminal frame. Canvas, SVG, and PNG are derived renderers.
- `public/drive-captures.json` is the portable capture manifest. `public/catalog.json` combines those frames with categories and scripted flows; it contains no hand-rendered terminal spans.
- The application shell uses the actual dark `kit-ui` stylesheet from the sibling Life Hub project. Terminal pixels remain untouched inside each capture.
- The current capture suite focuses on reachable V2 modals: command, model, agent, integration, theme, MCP, status, debug, help, pair, session, skill, and permission surfaces.
- The browser is intentionally one image-forward workflow: browse the contact sheet, open a frame, navigate with the keyboard, and draw critique regions directly over the capture.
- Catalog metadata is faceted rather than hierarchical: screen types describe the UI shape, features describe the product area, and states describe conditions such as empty, error, or confirmation.

Current limitation: backend-triggered, workspace, OAuth, update, and unreachable V2 dialogs need focused fixture scripts rather than this first global-modal pass. Drive feedback is recorded in Organizer note `4019ad1c`.

Verdict placeholder: keep the winning workflow, then rewrite it as production code and remove this folder.
