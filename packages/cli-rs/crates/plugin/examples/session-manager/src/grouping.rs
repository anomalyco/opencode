//! TS `src/grouping.ts`: sessions grouped by directory, project or time, as a tree of subsessions, flattened to the
//! page's rows, and filtered by a search.
//!
//! TS reads dates in the local time zone (`Date#getHours`, `setHours(0)`); so does the port, by the host's UTC offset
//! of each time (`Read::utc_offset`), which `wall` applies: an instant to the local wall clock, in milliseconds.

use std::collections::{HashMap, HashSet};

use crate::i18n::Messages;

/// TS `GroupMode`, in the order Tab steps through them.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Mode {
    Directory,
    Project,
    Created,
    Updated,
    Viewed,
}

pub const MODES: [Mode; 5] = [Mode::Directory, Mode::Project, Mode::Created, Mode::Updated, Mode::Viewed];

impl Mode {
    pub fn index(self) -> usize {
        MODES.iter().position(|mode| *mode == self).unwrap_or(0)
    }

    pub fn name(self) -> &'static str {
        ["directory", "project", "created", "updated", "viewed"][self.index()]
    }

    pub fn parse(name: &str) -> Option<Mode> {
        MODES.into_iter().find(|mode| mode.name() == name)
    }

    /// The mode `delta` steps away, around.
    pub fn step(self, delta: isize) -> Mode {
        MODES[(self.index() as isize + delta).rem_euclid(MODES.len() as isize) as usize]
    }
}

/// A session as the page reads it from `session.list`.
#[derive(Clone, Debug, PartialEq)]
pub struct Session {
    pub id: String,
    pub parent: Option<String>,
    pub project: String,
    pub title: Option<String>,
    pub created: f64,
    pub updated: f64,
    pub viewed: Option<f64>,
    pub directory: String,
}

impl Session {
    pub fn from_json(value: &serde_json::Value) -> Option<Session> {
        let text = |key: &str| value.get(key).and_then(serde_json::Value::as_str).map(str::to_owned);
        let time = value.get("time")?;
        Some(Session {
            id: text("id")?,
            parent: text("parentID"),
            project: text("projectID").unwrap_or_default(),
            title: text("title"),
            created: time.get("created")?.as_f64()?,
            updated: time.get("updated")?.as_f64()?,
            viewed: time.get("viewed").and_then(serde_json::Value::as_f64),
            directory: value.pointer("/location/directory")?.as_str()?.to_owned(),
        })
    }

    /// TS `titleOf`: the title, else the ID.
    pub fn title(&self) -> &str {
        self.title.as_deref().map(str::trim).filter(|title| !title.is_empty()).unwrap_or(&self.id)
    }

    /// TS `sortTime`.
    pub fn time(&self, mode: Mode) -> f64 {
        match mode {
            Mode::Created => self.created,
            Mode::Viewed => self.viewed.unwrap_or(self.updated),
            _ => self.updated,
        }
    }
}

const DAY: f64 = 86_400_000.0;

/// TS `timeBucket`'s index: today, yesterday, the last 7 days, the last 30, earlier, by local midnights.
pub fn bucket(time: f64, now: f64, wall: &dyn Fn(f64) -> f64) -> usize {
    let today = (wall(now) / DAY).floor() * DAY;
    let time = wall(time);
    [today, today - DAY, today - 6.0 * DAY, today - 29.0 * DAY].iter().position(|start| time >= *start).unwrap_or(4)
}

/// TS `formatAge`: `just now`, `5m ago`, `3h ago`, `2d ago`, else the date.
pub fn age(time: f64, now: f64, wall: &dyn Fn(f64) -> f64, messages: &Messages) -> String {
    let minutes = ((now - time).max(0.0) / 60_000.0).floor() as u64;
    let (hours, days) = (minutes / 60, minutes / 60 / 24);
    match () {
        _ if minutes < 1 => messages.now.to_owned(),
        _ if minutes < 60 => (messages.minutes)(minutes),
        _ if hours < 24 => (messages.hours)(hours),
        _ if days < 30 => (messages.days)(days),
        _ => date(wall(time)),
    }
}

/// `YYYY-MM-DD` of the wall clock `time` (Howard Hinnant's `civil_from_days`).
fn date(time: f64) -> String {
    let days = (time / DAY).floor() as i64 + 719_468;
    let era = days.div_euclid(146_097);
    let day_of_era = days.rem_euclid(146_097);
    let year_of_era = (day_of_era - day_of_era / 1460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_index = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * month_index + 2) / 5 + 1;
    let month = if month_index < 10 { month_index + 3 } else { month_index - 9 };
    let year = year_of_era + era * 400 + i64::from(month <= 2);
    format!("{year}-{month:02}-{day:02}")
}

