function init(data) {
  return { values: Object.fromEntries(data.fields.map((field) => [field.key, initial(field)])) }
}

function initial(field) {
  if (field.default !== undefined) return field.default
  if (field.type === "number") return field.min
  if (field.type === "boolean") return false
  if (field.type === "select") return field.multiple ? [] : (field.options[0]?.value ?? "")
  return ""
}

function view(state, data) {
  return ui.column({ gap: 2 }, [
    ui.text(data.title, { style: "title" }),
    data.description && ui.markdown(data.description),
    ui.column(
      { gap: 2, align: "stretch" },
      data.fields.map((field) => input(field, state.values[field.key])),
    ),
    ui.row({ gap: 1 }, [
      ui.button(data.submitLabel || "Submit", { variant: "primary", onPress: (state) => submit(state.values) }),
    ]),
  ])
}

// Each field's control; its handler stores the typed value it gets under the field's key.
function input(field, value) {
  const onChange = (state, value) => ({ ...state, values: { ...state.values, [field.key]: value } })
  if (field.type === "number")
    return ui.slider({ label: field.label, value, min: field.min, max: field.max, step: field.step, onChange })
  if (field.type === "boolean") return ui.checkbox(field.label, value, { onChange })
  if (field.type === "select")
    return ui.select(field.options, { label: field.label, value, multiple: field.multiple === true, onChange })
  return ui.input(value, {
    label: field.label,
    placeholder: field.placeholder,
    multiline: field.multiline === true,
    onChange,
  })
}
