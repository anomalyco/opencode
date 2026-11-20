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
    ui.row({ gap: 1 }, [ui.button("submit", data.submitLabel || "Submit", { variant: "primary" })]),
  ])
}

function input(field, value) {
  const id = "field:" + field.key
  if (field.type === "number")
    return ui.slider(id, { label: field.label, value, min: field.min, max: field.max, step: field.step })
  if (field.type === "boolean") return ui.checkbox(id, field.label, value)
  if (field.type === "select")
    return ui.select(id, field.options, { label: field.label, value, multiple: field.multiple === true })
  return ui.input(id, value, {
    label: field.label,
    placeholder: field.placeholder,
    multiline: field.multiline === true,
  })
}

function update(state, event, data) {
  if (event.id === "submit") return submit(state.values, state)
  const field = data.fields.find((field) => "field:" + field.key === event.id)
  if (!field) return state
  return { ...state, values: { ...state.values, [field.key]: coerce(field, event.value) } }
}

function coerce(field, value) {
  if (field.type === "number") return Math.min(field.max, Math.max(field.min, Number(value)))
  if (field.type === "boolean") return value === true
  if (field.type === "select" && field.multiple) return [value ?? []].flat().map(String)
  return String(value ?? "")
}
