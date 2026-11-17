--!strict
-- TS `src/queue-core.mjs`: the draft list's operations, pure. Each returns nil and TS's message where TS throws.
local core = {}

core.MAX_BATCH = 500
local MAX_FILE_LINES = 1000

local function trim(text: string): string
    return (text:match("^%s*(.-)%s*$") :: string)
end

-- TS `normalizeCount`: an integer from 1 to `MAX_BATCH`, as `Number` reads it (surrounding blanks allowed).
function core.normalizeCount(value: string): (number?, string?)
    local text = trim(value)
    local count = if text == "" then 0 else tonumber(text)
    if count and count % 1 == 0 and count >= 1 and count <= core.MAX_BATCH then
        return count, nil
    end
    return nil, `Count must be an integer between 1 and {core.MAX_BATCH}.`
end

-- TS `repeatMessage`.
function core.repeatMessage(text: string, count: number): ({ string }?, string?)
    local message = trim(text)
    if message == "" then
        return nil, "Message cannot be blank."
    end
    local copies: { string } = table.create(count, message :: string)
    return copies, nil
end

-- TS `parseMessageLines`: the non-blank lines, trimmed, without a leading byte-order mark.
function core.parseMessageLines(content: string): ({ string }?, string?)
    local text = if content:sub(1, 3) == "\u{feff}" then content:sub(4) else content
    local lines = {}
    for line in (text .. "\n"):gmatch("([^\n]*)\n") do
        local trimmed = trim(line)
        if trimmed ~= "" then
            table.insert(lines, trimmed)
        end
    end
    if #lines == 0 then
        return nil, "File contains no non-empty lines."
    elseif #lines > MAX_FILE_LINES then
        return nil, `File has more than {MAX_FILE_LINES} messages.`
    end
    return lines, nil
end

local function check(items: { string }, index: number): string?
    if index % 1 ~= 0 or index < 1 or index > #items then
        return `Invalid queue index: {index - 1}`
    end
    return nil
end

-- TS `editAt` (indices from 1).
function core.editAt(items: { string }, index: number, text: string): ({ string }?, string?)
    local bad = check(items, index)
    if bad then
        return nil, bad
    end
    local message = trim(text)
    if message == "" then
        return nil, "Message cannot be blank."
    end
    local next = table.clone(items)
    next[index] = message
    return next, nil
end

-- TS `deleteAt`.
function core.deleteAt(items: { string }, index: number): ({ string }?, string?)
    local bad = check(items, index)
    if bad then
        return nil, bad
    end
    local next = table.clone(items)
    table.remove(next, index)
    return next, nil
end

-- TS `moveAt`.
function core.moveAt(items: { string }, from: number, to: number): ({ string }?, string?)
    local bad = check(items, from) or check(items, to)
    if bad then
        return nil, bad
    end
    local next = table.clone(items)
    local entry = table.remove(next, from) :: string
    table.insert(next, to, entry)
    return next, nil
end

-- TS `summarize`: one line, cut to `max` characters with `...`. TS counts UTF-16 units; this counts characters,
-- which differ only past the Basic Multilingual Plane.
function core.summarize(text: string, max: number?): string
    local limit = max or 90
    local words = {}
    for word in text:gmatch("%S+") do
        table.insert(words, word)
    end
    local line = table.concat(words, " ")
    local length = utf8.len(line) or #line
    if length <= limit then
        return line
    end
    local cut = utf8.offset(line, limit) or (#line + 1)
    return line:sub(1, cut - 1) .. "..."
end

return table.freeze(core)
