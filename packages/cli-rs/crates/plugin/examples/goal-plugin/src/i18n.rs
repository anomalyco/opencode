//! TS `src/i18n.ts`, the TUI's part: its texts in English and Chinese, and the presentation of the statuses, stop
//! reasons and last statuses the plugin writes. Text it does not know stays as it came.

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Locale {
    #[default]
    En,
    ZhCn,
}

/// TS `resolveLocale`: the configured locale, `en` unless it names Chinese; `auto` reads `LC_ALL` and `LANG`. TS also
/// asks `Intl` for the system's locale, which a native plugin has no reader of.
pub fn resolve(explicit: Option<&str>) -> Locale {
    let configured = explicit.map(str::trim).unwrap_or_default();
    if configured.is_empty() {
        return Locale::En;
    }
    if !configured.eq_ignore_ascii_case("auto") {
        return candidate(configured).unwrap_or(Locale::En);
    }
    ["LC_ALL", "LANG"].iter().find_map(|name| candidate(&std::env::var(name).ok()?)).unwrap_or(Locale::En)
}

fn candidate(value: &str) -> Option<Locale> {
    let value = value.trim().replace('_', "-");
    let normalized = value.split('.').next()?.split('@').next()?.to_lowercase();
    match normalized.as_str() {
        "c" | "posix" => None,
        "zh" => Some(Locale::ZhCn),
        "en" => Some(Locale::En),
        other if other.starts_with("zh-") => Some(Locale::ZhCn),
        other if other.starts_with("en-") => Some(Locale::En),
        _ => None,
    }
}

/// TS `GoalMessages['tui']`.
pub struct Messages {
    pub title: &'static str,
    pub command_description: &'static str,
    pub refresh: &'static str,
    pub refresh_description: &'static str,
    pub history: &'static str,
    pub history_description: &'static str,
    pub pause: &'static str,
    pub pause_description: &'static str,
    pub resume: &'static str,
    pub resume_description: &'static str,
    pub clear: &'static str,
    pub clear_description: &'static str,
    pub refresh_prompt: &'static str,
    pub history_prompt: &'static str,
    pub pause_prompt: &'static str,
    pub resume_prompt: &'static str,
    pub clear_prompt: &'static str,
    pub open_session: &'static str,
    pub no_goal: &'static str,
    pub objective: &'static str,
    pub status: &'static str,
    pub time_used: &'static str,
    pub time: &'static str,
    pub tokens: &'static str,
    pub auto_continues: &'static str,
    pub tokens_remaining: &'static str,
    pub duration_limit: &'static str,
    pub no_progress_turns: &'static str,
    pub latest_checkpoint: &'static str,
    pub checkpoint: &'static str,
    pub stop_reason: &'static str,
    pub stop: &'static str,
    pub last_status: &'static str,
    pub completion_evidence: &'static str,
    pub blocker: &'static str,
    pub achieved: &'static str,
    pub unmet: &'static str,
}

pub fn messages(locale: Locale) -> &'static Messages {
    match locale {
        Locale::En => &EN,
        Locale::ZhCn => &ZH_CN,
    }
}

const EN: Messages = Messages {
    title: "Goal",
    command_description: "View, pause, resume, or clear the long-running session goal",
    refresh: "Refresh",
    refresh_description: "Ask the agent to read the current goal state",
    history: "History",
    history_description: "Ask the agent to show lifecycle history",
    pause: "Pause",
    pause_description: "Pause auto-continuation without clearing",
    resume: "Resume",
    resume_description: "Resume the goal and continue",
    clear: "Clear",
    clear_description: "Ask the agent to clear this session goal",
    refresh_prompt: "Call get_goal for this session and report the current goal state briefly.",
    history_prompt: "Call get_goal_history for this session and report the current goal history briefly.",
    pause_prompt: "Pause the current session goal by calling update_goal_status with status \"paused\". Report the result briefly.",
    resume_prompt: "Resume the current session goal by calling update_goal_status with status \"active\", then continue working toward it.",
    clear_prompt: "Clear the current session goal by calling clear_goal. Report whether a goal was cleared.",
    open_session: "Open a session before viewing goal state.",
    no_goal: "No recent goal state found in this session.",
    objective: "Objective",
    status: "Status",
    time_used: "Time used",
    time: "Time",
    tokens: "Tokens",
    auto_continues: "Auto-continues",
    tokens_remaining: "Tokens remaining",
    duration_limit: "Duration limit",
    no_progress_turns: "No-progress turns",
    latest_checkpoint: "Latest checkpoint",
    checkpoint: "Checkpoint",
    stop_reason: "Stop reason",
    stop: "Stop",
    last_status: "Last status",
    completion_evidence: "Completion evidence",
    blocker: "Blocker",
    achieved: "Goal achieved",
    unmet: "Goal unmet",
};