/// A session and the subsessions shown under it.
pub struct Tree {
    pub session: usize,
    pub children: Vec<Tree>,
}

/// TS `Group`.
pub struct Group {
    pub key: String,
    pub label: String,
    pub roots: Vec<Tree>,
    pub count: usize,
}

/// TS `Row`.
pub enum Row {
    Group { group: usize, collapsed: bool },
    Session { session: usize, group: usize, depth: usize, prefix: String },
}

/// TS `buildGroups`, over the sessions at `shown` of `sessions`.
pub fn groups(
    sessions: &[Session],
    shown: &[usize],
    mode: Mode,
    children: bool,
    now: f64,
    wall: &dyn Fn(f64) -> f64,
    label: impl Fn(&str) -> String,
) -> Vec<Group> {
    let ids: HashSet<&str> = shown.iter().map(|&index| sessions[index].id.as_str()).collect();
    let root = |index: usize| sessions[index].parent.as_deref().is_none_or(|parent| !ids.contains(parent));
    let by_time = |a: &Tree, b: &Tree| sessions[b.session].time(mode).total_cmp(&sessions[a.session].time(mode));
    let index_of: HashMap<&str, usize> = shown.iter().map(|&index| (sessions[index].id.as_str(), index)).collect();
    fn tree(
        session: usize,
        kids: &HashMap<usize, Vec<usize>>,
        by_time: &dyn Fn(&Tree, &Tree) -> std::cmp::Ordering,
    ) -> Tree {
        let mut children: Vec<Tree> =
            kids.get(&session).into_iter().flatten().map(|&child| tree(child, kids, by_time)).collect();
        children.sort_by(by_time);
        Tree { session, children }
    }
    let mut kids: HashMap<usize, Vec<usize>> = HashMap::new();
    if children {
        for &index in shown.iter().filter(|&&index| !root(index)) {
            let parent = index_of[sessions[index].parent.as_deref().unwrap_or_default()];
            kids.entry(parent).or_default().push(index);
        }
    }
    let mut buckets: Vec<(String, Vec<Tree>)> = Vec::new();
    for &index in shown.iter().filter(|&&index| root(index)) {
        let session = &sessions[index];
        let key = match mode {
            Mode::Directory => session.directory.clone(),
            Mode::Project => session.project.clone(),
            _ => bucket(session.time(mode), now, wall).to_string(),
        };
        let node = tree(index, &kids, &by_time);
        match buckets.iter_mut().find(|(known, _)| *known == key) {
            Some((_, roots)) => roots.push(node),
            None => buckets.push((key, vec![node])),
        }
    }
    let count = |roots: &[Tree]| -> usize {
        fn nodes(trees: &[Tree]) -> usize {
            trees.iter().map(|tree| 1 + nodes(&tree.children)).sum()
        }
        nodes(roots)
    };
    let mut groups: Vec<Group> = buckets
        .into_iter()
        .map(|(key, mut roots)| {
            roots.sort_by(by_time);
            Group { label: label(&key), count: count(&roots), key, roots }
        })
        .collect();
    match mode {
        Mode::Directory | Mode::Project => {
            let latest = |group: &Group| {
                group.roots.iter().map(|tree| sessions[tree.session].updated).fold(f64::NEG_INFINITY, f64::max)
            };
            groups.sort_by(|a, b| latest(b).total_cmp(&latest(a)));
        }
        _ => groups.sort_by_key(|group| group.key.parse::<usize>().unwrap_or(0)),
    }
    groups
}

/// TS `flattenRows`: each group's row, then, unless it is folded, its sessions as a tree.
pub fn rows(groups: &[Group], collapsed: &HashSet<String>) -> Vec<Row> {
    fn walk(rows: &mut Vec<Row>, group: usize, tree: &Tree, depth: usize, indent: &str, last: bool) {
        let prefix =
            if depth == 0 { String::new() } else { format!("{indent}{}", if last { "└─ " } else { "├─ " }) };
        rows.push(Row::Session { session: tree.session, group, depth, prefix });
        let indent = if depth == 0 { String::new() } else { format!("{indent}{}", if last { "   " } else { "│  " }) };
        for (index, child) in tree.children.iter().enumerate() {
            walk(rows, group, child, depth + 1, &indent, index + 1 == tree.children.len());
        }
    }
    let mut rows = Vec::new();
    for (index, group) in groups.iter().enumerate() {
        let folded = collapsed.contains(&group.key);
        rows.push(Row::Group { group: index, collapsed: folded });
        if !folded {
            group.roots.iter().for_each(|root| walk(&mut rows, index, root, 0, "", true));
        }
    }
    rows
}

