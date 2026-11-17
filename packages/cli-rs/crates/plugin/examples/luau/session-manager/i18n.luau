--!strict
-- TS `src/i18n`: the page's texts in English and in Chinese, by locale code.
local function plural(count: number, word: string): string
    return `{count} {word}{if count == 1 then "" else "s"}`
end

local en = {
    title = "Session Manager",
    modes = { "Directory", "Project", "Created", "Updated", "Viewed" },
    buckets = { "Today", "Yesterday", "Last 7 days", "Last 30 days", "Earlier" },
    noProject = "No repository (global)",
    now = "just now",
    minutes = function(count: number) return `{count}m ago` end,
    hours = function(count: number) return `{count}h ago` end,
    days = function(count: number) return `{count}d ago` end,
    children = function(shown: boolean) return `Subsessions: {if shown then "shown" else "hidden"}` end,
    total = function(count: number) return plural(count, "session") end,
    loading = "Loading…",
    loadFailed = function(error: string) return `Failed to load sessions: {error}` end,
    empty = "No sessions",
    placeholder = "Search titles and directories",
    matches = function(count: number) return `{count} {if count == 1 then "match" else "matches"}` end,
    noMatch = function(query: string) return `No sessions match "{query}"` end,
    hints = { "select", "open/fold", "group by", "subsessions", "rename", "delete", "delete group", "search", "refresh", "language", "back" },
    renameTitle = "Rename session",
    renamed = function(title: string) return `Renamed to "{title}"` end,
    removeTitle = "Delete session",
    removeMessage = function(title: string) return `Delete "{title}"?` end,
    removeChildren = function(count: number) return `Its {plural(count, "subsession")} will be deleted too.` end,
    removeCurrent = "This is the session you are currently using.",
    irreversible = "This cannot be undone.",
    confirm = "Delete",
    cancel = "Cancel",
    removed = function(count: number) return `Deleted {plural(count, "session")}` end,
    groupTitle = function(label: string) return `Delete group "{label}"` end,
    groupMessage = function(mode: string, label: string, count: number)
        return `All {plural(count, "session")} in the {mode} group "{label}" will be deleted, including subsessions.`
    end,
    groupCurrent = "This includes the session you are currently using.",
    groupFiltered = "Only the sessions matching the current search are included.",
    groupConfirm = function(count: number) return `Delete {count}` end,
    groupFailed = function(count: number) return `Failed to delete {plural(count, "session")}` end,
    groupRemoved = function(label: string, count: number) return `Deleted {plural(count, "session")} in "{label}"` end,
}

local zh = {
    title = "Session 管理",
    modes = { "目录", "项目", "创建时间", "最后更新", "最后查看" },
    buckets = { "今天", "昨天", "最近 7 天", "最近 30 天", "更早" },
    noProject = "无仓库 (global)",
    now = "刚刚",
    minutes = function(count: number) return `{count} 分钟前` end,
    hours = function(count: number) return `{count} 小时前` end,
    days = function(count: number) return `{count} 天前` end,
    children = function(shown: boolean) return `子 session: {if shown then "显示" else "隐藏"}` end,
    total = function(count: number) return `共 {count} 个` end,
    loading = "加载中…",
    loadFailed = function(error: string) return `加载失败：{error}` end,
    empty = "没有 session",
    placeholder = "搜索标题和目录",
    matches = function(count: number) return `{count} 个匹配` end,
    noMatch = function(query: string) return `没有匹配“{query}”的 session` end,
    hints = { "选择", "打开/折叠", "切换分类", "子 session", "重命名", "删除", "删除分类", "搜索", "刷新", "语言", "返回" },
    renameTitle = "重命名 session",
    renamed = function(title: string) return `已重命名为「{title}」` end,
    removeTitle = "删除 session",
    removeMessage = function(title: string) return `删除「{title}」？` end,
    removeChildren = function(count: number) return `它的 {count} 个子 session 也会一起删除。` end,
    removeCurrent = "这是当前正在使用的 session。",
    irreversible = "此操作不可恢复。",
    confirm = "删除",
    cancel = "取消",
    removed = function(count: number) return `已删除 {count} 个 session` end,
    groupTitle = function(label: string) return `删除分类「{label}」` end,
    groupMessage = function(mode: string, label: string, count: number)
        return `将删除「{mode}」分类「{label}」下的全部 {count} 个 session（含子 session）。`
    end,
    groupCurrent = "其中包含当前正在使用的 session。",
    groupFiltered = "只包含符合当前搜索条件的 session。",
    groupConfirm = function(count: number) return `删除 {count} 个` end,
    groupFailed = function(count: number) return `{count} 个 session 删除失败` end,
    groupRemoved = function(label: string, count: number) return `已删除分类「{label}」下的 {count} 个 session` end,
}

-- TS `LOCALES`, in the order the switch shows them.
return table.freeze({
    codes = { "en", "zh-CN" },
    labels = { en = "EN", ["zh-CN"] = "中文" },
    messages = { en = en, ["zh-CN"] = zh },
})
