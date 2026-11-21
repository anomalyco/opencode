function init(data) {
  return { picked: null, note: "" }
}

function view(state, data) {
  return ui.column({ gap: 2 }, [
    ui.text(data.title, { style: "title" }),
    ui.row(
      { gap: 2, align: "start", wrap: true },
      data.options.map((option, index) =>
        ui.card({ selected: state.picked === index, onPress: (state) => ({ ...state, picked: index }) }, [
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
    data.allowNote !== false &&
      ui.input(state.note, {
        label: "Note",
        placeholder: "Add a note (optional)",
        onChange: (state, note) => ({ ...state, note }),
      }),
    ui.row({ gap: 1, align: "center" }, [
      ui.button("Choose", {
        variant: "primary",
        disabled: state.picked === null,
        onPress: (state) => choose(state, data),
      }),
      ui.button("Dismiss", { variant: "secondary", onPress: () => dismiss() }),
    ]),
  ])
}

function choose(state, data) {
  if (state.picked === null) return state
  const note = state.note.trim()
  const choice = { choice: data.options[state.picked].label, index: state.picked }
  return submit(note ? { ...choice, note } : choice)
}