/// TS `filterSessions`: the sessions matching every word of `query`, with the ancestors of a matching subsession
/// when `children`; else only top-level sessions are searched.
pub fn filter(sessions: &[Session], query: &str, text: impl Fn(&Session) -> String, children: bool) -> Vec<usize> {
    let terms: Vec<String> = query.to_lowercase().split_whitespace().map(str::to_owned).collect();
    if terms.is_empty() {
        return (0..sessions.len()).collect();
    }
    let index_of: HashMap<&str, usize> =
        sessions.iter().enumerate().map(|(index, session)| (session.id.as_str(), index)).collect();
    let root = |session: &Session| session.parent.as_deref().is_none_or(|parent| !index_of.contains_key(parent));
    let mut keep: HashSet<usize> = HashSet::new();
    for (index, session) in sessions.iter().enumerate() {
        if !children && !root(session) {
            continue;
        }
        let haystack = text(session).to_lowercase();
        if !terms.iter().all(|term| haystack.contains(term.as_str())) {
            continue;
        }
        let mut cursor = Some(index);
        while let Some(at) = cursor.filter(|at| keep.insert(*at)) {
            cursor = sessions[at].parent.as_deref().and_then(|parent| index_of.get(parent).copied());
        }
    }
    (0..sessions.len()).filter(|index| keep.contains(index)).collect()
}

/// TS `countWithDescendants`.
pub fn with_descendants(ids: &[String], sessions: &[Session]) -> usize {
    let mut children: HashMap<&str, Vec<&str>> = HashMap::new();
    for session in sessions {
        if let Some(parent) = &session.parent {
            children.entry(parent.as_str()).or_default().push(&session.id);
        }
    }
    fn descendants(id: &str, children: &HashMap<&str, Vec<&str>>) -> usize {
        children.get(id).into_iter().flatten().map(|child| 1 + descendants(child, children)).sum()
    }
    ids.iter().map(|id| 1 + descendants(id, &children)).sum()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dates_and_buckets_read_as_ts_in_local_time() {
        assert_eq!(date(1_700_200_000_000.0), "2023-11-17");
        assert_eq!(date(0.0), "1970-01-01");
        let utc = |time: f64| time;
        let now = 1_700_200_000_000.0;
        let buckets: Vec<usize> = [now, now - DAY, now - 3.0 * DAY, now - 20.0 * DAY, now - 40.0 * DAY]
            .into_iter()
            .map(|time| bucket(time, now, &utc))
            .collect();
        assert_eq!(buckets, [0, 1, 2, 3, 4]);
        // 2023-11-17 05:46 UTC is still the 16th at UTC−8, and an hour before midnight at UTC+2 is yesterday there.
        let pacific = |time: f64| time - 8.0 * 3_600_000.0;
        assert_eq!(date(pacific(1_700_200_000_000.0)), "2023-11-16");
        let east = |time: f64| time + 2.0 * 3_600_000.0;
        let midnight = 1_700_179_200_000.0 - 2.0 * 3_600_000.0;
        assert_eq!((bucket(midnight, midnight + 3_600_000.0, &east), bucket(midnight - 3_600_000.0, midnight, &east)), (0, 1));
    }

    #[test]
    fn subsessions_hang_under_their_parents_in_rows() {
        let session = |id: &str, parent: Option<&str>, updated: f64| Session {
            id: id.into(),
            parent: parent.map(str::to_owned),
            project: "p".into(),
            title: Some(id.into()),
            created: updated,
            updated,
            viewed: None,
            directory: "/d".into(),
        };
        let sessions = vec![
            session("a", None, 3.0),
            session("b", Some("a"), 2.0),
            session("c", Some("a"), 1.0),
            session("d", Some("b"), 0.5),
        ];
        let groups = groups(&sessions, &[0, 1, 2, 3], Mode::Directory, true, 10.0, str::to_owned);
        let prefixes: Vec<String> = rows(&groups, &HashSet::new())
            .into_iter()
            .filter_map(|row| match row {
                Row::Session { session, prefix, .. } => Some(format!("{prefix}{}", sessions[session].id)),
                Row::Group { .. } => None,
            })
            .collect();
        assert_eq!(prefixes, ["a", "├─ b", "│  └─ d", "└─ c"]);
        assert_eq!(groups[0].count, 4);
        assert_eq!(filter(&sessions, "d", |session| session.id.clone(), true), [0, 1, 3]);
        assert_eq!(with_descendants(&["a".to_owned()], &sessions), 4);
    }
}
