function init(data) {
  return { picked: null, note: "" }
}

function view(state, data) {
  return ui.column({ gap: 2 }, [
    ui.text(data.title, { style: "title" }),
    ui.row(
      { gap: 2, align: "start", wrap: true },
      data.options.map((option, index) =>
        ui.card({ id: "option:" + index, selected: state.picked === index }, [
          option.images.length === 1
            ? ui.image(option.images[0], { alt: option.label, aspect: 4 / 3 })
            : ui.carousel(
                {},
                option.images.map((src, page) =>
                  ui.image(src, {
                    alt: option.label + " (" + (page + 1) + "/" + option.images.length + ")",
                    aspect: 4 / 3,
                  }),
                ),
              ),
          ui.row({ gap: 1, align: "center", wrap: true }, [
            ui.text(option.label, { style: "body" }),
            option.recommended && ui.text("(Recommended)", { style: "caption", tone: "accent" }),
          ]),
          option.note && ui.text(option.note, { style: "caption", tone: "muted" }),
        ]),
      ),
    ),
    data.allowNote !== false && ui.input("note", state.note, { label: "Note", placeholder: "Add a note (optional)" }),
    ui.row({ gap: 1, align: "center" }, [
      ui.button("choose", "Choose", { variant: "primary", disabled: state.picked === null }),
      ui.button("dismiss", "Dismiss", { variant: "secondary" }),
    ]),
  ])
}

function update(state, event, data) {
  if (event.type === "change") return event.id === "note" ? { ...state, note: String(event.value ?? "") } : state
  if (event.type !== "press") return state
  if (event.id.startsWith("option:")) return { ...state, picked: Number(event.id.slice("option:".length)) }
  if (event.id === "dismiss") return dismiss(state)
  if (event.id !== "choose" || state.picked === null) return state
  const note = data.allowNote === false ? "" : state.note.trim()
  const choice = { choice: data.options[state.picked].label, index: state.picked }
  return submit(note ? { ...choice, note } : choice, state)
}
