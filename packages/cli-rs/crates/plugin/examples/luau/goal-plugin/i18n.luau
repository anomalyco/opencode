--!strict
-- TS `src/i18n.ts`, the TUI's part: its texts in English and Chinese, and the presentation of the statuses, stop reasons
-- and last statuses the plugin writes. Text it does not know stays as it came.
local i18n = {}

i18n.en = table.freeze({
    title = "Goal",
    commandDescription = "View, pause, resume, or clear the long-running session goal",
    refresh = "Refresh",
    refreshDescription = "Ask the agent to read the current goal state",
    history = "History",
    historyDescription = "Ask the agent to show lifecycle history",
    pause = "Pause",
    pauseDescription = "Pause auto-continuation without clearing",
    resume = "Resume",
    resumeDescription = "Resume the goal and continue",
    clear = "Clear",
    clearDescription = "Ask the agent to clear this session goal",
    refreshPrompt = "Call get_goal for this session and report the current goal state briefly.",
    historyPrompt = "Call get_goal_history for this session and report the current goal history briefly.",
    pausePrompt = "Pause the current session goal by calling update_goal_status with status \"paused\". Report the result briefly.",
    resumePrompt = "Resume the current session goal by calling update_goal_status with status \"active\", then continue working toward it.",
    clearPrompt = "Clear the current session goal by calling clear_goal. Report whether a goal was cleared.",
    openSession = "Open a session before viewing goal state.",
    noGoal = "No recent goal state found in this session.",
    objective = "Objective",
    status = "Status",
    timeUsed = "Time used",
    time = "Time",
    tokens = "Tokens",
    autoContinues = "Auto-continues",
    tokensRemaining = "Tokens remaining",
    durationLimit = "Duration limit",
    noProgressTurns = "No-progress turns",
    latestCheckpoint = "Latest checkpoint",
    checkpoint = "Checkpoint",
    stopReason = "Stop reason",
    stop = "Stop",
    lastStatus = "Last status",
    completionEvidence = "Completion evidence",
    blocker = "Blocker",
    achieved = "Goal achieved",
    unmet = "Goal unmet",
})

i18n["zh-CN"] = table.freeze({
    title = "目标",
    commandDescription = "查看、暂停、继续或清除当前会话的长期目标",
    refresh = "刷新",
    refreshDescription = "让 Agent 读取当前目标状态",
    history = "历史",
    historyDescription = "让 Agent 显示目标生命周期历史",
    pause = "暂停",
    pauseDescription = "暂停自动继续，但不清除目标",
    resume = "继续",
    resumeDescription = "继续目标并接着执行",
    clear = "清除",
    clearDescription = "让 Agent 清除当前会话目标",
    refreshPrompt = "调用 get_goal 获取此会话的当前目标，并用简体中文简要报告目标状态。",
    historyPrompt = "调用 get_goal_history 获取此会话的当前目标历史，并用简体中文简要报告。",
    pausePrompt = "调用 update_goal_status 并将 status 设为 \"paused\"，暂停当前会话目标。用简体中文简要报告结果。",
    resumePrompt = "调用 update_goal_status 并将 status 设为 \"active\"，继续当前会话目标，然后继续推进该目标。请使用简体中文回复用户。",
    clearPrompt = "调用 clear_goal 清除当前会话目标，并用简体中文报告是否成功清除了目标。",
    openSession = "请先打开一个会话，再查看目标状态。",
    noGoal = "此会话中没有最近的目标状态。",
    objective = "目标",
    status = "状态",
    timeUsed = "已用时间",
    time = "时间",
    tokens = "Token",
    autoContinues = "自动继续次数",
    tokensRemaining = "剩余 Token",
    durationLimit = "持续时间上限",
    noProgressTurns = "无进展轮数",
    latestCheckpoint = "最新检查点",
    checkpoint = "检查点",
    stopReason = "停止原因",
    stop = "停止",
    lastStatus = "最近状态",
    completionEvidence = "完成证据",
    blocker = "阻塞原因",
    achieved = "目标已达成",
    unmet = "目标未达成",
})

-- TS `resolveLocale`, for a locale the options name. `auto` would read `LC_ALL`, `LANG` and the system's locale, which a
-- Luau plugin has no reader of: it is English.
function i18n.resolve(explicit: string?): string
    local configured = if explicit then (explicit:match("^%s*(.-)%s*$") :: string) else ""
    if configured == "" or configured:lower() == "auto" then
        return "en"
    end
    local normalized = (configured:gsub("_", "-"):match("^[^.@]*") :: string):lower()
    if normalized == "zh" or normalized:sub(1, 3) == "zh-" then
        return "zh-CN"
    end
    return "en"
end

local STATUS = {
    en = { budgetLimited = "budget limited", usageLimited = "usage limited" },
    ["zh-CN"] = {
        active = "进行中",
        paused = "已暂停",
        budgetLimited = "预算已达上限",
        usageLimited = "使用量已达上限",
        complete = "已完成",
        unmet = "未达成",
        cancelled = "已取消",
    },
}

