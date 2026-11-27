# Widgets plugin

`@opencode/plugin-widgets` lets agents show interactive widgets in a session: option cards with images, forms,
confirmations, charts and custom widget templates. Each widget is a PsychoScript program from `@opencode/widget` plus JSON data;
clients run the program and render its view natively. The contract is `specs/v2/widgets.md`.

The plugin uses only the public plugin API. It owns the `widget` and `widget_template` tools, the `widgets` skill,
widget template versions and widget states in plugin storage, the `opencode.widget` RPC (`Widget.Definition` in
`@opencode/schema/widget`) with its `changed` event, and the delivery of answers to the model as synthetic messages.
Core registers it only while the opt-in `widgets` flag is on.