const ZH_CN: Messages = Messages {
    title: "目标",
    command_description: "查看、暂停、继续或清除当前会话的长期目标",
    refresh: "刷新",
    refresh_description: "让 Agent 读取当前目标状态",
    history: "历史",
    history_description: "让 Agent 显示目标生命周期历史",
    pause: "暂停",
    pause_description: "暂停自动继续，但不清除目标",
    resume: "继续",
    resume_description: "继续目标并接着执行",
    clear: "清除",
    clear_description: "让 Agent 清除当前会话目标",
    refresh_prompt: "调用 get_goal 获取此会话的当前目标，并用简体中文简要报告目标状态。",
    history_prompt: "调用 get_goal_history 获取此会话的当前目标历史，并用简体中文简要报告。",
    pause_prompt: "调用 update_goal_status 并将 status 设为 \"paused\"，暂停当前会话目标。用简体中文简要报告结果。",
    resume_prompt: "调用 update_goal_status 并将 status 设为 \"active\"，继续当前会话目标，然后继续推进该目标。请使用简体中文回复用户。",
    clear_prompt: "调用 clear_goal 清除当前会话目标，并用简体中文报告是否成功清除了目标。",
    open_session: "请先打开一个会话，再查看目标状态。",
    no_goal: "此会话中没有最近的目标状态。",
    objective: "目标",
    status: "状态",
    time_used: "已用时间",
    time: "时间",
    tokens: "Token",
    auto_continues: "自动继续次数",
    tokens_remaining: "剩余 Token",
    duration_limit: "持续时间上限",
    no_progress_turns: "无进展轮数",
    latest_checkpoint: "最新检查点",
    checkpoint: "检查点",
    stop_reason: "停止原因",
    stop: "停止",
    last_status: "最近状态",
    completion_evidence: "完成证据",
    blocker: "阻塞原因",
    achieved: "目标已达成",
    unmet: "目标未达成",
};

/// TS `presentGoalStatus`.
pub fn status(status: &str, locale: Locale) -> String {
    let shown = match (locale, status) {
        (Locale::En, "budgetLimited") => "budget limited",
        (Locale::En, "usageLimited") => "usage limited",
        (Locale::ZhCn, "active") => "进行中",
        (Locale::ZhCn, "paused") => "已暂停",
        (Locale::ZhCn, "budgetLimited") => "预算已达上限",
        (Locale::ZhCn, "usageLimited") => "使用量已达上限",
        (Locale::ZhCn, "complete") => "已完成",
        (Locale::ZhCn, "unmet") => "未达成",
        (Locale::ZhCn, "cancelled") => "已取消",
        _ => status,
    };
    shown.to_owned()
}

/// TS `presentGoalStopReason`.
pub fn stop_reason(reason: &str, locale: Locale) -> String {
    if locale == Locale::En {
        return reason.to_owned();
    }
    let direct = match reason {
        "paused" => "已暂停",
        "blocked" => "已阻塞",
        "cancelled" => "已取消",
        "interrupted" => "已由用户中断",
        "awaiting user" => "等待用户回应",
        "cleared" => "已清除",
        "replaced" => "已替换",
        "plan mode" => "Plan 模式",
        "no progress" => "无进展",
        "auto-continue failures" => "自动继续失败",
        "goal limit reached" => "已达到目标限制",
        "token budget reached" => "已达到 Token 预算",
        "max auto-continues reached" => "已达到自动继续次数上限",
        "max duration reached" => "已达到持续时间上限",
        _ => "",
    };
    if !direct.is_empty() {
        return direct.to_owned();
    }
    if let Some([used, budget]) = within(reason, "token budget reached (", ")")
        .and_then(|inner| inner.split_once('/'))
        .map(|(a, b)| [a, b])
        .filter(|parts| parts.iter().all(|part| digits(part)))
    {
        return format!("已达到 Token 预算（{used}/{budget}）");
    }
    if let Some(count) = within(reason, "max auto-continues reached (", ")").filter(|count| digits(count)) {
        return format!("已达到自动继续次数上限（{count}）");
    }
    if let Some(seconds) = within(reason, "max duration reached (", "s)").filter(|seconds| digits(seconds)) {
        return format!("已达到持续时间上限（{seconds} 秒）");
    }
    reason.to_owned()
}

