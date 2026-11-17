--!strict
-- A port of `@prevalentware/opencode-goal-plugin` 0.1.98's TUI (`src/tui.ts`, its V2 part): a sidebar block with the
-- session's goal, read from the newest goal tool result among the session's messages, and a palette command, `Goal`,
-- whose select shows the goal's summary and sends the prompt that refreshes, lists the history of, pauses, resumes or
-- clears it. The options' `locale` picks English or Chinese, as TS's.
--
-- Where it differs from TS: a Luau plugin reads no files and keeps no time, so it never reads the goal server's state
-- file, and an active goal's time is what its last tool result says; `locale: "auto"` is English, as the environment
-- and the system's locale are not a Luau plugin's to read; and its select opens medium, as TS's does after a
-- `dialog.set` that comes before it.
local plugin = require("@opencode/plugin")
local i18n = require("@self/i18n")
local json = require("@self/json")

local GOAL_TOOLS = {
    "get_goal",
    "get_goal_history",
    "create_goal",
    "set_goal",
    "update_goal",
    "update_goal_objective",
    "update_goal_status",
    "stop_goal",
    "replace_goal",
    "clear_goal",
}
local PICKED = "goal.picked"
local STATUSES = { "active", "paused", "budgetLimited", "usageLimited", "complete", "unmet", "cancelled" }

local null = json.null

local function isNumber(value: any): boolean
    return type(value) == "number"
end

local function isString(value: any): boolean
    return type(value) == "string"
end

local function isCheckpoint(value: any): boolean
    return type(value) == "table" and isString(value.summary) and isNumber(value.timestamp)
end

local function isHistory(value: any): boolean
    return type(value) == "table" and isString(value.type) and isString(value.detail) and isNumber(value.timestamp)
end

local function every(list: any, test: (any) -> boolean): boolean
    if type(list) ~= "table" then
        return false
    end
    for _, entry in list do
        if not test(entry) then
            return false
        end
    end
    return true
end

-- TS `isGoalSnapshot`. A field that is `null` reads as `json.null`; `nullable` needs it present, `nullish` not.
local function isGoal(goal: any): boolean
    if type(goal) ~= "table" then
        return false
    end
    local function nullable(name: string, test: (any) -> boolean): boolean
        return goal[name] == null or test(goal[name])
    end
    local function nullish(name: string, test: (any) -> boolean): boolean
        return goal[name] == nil or goal[name] == null or test(goal[name])
    end
    for _, name in { "tokensUsed", "timeUsedSeconds", "createdAt", "updatedAt", "continuationFailures" } do
        if not isNumber(goal[name]) then
            return false
        end
    end
    for _, name in { "maxAutoTurns", "maxDurationSeconds", "noProgressTokenThreshold", "maxNoProgressTurns" } do
        if not nullable(name, isNumber) then
            return false
        end
    end
    return isString(goal.sessionID)
        and isString(goal.objective)
        and table.find(STATUSES, goal.status) ~= nil
        and nullable("tokenBudget", isNumber)
        and nullish("completionEvidence", isString)
        and nullish("blocker", isString)
        and nullish("lastStatus", isString)
        and nullish("closedAt", isNumber)
        and isNumber(goal.noProgressTurns)
        and type(goal.budgetWrapupSent) == "boolean"
        and nullable("stopReason", isString)
        and every(goal.history, isHistory)
        and every(goal.checkpoints, isCheckpoint)
        and nullable("lastCheckpoint", isCheckpoint)
        and isString(goal.lastAssistantText)
        and isString(goal.lastAssistantMessageID)
        and isNumber(goal.autoTurns)
        and nullish("lastContinuationAt", isNumber)
        and nullable("remainingTokens", isNumber)
        and nullish("sampledAt", isNumber)
end

