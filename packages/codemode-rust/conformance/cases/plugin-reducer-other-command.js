// @bindings {"event": {"type": "command", "name": "git.log"}, "state": {"runs": 2}}
if (event.type === "init") return { state: { runs: 0 }, commands: [{ name: "git.status", key: "ctrl+g" }] }
if (event.type === "command" && event.name === "git.status") { const s = await tools.git.status(); return { state: { runs: state.runs + 1 }, slots: { statusbar: { text: s.branch + (s.dirty ? " *" : "") } } } }
return { state }
