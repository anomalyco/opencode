--!strict
-- `@opencode/plugin`: what every Luau plugin requires. `define` names the setup; the rest builds the contract's tables
-- (`schema/v2.json`), which a plugin may also write by hand. Types: `opencode/plugin.luau`.
--
-- Each helper builds its table in one record literal. A literal with only named fields is a copy of a template made
-- when the chunk loads (`DUPTABLE`), and a field written `= nil` still gets its slot in the template. So a helper given
-- `props` starts from a table that already has room for the common fields, and copying `props` into it does not grow
-- it. A helper given no `props` builds the smallest table and runs no loop.

local plugin = {}

plugin.contract = "2.0"

-- The host's optional features, which `read:hasFeature` asks for: a field the plugin focuses (`host:focus` of an
-- `input` node), and the host's own code view of a claimed fence (a `fence` node).
plugin.IMAGE_BOUNDS = "image-bounds"
plugin.FOCUS_INPUT = "focus-input"
plugin.FENCE_NODE = "fence-node"

-- What a render returns besides `plugin.show(node)`: keep what shows, or show nothing (as `nil` does).
plugin.KEEP = table.freeze({ type = "keep" })
plugin.HIDE = table.freeze({ type = "hide" })

function plugin.define(setup)
    if type(setup) ~= "function" then
        error("plugin.define needs a setup function", 2)
    end
    return table.freeze({ __opencode_setup = setup })
end

-- A span: `plugin.span("text", { fg = "text.muted", bold = true })`.
function plugin.span(text: string, style: { [string]: any }?)
    if not style then
        return { text = text }
    end
    local span: { [string]: any } = { text = text, fg = nil, bg = nil, bold = nil }
    for key, value in style do
        span[key] = value
    end
    return span
end

-- A text node of a string or a list of spans; `props` adds fields (`fg`, `wrap`, `on_click`, `id`, `layout`, ...).
function plugin.text(content, props: { [string]: any }?)
    local spans = if type(content) == "string" then { { text = content } } else content
    if not props then
        return { type = "text", spans = spans }
    end
    local node: { [string]: any } =
        { type = "text", spans = spans, fg = nil, on_click = nil, id = nil, wrap = nil, layout = nil, truncate = nil }
    for key, value in props do
        node[key] = value
    end
    return node
end

-- A box of children in a column or a row.
function plugin.column(children, props: { [string]: any }?)
    if not props then
        return { type = "box", row = false, children = children }
    end
    local node: { [string]: any } =
        { type = "box", row = false, children = children, id = nil, gap = nil, padding = nil, bg = nil, layout = nil }
    for key, value in props do
        node[key] = value
    end
    return node
end

function plugin.row(children, props: { [string]: any }?)
    if not props then
        return { type = "box", row = true, children = children }
    end
    local node: { [string]: any } =
        { type = "box", row = true, children = children, id = nil, gap = nil, padding = nil, bg = nil, layout = nil }
    for key, value in props do
        node[key] = value
    end
    return node
end

-- What a slot or route render returns to show `node`.
function plugin.show(node)
    return { type = "show", node = node }
end

-- The action that runs command `name` with `input`.
function plugin.command(name: string, input: string?)
    return { type = "command", name = name, input = input }
end

-- A click that runs command `name` on the release of the left button.
function plugin.click(name: string, input: string?)
    return { action = { type = "command", name = name, input = input }, on = "up" }
end

return table.freeze(plugin)