-- TS `goalFromV2Messages`: the newest completed goal tool result in session `id`'s messages: the goal, `null` after a
-- clear, nil when there is none.
local function goalFromMessages(read: plugin.Read, id: string): any
    local messages = read:messages(id)
    for index = #messages, 1, -1 do
        local message = messages[index]
        if message.type == "assistant" then
            local parts = message.content
            for at = #parts, 1, -1 do
                local part = parts[at]
                if part.type ~= "tool" or not table.find(GOAL_TOOLS, part.name) then
                    continue
                end
                local state = part.state
                if not state or state.status ~= "completed" then
                    continue
                end
                if part.name == "clear_goal" then
                    return null
                end
                local text
                for _, entry in state.content do
                    if entry.type == "text" then
                        text = entry.text
                        break
                    end
                end
                local parsed = text and json.decode(text)
                if type(parsed) == "table" and parsed ~= null then
                    if parsed.goal == null then
                        return null
                    elseif isGoal(parsed.goal) then
                        return parsed.goal
                    end
                end
            end
        end
    end
    return nil
end

-- A string field, unless it is null, missing or empty.
local function text(value: any): string?
    return if type(value) == "string" and value ~= "" then value else nil
end

-- A whole number as JavaScript writes it.
local function js(value: number): string
    return if value % 1 == 0 and math.abs(value) < 1e21 then string.format("%d", value) else tostring(value)
end

-- `used` and, with a limit, `/limit`, as TS writes them.
local function of(goal, used: string, limit: string): string
    local shown = js(goal[used])
    return if isNumber(goal[limit]) then `{shown}/{js(goal[limit])}` else shown
end

-- TS `formatDuration`: `m:ss`, or `h:mm:ss` from an hour.
local function duration(seconds: number): string
    local total = math.max(0, math.floor(seconds))
    local hours, minutes, secs = total // 3600, total % 3600 // 60, total % 60
    if hours > 0 then
        return string.format("%d:%02d:%02d", hours, minutes, secs)
    end
    return string.format("%d:%02d", minutes, secs)
end

-- TS `formatGoal`: the summary, a line a field.
local function summary(goal, t, locale: string): string
    if not goal then
        return t.noGoal
    end
    local lines = {
        `{t.objective}: {goal.objective}`,
        `{t.status}: {i18n.status(goal.status, locale)}`,
        `{t.timeUsed}: {duration(goal.timeUsedSeconds)}`,
        `{t.tokens}: {of(goal, "tokensUsed", "tokenBudget")}`,
        `{t.autoContinues}: {of(goal, "autoTurns", "maxAutoTurns")}`,
    }
    if isNumber(goal.remainingTokens) then
        table.insert(lines, `{t.tokensRemaining}: {js(goal.remainingTokens)}`)
    end
    if isNumber(goal.maxDurationSeconds) then
        table.insert(lines, `{t.durationLimit}: {duration(goal.maxDurationSeconds)}`)
    end
    if goal.noProgressTurns > 0 then
        table.insert(lines, `{t.noProgressTurns}: {js(goal.noProgressTurns)}`)
    end
    if isCheckpoint(goal.lastCheckpoint) then
        table.insert(lines, `{t.latestCheckpoint}: {goal.lastCheckpoint.summary}`)
    end
    local stop, last, evidence, blocker =
        text(goal.stopReason), text(goal.lastStatus), text(goal.completionEvidence), text(goal.blocker)
    if stop then
        table.insert(lines, `{t.stopReason}: {i18n.stopReason(stop, locale)}`)
    end
    if last then
        table.insert(lines, `{t.lastStatus}: {i18n.lastStatus(last, locale)}`)
    end
    if evidence then
        table.insert(lines, `{t.completionEvidence}: {evidence}`)
    end
    if blocker then
        table.insert(lines, `{t.blocker}: {i18n.lastStatus(blocker, locale)}`)
    end
    return table.concat(lines, "\n")
end

