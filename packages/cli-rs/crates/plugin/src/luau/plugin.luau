--!strict
-- `@opencode/plugin`: what every Luau plugin requires. `define` names the setup; the rest builds the contract's tables
-- (`schema/v2.json`), which a plugin may also write by hand. Types: `opencode.d.luau`.

local plugin = {}

plugin.contract = "2.0"

-- What a render returns besides `plugin.show(node)`: keep what shows, or show nothing (as `nil` does).
plugin.KEEP = table.freeze({ type = "keep" })
plugin.HIDE = table.freeze({ type = "hide" })

function plugin.define(setup)
    if type(setup) ~= "function" then
        error("plugin.define needs a setup function", 2)
    end
    return table.freeze({ __opencode_setup = setup })
end

local function merge(into, from)
    if from then
        for key, value in from do
            into[key] = value
        end
    end
    return into
end

-- A span: `plugin.span("text", { fg = "text.muted", bold = true })`.
function plugin.span(text: string, style: { [string]: any }?)
    return merge({ text = text }, style)
end

local function spans(content)
    if type(content) == "string" then
        return { { text = content } }
    end
    return content
end

-- A text node of a string or a list of spans; `props` adds fields (`fg`, `wrap`, `on_click`, `id`, `layout`, ...).
function plugin.text(content, props: { [string]: any }?)
    return merge({ type = "text", spans = spans(content) }, props)
end

-- A box of children in a column or a row.
function plugin.column(children, props: { [string]: any }?)
    return merge({ type = "box", row = false, children = children }, props)
end

function plugin.row(children, props: { [string]: any }?)
    return merge({ type = "box", row = true, children = children }, props)
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
    return { action = plugin.command(name, input), on = "up" }
end

return table.freeze(plugin)
