<!--
  Built-in skill, registered with the widget tools in
  packages/core/src/tool/plugin/widget.ts when the `widgets` flag is on.
  The body below becomes the skill's content.
-->

# Widgets

The `widget` tool shows an interactive card inline in the conversation. It renders natively in every client, and the
user's answer comes back as your next message.

## When to show a widget

Show one when the user should pick, tune or confirm something, and clicking beats typing:

- **Pick between 2–3 things they should see**: designs, photos, places, products, layouts → `suggestions`.
- **Several structured inputs at once**: settings, parameters, a booking, a release config → `form`. Use sliders for
  numbers with a range, checkboxes for on/off, selects for fixed choices.
- **Approve something consequential**: deploy, delete, send, spend → `confirm` (set `danger: true` when it can't be
  undone).
- **Anything else that is a small interactive surface** and fits no built-in → write a template (below).

Don't show one for a single free-text question, a plain yes/no in passing, or when the user asked for an explanation.
Use the `question` tool for text-only choices.

## How to show one well

- Show it early. Gather only what the widget needs; don't research for many steps before the user has seen anything.
  If they want more detail, they'll say so in their answer.
- `data` is a JSON object, never a string. It must match the template's schema; errors come back as the tool error,
  so fix the data and call again rather than giving up.
- Images: real `https:` URLs you know resolve, `data:` URIs, or paths relative to the session directory (for example
  files you just generated). Never invent image URLs.
- Give it a short `title`; the transcript uses it.
- After the widget is shown, end your turn. Don't repeat the options in text.
- The answer arrives as `User responded to widget "<title>": <JSON>` or `User dismissed widget "<title>"`. Act on it.

## Built-in templates

`suggestions` — submits `{ choice, index, note? }`:

```json
{
  "title": "Which landing page?",
  "options": [
    {
      "label": "Bold",
      "note": "Big type, one CTA",
      "images": ["shots/bold-desktop.png", "shots/bold-mobile.png"],
      "recommended": true
    },
    { "label": "Calm", "images": ["shots/calm.png"] }
  ],
  "allowNote": true
}
```

2–3 options, 1–3 images each (several images become a swipeable carousel).

`form` — submits `{ [key]: value }`:

```json
{
  "title": "Configure the release",
  "submitLabel": "Start release",
  "fields": [
    { "key": "name", "type": "text", "label": "Release name", "default": "Spring" },
    { "key": "rollout", "type": "number", "label": "Rollout %", "min": 0, "max": 100, "step": 5, "default": 25 },
    { "key": "notify", "type": "boolean", "label": "Notify subscribers", "default": true },
    {
      "key": "channel",
      "type": "select",
      "label": "Channel",
      "options": [
        { "value": "stable", "label": "Stable" },
        { "value": "beta", "label": "Beta" }
      ]
    }
  ]
}
```

`confirm` — submits `{ confirmed }`: `{ "title": "Deploy main?", "message": "Ships **3 commits** to production.", "confirmLabel": "Deploy", "danger": false }`.

## Writing a template

Use `widget_template` with `action: "get"` on `suggestions` or `form` first and copy their patterns, then
`action: "save"` with `name`, `description`, `data` (a JSON Schema with top-level `type: "object"`), `source` and an
`example` that matches the schema. Saving renders the example once; fix the errors it returns. Saved templates are
reusable in later sessions, so make them general and put the specifics in `data`.

The source is confined JavaScript (no imports, timers, randomness or I/O) with top-level functions:

```js
function init(data) { return { picked: null } }            // optional, the initial state
function view(state, data) { return ui.column({}, [...]) } // required, returns the view tree
function update(state, event, data) {                       // optional, returns the next state
  if (event.id === "choose") return submit({ picked: state.picked }, state)
  return { ...state, picked: event.value }
}
```

State and data are plain JSON. `update` may return `submit(value, state)` to send `value` to you, or `dismiss(state)`.
Events are `{ id, type: "press" | "change", value? }`.

Node builders (props are optional objects; tone is default|muted|accent|success|warning|error; gap is 0..3):

```
ui.column(props, children)   { gap, align: start|center|end|stretch }
ui.row(props, children)      { gap, align: start|center|end, wrap }
ui.text(text, props)         { style: title|body|caption|code, tone }
ui.markdown(text)
ui.image(src, props)         { alt, aspect }            aspect = width / height
ui.carousel(props, children) { id, index }              one child at a time; with id it sends change with the page
ui.card(props, children)     { id, selected }           with id it sends press
ui.button(id, label, props)  { variant: primary|secondary|danger, disabled }    sends press
ui.checkbox(id, label, checked, props)                  sends change with a boolean
ui.slider(id, { label, value, min, max, step })         sends change with a number
ui.select(id, [{ value, label, description }], { label, value, multiple })      sends change, string or string[]
ui.input(id, value, { label, placeholder, multiline })  sends change with a string
ui.divider()
```

Children may contain `null` or `false` (for `cond && node`) and nested arrays.
