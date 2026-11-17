--!strict
-- TS `src/usage.ts` and `src/estimate.ts`: catalog prices, meter severity, reset countdowns, bars, and what a session
-- tree cost.
local usage = {}

-- `Math.round`: halves go up.
function usage.round(value: number): number
    return math.floor(value + 0.5)
end

-- TS `catalogCost`: what `tokens` cost at the most specific context tier the context exceeds, else the base price.
function usage.catalogCost(costs, tokens): number
    if not tokens then
        return 0
    end
    local context = tokens.input + tokens.cache.read + tokens.cache.write
    local price, size = nil, nil
    for _, cost in costs do
        local tier = cost.tier
        if tier and tier.type == "context" and context > tier.size and (size == nil or tier.size > size) then
            price, size = cost, tier.size
        end
    end
    if not price then
        for _, cost in costs do
            if not cost.tier then
                price = cost
                break
            end
        end
    end
    if not price then
        return 0
    end
    return (tokens.input * price.input
        + (tokens.output + tokens.reasoning) * price.output
        + tokens.cache.read * price.cache.read
        + tokens.cache.write * price.cache.write) / 1_000_000
end

-- TS `sessionCost`: the costs the provider reported, when any is positive, else the catalog estimate.
function usage.sessionCost(messages, models): number
    local reported, catalog, hasReported = 0, 0, false
    for _, message in messages do
        if message.type == "assistant" then
            local cost = message.cost or 0
            if cost > 0 then
                hasReported = true
                reported += cost
            end
            for _, model in models do
                if model.providerID == message.model.providerID and model.id == message.model.id then
                    catalog += usage.catalogCost(model.cost, message.tokens)
                    break
                end
            end
        end
    end
    return if hasReported then reported else catalog
end

-- TS `usageSeverity` as its color: `limited` wins, then the thresholds, inclusive.
function usage.color(percent: number, limited: boolean, warnAt: number, criticalAt: number): string
    if limited or percent >= criticalAt then
        return "text.feedback.error.base"
    elseif percent >= warnAt then
        return "text.feedback.warning.base"
    end
    return "text.feedback.success.base"
end

-- TS `resetIn`: `4d 9h`, or `2h 5m` within a day.
function usage.resetIn(at: number, now: number): string
    local remaining = math.max(at - now, 0)
    local days = remaining // 86_400_000
    local hours = (remaining % 86_400_000) // 3_600_000
    local minutes = (remaining % 3_600_000) // 60_000
    return if days > 0 then string.format("%dd %dh", days, hours) else string.format("%dh %dm", hours, minutes)
end

-- TS `bar`: the filled cells of a bar `width` wide for `percent`, clamped to 0–100.
function usage.filled(percent: number, width: number): number
    return usage.round(math.clamp(percent, 0, 100) / 100 * math.max(width, 1))
end

-- TS `Intl.NumberFormat("en-US", { style: "currency", currency: "USD" })` with two decimals: `$1,234.50`.
function usage.money(value: number): string
    local cents = math.round(math.abs(value) * 100)
    local dollars = string.format("%d", cents // 100):reverse():gsub("(%d%d%d)", "%1,"):reverse()
    if dollars:sub(1, 1) == "," then
        dollars = dollars:sub(2)
    end
    return string.format("%s$%s.%02d", if value < 0 and cents > 0 then "-" else "", dollars, cents % 100)
end

return table.freeze(usage)
