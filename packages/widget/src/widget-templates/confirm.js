function view(state, data) {
  return ui.column({ gap: 2 }, [
    ui.text(data.title, { style: "title" }),
    ui.markdown(data.message),
    ui.row({ gap: 1, align: "center" }, [
      ui.button(data.confirmLabel || "Confirm", {
        variant: data.danger ? "danger" : "primary",
        onPress: () => submit({ confirmed: true }),
      }),
      ui.button(data.cancelLabel || "Cancel", { variant: "secondary", onPress: () => submit({ confirmed: false }) }),
    ]),
  ])
}
