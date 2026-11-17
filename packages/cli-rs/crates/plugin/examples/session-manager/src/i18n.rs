//! TS `src/i18n`: the page's texts in English and in Chinese, by locale.

/// TS `Locale`: a code, and its label in its own language.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Locale {
    En,
    ZhCn,
}

pub const LOCALES: [Locale; 2] = [Locale::En, Locale::ZhCn];

impl Locale {
    pub fn code(self) -> &'static str {
        match self {
            Locale::En => "en",
            Locale::ZhCn => "zh-CN",
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Locale::En => "EN",
            Locale::ZhCn => "中文",
        }
    }

    pub fn parse(code: &str) -> Option<Locale> {
        LOCALES.into_iter().find(|locale| locale.code() == code)
    }

    /// TS `nextLocale`.
    pub fn next(self) -> Locale {
        match self {
            Locale::En => Locale::ZhCn,
            Locale::ZhCn => Locale::En,
        }
    }

    pub fn messages(self) -> &'static Messages {
        match self {
            Locale::En => &EN,
            Locale::ZhCn => &ZH_CN,
        }
    }
}

/// TS `Messages`.
pub struct Messages {
    pub title: &'static str,
    /// By [`crate::grouping::Mode`]'s order.
    pub modes: [&'static str; 5],
    /// By [`crate::grouping::Bucket`]'s order.
    pub buckets: [&'static str; 5],
    pub no_project: &'static str,
    pub now: &'static str,
    pub minutes: fn(u64) -> String,
    pub hours: fn(u64) -> String,
    pub days: fn(u64) -> String,
    pub children: fn(bool) -> String,
    pub total: fn(usize) -> String,
    pub loading: &'static str,
    pub load_failed: fn(&str) -> String,
    pub empty: &'static str,
    pub placeholder: &'static str,
    pub matches: fn(usize) -> String,
    pub no_match: fn(&str) -> String,
    /// The hints row: select, open, mode, children, rename, delete, delete group, search, refresh, language, back.
    pub hints: [&'static str; 11],
    pub rename_title: &'static str,
    pub renamed: fn(&str) -> String,
    pub remove_title: &'static str,
    pub remove_message: fn(&str) -> String,
    pub remove_children: fn(usize) -> String,
    pub remove_current: &'static str,
    pub irreversible: &'static str,
    pub confirm: &'static str,
    pub cancel: &'static str,
    pub removed: fn(usize) -> String,
    pub group_title: fn(&str) -> String,
    pub group_message: fn(&str, &str, usize) -> String,
    pub group_current: &'static str,
    pub group_filtered: &'static str,
    pub group_confirm: fn(usize) -> String,
    pub group_failed: fn(usize) -> String,
    pub group_removed: fn(&str, usize) -> String,
}

/// `count word`, with an `s` past one.
fn plural(count: usize, word: &str) -> String {
    format!("{count} {word}{}", if count == 1 { "" } else { "s" })
}

pub static EN: Messages = Messages {
    title: "Session Manager",
    modes: ["Directory", "Project", "Created", "Updated", "Viewed"],
    buckets: ["Today", "Yesterday", "Last 7 days", "Last 30 days", "Earlier"],
    no_project: "No repository (global)",
    now: "just now",
    minutes: |count| format!("{count}m ago"),
    hours: |count| format!("{count}h ago"),
    days: |count| format!("{count}d ago"),
    children: |shown| format!("Subsessions: {}", if shown { "shown" } else { "hidden" }),
    total: |count| plural(count, "session"),
    loading: "Loading…",
    load_failed: |error| format!("Failed to load sessions: {error}"),
    empty: "No sessions",
    placeholder: "Search titles and directories",
    matches: |count| format!("{count} {}", if count == 1 { "match" } else { "matches" }),
    no_match: |query| format!("No sessions match \"{query}\""),
    hints: [
        "select",
        "open/fold",
        "group by",
        "subsessions",
        "rename",
        "delete",
        "delete group",
        "search",
        "refresh",
        "language",
        "back",
    ],
    rename_title: "Rename session",
    renamed: |title| format!("Renamed to \"{title}\""),
    remove_title: "Delete session",
    remove_message: |title| format!("Delete \"{title}\"?"),
    remove_children: |count| format!("Its {} will be deleted too.", plural(count, "subsession")),
    remove_current: "This is the session you are currently using.",
    irreversible: "This cannot be undone.",
    confirm: "Delete",
    cancel: "Cancel",
    removed: |count| format!("Deleted {}", plural(count, "session")),
    group_title: |label| format!("Delete group \"{label}\""),
    group_message: |mode, label, count| {
        format!(
            "All {} in the {mode} group \"{label}\" will be deleted, including subsessions.",
            plural(count, "session")
        )
    },
    group_current: "This includes the session you are currently using.",
    group_filtered: "Only the sessions matching the current search are included.",
    group_confirm: |count| format!("Delete {count}"),
    group_failed: |count| format!("Failed to delete {}", plural(count, "session")),
    group_removed: |label, count| format!("Deleted {} in \"{label}\"", plural(count, "session")),
};

pub static ZH_CN: Messages = Messages {
    title: "Session 管理",
    modes: ["目录", "项目", "创建时间", "最后更新", "最后查看"],
    buckets: ["今天", "昨天", "最近 7 天", "最近 30 天", "更早"],
    no_project: "无仓库 (global)",
    now: "刚刚",
    minutes: |count| format!("{count} 分钟前"),
    hours: |count| format!("{count} 小时前"),
    days: |count| format!("{count} 天前"),
    children: |shown| format!("子 session: {}", if shown { "显示" } else { "隐藏" }),
    total: |count| format!("共 {count} 个"),
    loading: "加载中…",
    load_failed: |error| format!("加载失败：{error}"),
    empty: "没有 session",
    placeholder: "搜索标题和目录",
    matches: |count| format!("{count} 个匹配"),
    no_match: |query| format!("没有匹配“{query}”的 session"),
    hints: [
        "选择",
        "打开/折叠",
        "切换分类",
        "子 session",
        "重命名",
        "删除",
        "删除分类",
        "搜索",
        "刷新",
        "语言",
        "返回",
    ],
    rename_title: "重命名 session",
    renamed: |title| format!("已重命名为「{title}」"),
    remove_title: "删除 session",
    remove_message: |title| format!("删除「{title}」？"),
    remove_children: |count| format!("它的 {count} 个子 session 也会一起删除。"),
    remove_current: "这是当前正在使用的 session。",
    irreversible: "此操作不可恢复。",
    confirm: "删除",
    cancel: "取消",
    removed: |count| format!("已删除 {count} 个 session"),
    group_title: |label| format!("删除分类「{label}」"),
    group_message: |mode, label, count| {
        format!("将删除「{mode}」分类「{label}」下的全部 {count} 个 session（含子 session）。")
    },
    group_current: "其中包含当前正在使用的 session。",
    group_filtered: "只包含符合当前搜索条件的 session。",
    group_confirm: |count| format!("删除 {count} 个"),
    group_failed: |count| format!("{count} 个 session 删除失败"),
    group_removed: |label, count| format!("已删除分类「{label}」下的 {count} 个 session"),
};