return plugin.define(function(setup)
    local options = setup.options
    local locale = i18n.resolve(type(options) == "table" and type(options.locale) == "string" and options.locale or nil)
    local t = i18n.messages(locale)
    -- TS `storage.memory("goal-mode.v2.<session>")`: the goal a session's sidebar showed last.
    local cache: { [string]: any } = {}
    -- The session the summary was shown for.
    local asked = ""

    local function toast(host: plugin.Host, message: string, variant: plugin.Variant)
        host:toast({ variant = variant, title = t.title, message = message })
    end

    setup:slot({ path = "sidebar.content" }, function(read, input, changed)
        local id = input.session_id
        if not id then
            return plugin.HIDE
        end
        local moved = changed.all or changed["local"] or changed.size or table.find(changed.lists or {}, id)
        for _, pair in changed.messages or {} do
            moved = moved or pair[1] == id
        end
        if not moved then
            return plugin.KEEP
        end
        local found = goalFromMessages(read, id)
        local goal = if found == nil then cache[id] elseif found == null then nil else found
        cache[id] = goal
        if not goal then
            return plugin.HIDE
        end
        local function muted(line: string)
            return plugin.text(line, { fg = "text.muted" })
        end
        local elapsed = duration(goal.timeUsedSeconds)
        if goal.status == "complete" then
            return plugin.show(plugin.column({ plugin.text(`{t.achieved} ({elapsed})`, { fg = "text.feedback.success.base" }) }))
        elseif goal.status == "unmet" then
            return plugin.show(plugin.column({ muted(`{t.unmet} ({elapsed})`) }))
        end
        local rows = {
            plugin.text(t.title, { fg = "text.base" }),
            muted(`{t.status}: {i18n.status(goal.status, locale)}`),
            muted(`{t.time}: {elapsed}`),
            muted(`{t.tokens}: {of(goal, "tokensUsed", "tokenBudget")}`),
            muted(`{t.autoContinues}: {of(goal, "autoTurns", "maxAutoTurns")}`),
        }
        if isCheckpoint(goal.lastCheckpoint) then
            table.insert(rows, muted(`{t.checkpoint}: {goal.lastCheckpoint.summary}`))
        end
        local stop, last = text(goal.stopReason), text(goal.lastStatus)
        if stop then
            table.insert(rows, muted(`{t.stop}: {i18n.stopReason(stop, locale)}`))
        end
        if last then
            table.insert(rows, muted(i18n.lastStatus(last, locale)))
        end
        table.insert(rows, muted(goal.objective))
        return plugin.show(plugin.column({ plugin.column(rows) }))
    end)

    setup:command({
        name = "goal.show",
        title = t.title,
        description = t.commandDescription,
        group = t.title,
        palette = true,
    }, function(host)
        local route = host:route()
        if route.type ~= "session" then
            return toast(host, t.openSession, "warning")
        end
        local goal = goalFromMessages(host, route.id)
        goal = if goal == null then nil else goal
        local options: { plugin.SelectOption } =
            { { title = t.refresh, value = "refresh", description = t.refreshDescription } }
        if goal then
            table.insert(options, { title = t.history, value = "history", description = t.historyDescription })
            if goal.status == "active" then
                table.insert(options, { title = t.pause, value = "pause", description = t.pauseDescription })
            end
            local resumable = goal.status == "paused" or goal.status == "budgetLimited" or goal.status == "usageLimited"
            if resumable or (goal.status == "cancelled" and goal.stopReason == "interrupted") then
                table.insert(options, { title = t.resume, value = "resume", description = t.resumeDescription })
            end
            table.insert(options, { title = t.clear, value = "clear", description = t.clearDescription })
        end
        asked = route.id
        host:dialog({
            type = "select",
            title = t.title,
            placeholder = summary(goal, t, locale),
            options = options,
            action = plugin.command(PICKED),
        })
    end)

    local PROMPTS = {
        refresh = t.refreshPrompt,
        history = t.historyPrompt,
        pause = t.pausePrompt,
        resume = t.resumePrompt,
        clear = t.clearPrompt,
    }
    setup:command({ name = PICKED }, function(host, value)
        local prompt = value and PROMPTS[value]
        if not prompt then
            return
        end
        local _, failure = host:fetch({ method = "POST", path = `/api/session/{asked}/prompt`, body = { text = prompt } })
        if failure then
            toast(host, failure, "error")
        end
    end)
end)