-- TS `presentGoalStatus`.
function i18n.status(status: string, locale: string): string
    return STATUS[locale][status] or status
end

local STOP = {
    ["paused"] = "已暂停",
    ["blocked"] = "已阻塞",
    ["cancelled"] = "已取消",
    ["interrupted"] = "已由用户中断",
    ["awaiting user"] = "等待用户回应",
    ["cleared"] = "已清除",
    ["replaced"] = "已替换",
    ["plan mode"] = "Plan 模式",
    ["no progress"] = "无进展",
    ["auto-continue failures"] = "自动继续失败",
    ["goal limit reached"] = "已达到目标限制",
    ["token budget reached"] = "已达到 Token 预算",
    ["max auto-continues reached"] = "已达到自动继续次数上限",
    ["max duration reached"] = "已达到持续时间上限",
}

-- TS `presentGoalStopReason`.
function i18n.stopReason(reason: string, locale: string): string
    if locale ~= "zh-CN" then
        return reason
    end
    if STOP[reason] then
        return STOP[reason]
    end
    local used, budget = reason:match("^token budget reached %((%d+)/(%d+)%)$")
    if used then
        return `已达到 Token 预算（{used}/{budget}）`
    end
    local count = reason:match("^max auto%-continues reached %((%d+)%)$")
    if count then
        return `已达到自动继续次数上限（{count}）`
    end
    local seconds = reason:match("^max duration reached %((%d+)s%)$")
    if seconds then
        return `已达到持续时间上限（{seconds} 秒）`
    end
    return reason
end

local LAST = {
    ["Goal set."] = "目标已设置。",
    ["Goal recorded from Plan mode; execution paused until resumed from Build mode."] = "目标已在 Plan 模式下记录；执行已暂停，需在 Build 模式下继续。",
    ["Goal objective updated; execution paused while the session is in Plan mode."] = "目标内容已更新；会话处于 Plan 模式，因此执行已暂停。",
    ["Goal objective updated and resumed."] = "目标内容已更新并继续执行。",
    ["Goal objective updated and paused."] = "目标内容已更新并暂停。",
    ["Auto-continue paused while the session is in Plan mode."] = "会话处于 Plan 模式，因此自动继续已暂停。",
    ["Goal resumed."] = "目标已继续。",
    ["Goal paused."] = "目标已暂停。",
    ["Goal paused awaiting user input."] = "目标已暂停，等待用户回应。",
    ["Goal completed."] = "目标已完成。",
    ["Goal marked unmet."] = "目标已标记为未达成。",
    ["Goal cancelled."] = "目标已取消。",
    ["Goal interrupted by the user; explicit resume is available."] = "目标已由用户中断；可通过明确的继续命令恢复。",
    ["Goal cancelled because it was replaced."] = "目标因被替换而取消。",
    ["Auto-continue attempt canceled before delivery."] = "自动继续尝试已在发送前取消。",
    ["Auto-continue prompt sent."] = "自动继续提示已发送。",
    ["Auto-continue prompt failed repeatedly. Resume the goal to retry."] = "自动继续提示反复失败。请继续目标后重试。",
    ["Goal execution is paused while the session is in Plan mode. Switch to Build mode and resume the goal to continue."] = "会话处于 Plan 模式，因此目标执行已暂停。请切换到 Build 模式并继续目标。",
}

-- TS `presentGoalLastStatus`.
function i18n.lastStatus(status: string, locale: string): string
    if locale ~= "zh-CN" then
        return status
    end
    if LAST[status] then
        return LAST[status]
    end
    local paused = status:match("^Auto%-continue paused after (%d+) low%-progress continuation turn%(s%)%. Resume the goal to retry%.$")
    if paused then
        return `自动继续已在 {paused} 个低进展轮次后暂停。请继续目标后重试。`
    end
    local turns, limit = status:match("^Low%-progress continuation turn detected %((%d+)/(%w+)%)%.$")
    if turns and (limit == "unbounded" or limit:match("^%d+$")) then
        return `检测到低进展的继续轮次（{turns}/{if limit == "unbounded" then "不限" else limit}）。`
    end
    local reserved = status:match("^Auto%-continue (%d+) reserved%.$")
    if reserved then
        return `已预留第 {reserved} 次自动继续。`
    end
    local failed = status:match("^Auto%-continue failed (%d+) time%(s%)%.$")
    if failed then
        return `自动继续已失败 {failed} 次。`
    end
    local after = status:match("^Paused after (%d+) auto%-continue failure%(s%)%.$")
    if after then
        return `已在 {after} 次自动继续失败后暂停。`
    end
    local wrap = status:match("^(.*); wrap%-up required%.$")
    if wrap then
        return `{i18n.stopReason(wrap, locale)}；需要收尾。`
    end
    return status
end

return table.freeze(i18n)