/// TS `presentGoalLastStatus`.
pub fn last_status(status: &str, locale: Locale) -> String {
    if locale == Locale::En {
        return status.to_owned();
    }
    let direct = match status {
        "Goal set." => "目标已设置。",
        "Goal recorded from Plan mode; execution paused until resumed from Build mode." => {
            "目标已在 Plan 模式下记录；执行已暂停，需在 Build 模式下继续。"
        }
        "Goal objective updated; execution paused while the session is in Plan mode." => {
            "目标内容已更新；会话处于 Plan 模式，因此执行已暂停。"
        }
        "Goal objective updated and resumed." => "目标内容已更新并继续执行。",
        "Goal objective updated and paused." => "目标内容已更新并暂停。",
        "Auto-continue paused while the session is in Plan mode." => "会话处于 Plan 模式，因此自动继续已暂停。",
        "Goal resumed." => "目标已继续。",
        "Goal paused." => "目标已暂停。",
        "Goal paused awaiting user input." => "目标已暂停，等待用户回应。",
        "Goal completed." => "目标已完成。",
        "Goal marked unmet." => "目标已标记为未达成。",
        "Goal cancelled." => "目标已取消。",
        "Goal interrupted by the user; explicit resume is available." => "目标已由用户中断；可通过明确的继续命令恢复。",
        "Goal cancelled because it was replaced." => "目标因被替换而取消。",
        "Auto-continue attempt canceled before delivery." => "自动继续尝试已在发送前取消。",
        "Auto-continue prompt sent." => "自动继续提示已发送。",
        "Auto-continue prompt failed repeatedly. Resume the goal to retry." => {
            "自动继续提示反复失败。请继续目标后重试。"
        }
        "Goal execution is paused while the session is in Plan mode. Switch to Build mode and resume the goal to continue." => {
            "会话处于 Plan 模式，因此目标执行已暂停。请切换到 Build 模式并继续目标。"
        }
        _ => "",
    };
    if !direct.is_empty() {
        return direct.to_owned();
    }
    let paused = "low-progress continuation turn(s). Resume the goal to retry.";
    if let Some(count) = within(status, "Auto-continue paused after ", &format!(" {paused}")).filter(|n| digits(n)) {
        return format!("自动继续已在 {count} 个低进展轮次后暂停。请继续目标后重试。");
    }
    if let Some((turns, limit)) = within(status, "Low-progress continuation turn detected (", ").")
        .and_then(|inner| inner.split_once('/'))
        .filter(|(turns, limit)| digits(turns) && (digits(limit) || *limit == "unbounded"))
    {
        let limit = if limit == "unbounded" { "不限" } else { limit };
        return format!("检测到低进展的继续轮次（{turns}/{limit}）。");
    }
    if let Some(count) = within(status, "Auto-continue ", " reserved.").filter(|n| digits(n)) {
        return format!("已预留第 {count} 次自动继续。");
    }
    if let Some(count) = within(status, "Auto-continue failed ", " time(s).").filter(|n| digits(n)) {
        return format!("自动继续已失败 {count} 次。");
    }
    if let Some(count) = within(status, "Paused after ", " auto-continue failure(s).").filter(|n| digits(n)) {
        return format!("已在 {count} 次自动继续失败后暂停。");
    }
    if let Some(reason) = status.strip_suffix("; wrap-up required.") {
        return format!("{}；需要收尾。", stop_reason(reason, locale));
    }
    status.to_owned()
}

/// The text between `prefix` and `suffix`, if `text` is that whole.
fn within<'a>(text: &'a str, prefix: &str, suffix: &str) -> Option<&'a str> {
    text.strip_prefix(prefix)?.strip_suffix(suffix)
}

fn digits(text: &str) -> bool {
    !text.is_empty() && text.bytes().all(|byte| byte.is_ascii_digit())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn locales_resolve_as_ts() {
        let resolved: Vec<Locale> = [None, Some(""), Some("zh_CN.UTF-8"), Some("en-GB"), Some("fr"), Some("C")]
            .into_iter()
            .map(resolve)
            .collect();
        assert_eq!(resolved, [Locale::En, Locale::En, Locale::ZhCn, Locale::En, Locale::En, Locale::En]);
    }

    #[test]
    fn chinese_presents_what_the_plugin_writes_and_keeps_the_rest() {
        let zh = Locale::ZhCn;
        assert_eq!(stop_reason("token budget reached (10/20)", zh), "已达到 Token 预算（10/20）");
        assert_eq!(stop_reason("max duration reached (60s)", zh), "已达到持续时间上限（60 秒）");
        assert_eq!(stop_reason("my reason", zh), "my reason");
        assert_eq!(
            last_status("Low-progress continuation turn detected (2/unbounded).", zh),
            "检测到低进展的继续轮次（2/不限）。"
        );
        assert_eq!(last_status("plan mode; wrap-up required.", zh), "Plan 模式；需要收尾。");
        assert_eq!(last_status("Goal paused.", Locale::En), "Goal paused.");
        assert_eq!(status("budgetLimited", Locale::En), "budget limited");
    }
}
