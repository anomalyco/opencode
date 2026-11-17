--!strict
-- What the grid shows, as TS's `data.ts`, `breakdown.ts`, `grid.ts` and `format.ts` compute it: the context the last
-- assistant step used, against its model's window, split by an estimate of where it came from.
local context = {}

context.GLYPH_FULL = "⛁"
context.GLYPH_PARTIAL = "⛀"
context.GLYPH_FREE = "⛶"

-- The categories in their order on the grid: TS `categoryColor` (a categorical hue's step 400 by place) and
-- `CATEGORY_LABEL`.
context.KEYS = { "system", "user", "assistant", "tool", "other" }
context.COLOR = {
    system = "categorical.0.400",
    user = "categorical.1.400",
    assistant = "categorical.2.400",
    tool = "categorical.3.400",
    other = "categorical.4.400",
    free = "text.muted",
}
context.LABEL = {
    system = "System",
    user = "User",
    assistant = "Assistant",
    tool = "Tools",
    other = "Other",
    free = "Free space",
}

export type Segment = { key: string, tokens: number }
export type Context = {
    model: string,
    tokens: number,
    limit: number,
    percent: number?,
    cost: number,
    segments: { Segment },
}

-- JavaScript's `Math.round`: halves go up.
local function round(value: number): number
    return math.floor(value + 0.5)
end
context.round = round

-- A string's length as JavaScript counts it, in UTF-16 units: its characters, and one more for each of four bytes in
-- UTF-8 (a lead byte from `\240`), which UTF-16 writes as two. Both counts run in the VM's C, not character by
-- character.
local function length(text: string?): number
    if not text then
        return 0
    end
    local _, wide = text:gsub("[\240-\247]", "")
    return (utf8.len(text) or #text) + wide
end

-- The length of `JSON.stringify(value)`, for a tool's structured error.
local function jsonLength(value: any): number
    local kind = type(value)
    if kind == "string" then
        local escaped = 0
        for _, code in utf8.codes(value) do
            escaped += if code == 34 or code == 92 or code == 8 or code == 9 or code == 10 or code == 12 or code == 13
                then 2
                elseif code < 32 then 6
                elseif code >= 0x10000 then 2
                else 1
        end
        return escaped + 2
    elseif kind == "number" then
        return #(if value == math.floor(value) then string.format("%d", value) else tostring(value))
    elseif kind == "boolean" then
        return if value then 4 else 5
    elseif kind == "table" then
        local parts, total = 0, 2
        if #value > 0 then
            for _, item in value do
                total += jsonLength(item)
                parts += 1
            end
        else
            for key, item in value do
                total += jsonLength(tostring(key)) + 1 + jsonLength(item)
                parts += 1
            end
        end
        return total + math.max(parts - 1, 0)
    end
    return 4
end

local function count(object: any): number
    local keys = 0
    if type(object) == "table" then
        for _ in object do
            keys += 1
        end
    end
    return keys
end

-- TS `estimateTokens`.
local function estimate(chars: number): number
    return math.ceil(chars / 4)
end

-- TS `charsFromAssistantPart`: the characters of a step's part, as assistant and tool.
local function partChars(part): (number, number)
    if part.type == "text" or part.type == "reasoning" then
        return length(part.text), 0
    elseif part.type ~= "tool" then
        return 0, 0
    end
    local state = part.state or {}
    local input = if type(state.input) == "string" then length(state.input) else count(state.input) * 16
    if state.status == "completed" then
        local output = 0
        for _, content in state.content or {} do
            if content.type == "text" then
                output += length(content.text)
            end
        end
        return 0, input + output
    elseif state.status == "error" then
        return 0, input + (if type(state.error) == "string" then length(state.error) else jsonLength(state.error))
    end
    return 0, input
end

-- TS `estimateSystemResidual`: the first step's input, less the users' text before it.
local function residual(messages): number?
    local leading = 0
    for _, message in messages do
        if message.type == "user" then
            leading += length(message.text)
        elseif message.type == "assistant" and message.tokens then
            local tokens = message.tokens
            local first = tokens.input + tokens.cache.read + tokens.cache.write
            if first <= 0 then
                return nil
            end
            return math.max(0, first - estimate(leading))
        end
    end
    return nil
end

-- TS `estimateBreakdown`: the estimate by category, scaled down to `input` when it is over, the rest `other`.
local function breakdown(messages, input: number, system: number?): { Segment }
    if input == 0 then
        return {}
    end
    local user, assistant, tool = 0, 0, 0
    for _, message in messages do
        if message.type == "user" then
            user += length(message.text)
        elseif message.type == "assistant" then
            for _, part in message.content or {} do
                local text, used = partChars(part)
                assistant += text
                tool += used
            end
        end
    end
    local tokens = { system or 0, estimate(user), estimate(assistant), estimate(tool) }
    local estimated = tokens[1] + tokens[2] + tokens[3] + tokens[4]
    local other = input - estimated
    if estimated > input then
        local scale = input / estimated
        local total = 0
        for index, value in tokens do
            tokens[index] = math.floor(value * scale)
            total += tokens[index]
        end
        other = math.max(0, input - total)
    end
    table.insert(tokens, other)
    local segments = {}
    for index, key in context.KEYS do
        if tokens[index] > 0 then
            table.insert(segments, { key = key, tokens = tokens[index] })
        end
    end
    return segments
end

-- TS `lastAssistantWithUsage`.
local function lastWithUsage(messages, boundary: string?)
    local finish = #messages + 1
    if boundary then
        finish = 0
        for index, message in messages do
            if message.id == boundary then
                finish = index
                break
            end
        end
        if finish == 0 then
            return nil
        end
    end
    local start = 1
    for index = finish - 1, 1, -1 do
        local message = messages[index]
        if message.type == "compaction" and message.status == "completed" then
            start = index + 1
            break
        end
    end
    for index = finish - 1, start, -1 do
        local message = messages[index]
        if message.type == "assistant" and message.tokens then
            return message
        end
    end
    return nil
end

-- TS `getContextData`: the last assistant step with usage, after the last finished compaction and before the
-- session's revert point; `nil` without one, or with no tokens.
function context.data(messages, session, models): Context?
    local revert = session and session.revert
    local last = lastWithUsage(messages, revert and revert.messageID)
    if not last then
        return nil
    end
    local usage = last.tokens
    local total = usage.input + usage.output + usage.reasoning + usage.cache.read + usage.cache.write
    if total == 0 then
        return nil
    end
    local model
    for _, known in models do
        if known.providerID == last.model.providerID and (known.id == last.model.id or known.modelID == last.model.id) then
            model = known
            break
        end
    end
    local limit = if model then model.limit.context else 0
    return {
        model = if model then model.name else last.model.id,
        tokens = total,
        limit = limit,
        percent = if limit ~= 0 then round(total / limit * 100) else nil,
        cost = if session then session.cost else 0,
        segments = breakdown(messages, total, residual(messages)),
    }
end

-- TS `computeGrid`: `total` squares of the window, each the category that covers most of it, filled or partly, then
-- the free ones, as key and glyph.
function context.grid(segments: { Segment }, limit: number, total: number): { { string } }
    if limit <= 0 or total <= 0 then
        return {}
    end
    local square = limit / total
    local used = 0
    local pools = {}
    for _, segment in segments do
        used += segment.tokens
        if segment.tokens > 0 then
            table.insert(pools, { key = segment.key, remaining = segment.tokens })
        end
    end
    used = math.min(used, limit)
    local squares = {}
    local start = 0
    for _ = 1, total do
        local begins = start
        start += square
        local dominant, most, covered = "free", 0, 0
        if begins < used then
            for _, pool in pools do
                if covered >= square then
                    break
                end
                if pool.remaining > 0 then
                    local overlap = math.min(pool.remaining, square - covered)
                    pool.remaining -= overlap
                    covered += overlap
                    if overlap > most then
                        dominant, most = pool.key, overlap
                    end
                end
            end
        end
        if dominant == "free" then
            table.insert(squares, { "free", context.GLYPH_FREE })
        else
            table.insert(squares, { dominant, if most / square >= 0.7 then context.GLYPH_FULL else context.GLYPH_PARTIAL })
        end
    end
    return squares
end

-- JavaScript's `String(number)` for the numbers these show.
local function js(value: number): string
    return if value == math.floor(value) then string.format("%d", value) else tostring(value)
end

-- TS `formatTokens`: `1.2M`, `23.4k`, `987`.
function context.tokens(value: number): string
    local function trim(number: number): string
        return js(if number >= 100 then round(number) else round(number * 10) / 10)
    end
    if value ~= value or value == math.huge or value < 0 then
        return "0"
    elseif value >= 1e6 then
        return trim(value / 1e6) .. "M"
    elseif value >= 1000 then
        return trim(value / 1000) .. "k"
    end
    return js(round(value))
end

-- TS `formatCost`, `Intl.NumberFormat("en-US", { style: "currency", currency: "USD" })`: `$1,234.50`.
function context.cost(usd: number): string
    local cents = round(math.abs(usd) * 100)
    local dollars = string.format("%d", cents // 100):reverse():gsub("(%d%d%d)", "%1,"):reverse()
    if dollars:sub(1, 1) == "," then
        dollars = dollars:sub(2)
    end
    return string.format("%s$%s.%02d", if usd < 0 and cents > 0 then "-" else "", dollars, cents % 100)
end

-- TS `percentOf`'s `toFixed(1)`.
function context.percentOf(tokens: number, limit: number): string
    return if limit ~= 0 then string.format("%.1f", round(tokens / limit * 1000) / 10) else "0.0"
end

context.js = js

return table.freeze(context)
