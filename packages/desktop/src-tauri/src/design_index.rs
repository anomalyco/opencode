use ignore::gitignore::{Gitignore, GitignoreBuilder};
use rayon::prelude::*;
use regex::Regex;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct IndexEntry {
    pub file: String,
    pub line: Option<u32>,
    pub component: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct QueryResult {
    pub file: String,
    pub line: u32,
    pub confidence: f32,
}

#[derive(Debug, Clone, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct UsageQueryResult {
    pub file: String,
    pub line: u32,
    pub owner: Option<String>,
    pub confidence: f32,
}

#[derive(Debug, Clone)]
struct UsageEntry {
    file: String,
    line: u32,
    owner: Option<String>,
}

#[derive(Debug, Clone, Default)]
pub struct Index {
    components: HashMap<String, Vec<IndexEntry>>,
    classes: HashMap<String, Vec<IndexEntry>>,
    usages: HashMap<String, Vec<UsageEntry>>,
    names: Vec<String>,
}

pub struct DesignIndexState(pub Mutex<HashMap<String, Index>>);

const SKIP_DIRS: &[&str] = &[
    "node_modules",
    "dist",
    "build",
    ".next",
    ".nuxt",
    ".svelte-kit",
    "target",
    ".git",
    ".turbo",
    "coverage",
    "__pycache__",
    ".cache",
];

const EXTENSIONS: &[&str] = &["tsx", "jsx", "vue", "svelte", "ts", "js"];

fn comp_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r"(?m)export\s+(?:default\s+)?(?:function|const|let|class)\s+([A-Z]\w*)")
            .unwrap()
    })
}

fn default_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"(?m)export\s+default\s+([A-Z]\w*)").unwrap())
}

fn named_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"(?m)export\s*\{\s*([A-Z]\w*)").unwrap())
}

fn class_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r#"class(?:Name)?\s*=\s*["']([^"']+)["']"#).unwrap())
}

fn class_expr_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r#"class(?:Name)?\s*=\s*\{[^}]*["'`]([^"'`]+)["'`]"#).unwrap())
}

fn usage_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"<([A-Z][A-Za-z0-9_]*)\b").unwrap())
}

fn should_skip(entry: &std::fs::DirEntry) -> bool {
    let name = entry.file_name();
    let s = name.to_string_lossy();
    s.starts_with('.') || SKIP_DIRS.contains(&s.as_ref())
}

fn has_ext(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| EXTENSIONS.contains(&e))
}

fn matcher(root: &Path) -> Option<Gitignore> {
    let mut builder = GitignoreBuilder::new(root);
    for name in [".gitignore", ".ignore"] {
        let path = root.join(name);
        if path.is_file() {
            builder.add(path);
        }
    }
    builder.build().ok()
}

fn blocked(root: &Path, path: &Path, dir: bool, ignore: Option<&Gitignore>) -> bool {
    let rel = rel(path, root);
    skip(&rel)
        || ignore.is_some_and(|ignore| ignore.matched(&rel, dir).is_ignore())
}

fn scan_dir(dir: &Path, root: &Path, ignore: Option<&Gitignore>, files: &mut Vec<PathBuf>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let Ok(kind) = entry.file_type() else {
            continue;
        };
        let path = entry.path();
        if should_skip(&entry) || blocked(root, &path, kind.is_dir(), ignore) {
            continue;
        }
        if kind.is_symlink() {
            let Ok(meta) = fs::metadata(&path) else {
                continue;
            };
            if meta.is_dir() {
                continue;
            }
            if meta.is_file() && has_ext(&path) && !blocked(root, &path, false, ignore) {
                files.push(path);
            }
            continue;
        }
        if kind.is_dir() {
            scan_dir(&path, root, ignore, files);
        } else if kind.is_file() && has_ext(&path) {
            files.push(path);
        }
    }
}

fn normalize_rel(path: &str) -> String {
    path.replace('\\', "/")
}

fn windows(path: &str) -> bool {
    path.starts_with("//") || path.as_bytes().get(1) == Some(&b':')
}

fn inside(root: &Path, path: &Path) -> bool {
    let root = normalize_rel(&root.to_string_lossy())
        .trim_end_matches('/')
        .to_string();
    let path = normalize_rel(&path.to_string_lossy());
    let (root, path) = if windows(&root) {
        (root.to_lowercase(), path.to_lowercase())
    } else {
        (root, path)
    };
    path == root || path.starts_with(&(root + "/"))
}

fn skip(path: &str) -> bool {
    path.split('/')
        .any(|part| part.starts_with('.') || SKIP_DIRS.contains(&part))
}

fn rel(path: &Path, root: &Path) -> String {
    normalize_rel(&path.strip_prefix(root).unwrap_or(path).to_string_lossy())
}

fn resolve(root: &Path, input: &str) -> Option<(PathBuf, String)> {
    let path = PathBuf::from(input);
    let abs = if path.is_absolute() { path } else { root.join(path) };
    if !inside(root, &abs) {
        return None;
    }
    let rel = rel(&abs, root);
    Some((abs, rel))
}

fn push_component(idx: &mut Index, rel: &str, name: &str, line: u32) {
    let entries = idx.components.entry(name.to_string()).or_default();
    if entries.iter().any(|entry| entry.file == rel) {
        return;
    }
    entries.push(IndexEntry {
        file: rel.to_string(),
        line: Some(line),
        component: Some(name.to_string()),
    });
}

fn push_usage(idx: &mut Index, rel: &str, name: &str, owner: Option<&str>, line: u32) {
    let entries = idx.usages.entry(name.to_string()).or_default();
    if entries
        .iter()
        .any(|entry| entry.file == rel && entry.line == line && entry.owner.as_deref() == owner)
    {
        return;
    }
    entries.push(UsageEntry {
        file: rel.to_string(),
        line,
        owner: owner.map(|item| item.to_string()),
    });
}

fn push_owner(owners: &mut Vec<(u32, bool, String)>, line: u32, name: &str, explicit: bool) {
    if let Some(item) = owners
        .iter_mut()
        .find(|(item_line, _, item_name)| *item_line == line && item_name == name)
    {
        if explicit {
            item.1 = true;
        }
        return;
    }
    owners.push((line, explicit, name.to_string()));
}

fn usage_enabled(path: &Path, content: &str) -> bool {
    let ext = path
        .extension()
        .and_then(|item| item.to_str())
        .map(|item| item.to_ascii_lowercase());
    match ext.as_deref() {
        Some("tsx") | Some("jsx") | Some("vue") | Some("svelte") => true,
        Some("js") => content.contains("</") || content.contains("/>") || content.contains("React.createElement"),
        _ => false,
    }
}

fn usage_ok(content: &str, at: usize) -> bool {
    if at == 0 {
        return true;
    }
    let prev = content.as_bytes()[at - 1];
    !prev.is_ascii_alphanumeric()
        && prev != b'_'
        && prev != b'.'
        && prev != b')'
        && prev != b']'
        && prev != b'"'
        && prev != b'\''
        && prev != b'`'
}

fn owner_at<'a>(owners: &'a [(u32, bool, String)], line: u32) -> Option<&'a str> {
    owners
        .iter()
        .filter(|(item, _, _)| *item <= line)
        .max_by(|(left_line, left_explicit, _), (right_line, right_explicit, _)| {
            left_line
                .cmp(right_line)
                .then_with(|| left_explicit.cmp(right_explicit))
        })
        .or_else(|| owners.first())
        .map(|(_, _, name)| name.as_str())
}

fn trim(idx: &mut Index, rel: &str) {
    idx.components.retain(|_, entries| {
        entries.retain(|entry| entry.file != rel);
        !entries.is_empty()
    });
    idx.classes.retain(|_, entries| {
        entries.retain(|entry| entry.file != rel);
        !entries.is_empty()
    });
    idx.usages.retain(|_, entries| {
        entries.retain(|entry| entry.file != rel);
        !entries.is_empty()
    });
}

fn trim_prefix(idx: &mut Index, rel: &str) {
    idx.components.retain(|_, entries| {
        entries.retain(|entry| entry.file != rel && !entry.file.starts_with(&(rel.to_string() + "/")));
        !entries.is_empty()
    });
    idx.classes.retain(|_, entries| {
        entries.retain(|entry| entry.file != rel && !entry.file.starts_with(&(rel.to_string() + "/")));
        !entries.is_empty()
    });
    idx.usages.retain(|_, entries| {
        entries.retain(|entry| entry.file != rel && !entry.file.starts_with(&(rel.to_string() + "/")));
        !entries.is_empty()
    });
}

fn merge(dst: &mut Index, mut src: Index) {
    for (name, mut entries) in src.components.drain() {
        dst.components
            .entry(name)
            .or_default()
            .append(&mut entries);
    }
    for (name, mut entries) in src.classes.drain() {
        dst.classes.entry(name).or_default().append(&mut entries);
    }
    for (name, mut entries) in src.usages.drain() {
        dst.usages.entry(name).or_default().append(&mut entries);
    }
}

fn sync(idx: &mut Index) {
    idx.names = idx.components.keys().cloned().collect();
    idx.names.sort();
}

fn lines(content: &str) -> Vec<usize> {
    let mut out = vec![0];
    out.extend(content.match_indices('\n').map(|(i, _)| i + 1));
    out
}

fn line(lines: &[usize], offset: usize) -> u32 {
    lines.partition_point(|start| *start <= offset) as u32
}

fn parse(path: &Path, root: &Path, idx: &mut Index) {
    let Ok(content) = fs::read_to_string(path) else {
        return;
    };
    let rel = rel(path, root);
    let slice = content
        .char_indices()
        .nth(12000)
        .map(|(i, _)| &content[..i])
        .unwrap_or(&content);
    let lines = lines(&content);
    let mut comp = None;
    let mut owners = Vec::<(u32, bool, String)>::new();

    // Extract exported component names
    for cap in comp_re().captures_iter(slice) {
        let name = cap[1].to_string();
        if comp.is_none() {
            comp = Some(name.clone());
        }
        let line = line(&lines, cap.get(0).unwrap().start());
        push_owner(&mut owners, line, &name, true);
        push_component(idx, &rel, &name, line);
    }

    for cap in default_re().captures_iter(slice) {
        let name = cap[1].to_string();
        if comp.is_none() {
            comp = Some(name.clone());
        }
        let line = line(&lines, cap.get(0).unwrap().start());
        push_owner(&mut owners, line, &name, true);
        push_component(idx, &rel, &name, line);
    }

    for cap in named_re().captures_iter(slice) {
        let name = cap[1].to_string();
        if comp.is_none() {
            comp = Some(name.clone());
        }
        let line = line(&lines, cap.get(0).unwrap().start());
        push_owner(&mut owners, line, &name, true);
        push_component(idx, &rel, &name, line);
    }

    // Also try filename-based component (e.g. Hero.tsx → Hero)
    if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
        if stem.chars().next().is_some_and(|c| c.is_uppercase()) && stem != "index" {
            let name = stem.to_string();
            if comp.is_none() {
                comp = Some(name.clone());
            }
            push_owner(&mut owners, 1, &name, false);
            push_component(idx, &rel, &name, 1);
        }
    }

    owners.sort_by(|left, right| left.0.cmp(&right.0).then_with(|| right.1.cmp(&left.1)));

    // Extract class / className strings
    let mut add = |raw: &str, line: u32| {
        for cls in raw.split_whitespace() {
            if cls.len() > 2 {
                idx.classes
                    .entry(cls.to_string())
                    .or_default()
                    .push(IndexEntry {
                        file: rel.clone(),
                        line: Some(line),
                        component: comp.clone(),
                    });
            }
        }
    };

    for cap in class_re().captures_iter(slice) {
        let line = line(&lines, cap.get(0).unwrap().start());
        add(&cap[1], line);
    }

    for cap in class_expr_re().captures_iter(slice) {
        let line = line(&lines, cap.get(0).unwrap().start());
        add(&cap[1], line);
    }

    if !usage_enabled(path, &content) {
        return;
    }

    let usage = content.as_str();
    for cap in usage_re().captures_iter(usage) {
        let Some(mat) = cap.get(0) else {
            continue;
        };
        if !usage_ok(usage, mat.start()) {
            continue;
        }
        let line = line(&lines, mat.start());
        push_usage(idx, &rel, &cap[1], owner_at(&owners, line), line);
    }
}

fn build(root: &Path) -> Index {
    let mut files = Vec::new();
    let ignore = matcher(root);
    scan_dir(root, root, ignore.as_ref(), &mut files);

    let mut idx = files
        .par_iter()
        .map(|path| {
            let mut next = Index::default();
            parse(path, root, &mut next);
            next
        })
        .reduce(Index::default, |mut left, right| {
            merge(&mut left, right);
            left
        });
    sync(&mut idx);
    idx
}

fn apply(idx: &mut Index, root: &Path, paths: &[String]) {
    let ignore = matcher(root);
    let mut files = Vec::<PathBuf>::new();
    let mut rels = Vec::<String>::new();
    for raw in paths {
        let Some((path, item)) = resolve(root, raw) else {
            continue;
        };
        if blocked(root, &path, path.is_dir(), ignore.as_ref()) {
            trim_prefix(idx, &item);
            continue;
        }
        if path.is_file() && has_ext(&path) {
            trim(idx, &item);
            files.push(path);
            rels.push(item);
            continue;
        }
        if path.is_dir() {
            trim_prefix(idx, &item);
            let start = files.len();
            scan_dir(&path, root, ignore.as_ref(), &mut files);
            rels.extend(files[start..].iter().map(|next| rel(next, root)));
            continue;
        }
        trim_prefix(idx, &item);
    }

    let mut seen = HashSet::new();
    files.retain(|path| seen.insert(path.to_string_lossy().to_string()));

    rels.sort();
    rels.dedup();
    for rel in &rels {
        trim(idx, rel);
    }

    let next = files
        .par_iter()
        .map(|path| {
            let mut out = Index::default();
            parse(path, root, &mut out);
            out
        })
        .reduce(Index::default, |mut left, right| {
            merge(&mut left, right);
            left
        });
    merge(idx, next);

    sync(idx);
}

fn score_classes(
    idx: &Index,
    classes: &[String],
    allow: Option<&HashMap<String, u32>>,
) -> Option<QueryResult> {
    let mut seen = HashSet::new();
    let names = classes
        .iter()
        .filter_map(|name| seen.insert(name.as_str()).then_some(name.as_str()))
        .collect::<Vec<_>>();

    let mut scores: HashMap<String, (u32, u32)> = HashMap::new();
    for name in names.iter().copied() {
        let Some(entries) = idx.classes.get(name) else {
            continue;
        };
        let mut files = HashSet::new();
        for entry in entries {
            if !files.insert(entry.file.as_str()) {
                continue;
            }
            if let Some(allow) = allow {
                let Some(line) = allow.get(&entry.file).copied() else {
                    continue;
                };
                let score = scores.entry(entry.file.clone()).or_insert((0, line));
                score.0 += 1;
                continue;
            }
            let score = scores
                .entry(entry.file.clone())
                .or_insert((0, entry.line.unwrap_or(1)));
            score.0 += 1;
        }
    }

    let total = names.len().max(1) as f32;
    let (file, (score, line)) = scores.into_iter().max_by(|(a, (sa, _)), (b, (sb, _))| {
        sa.cmp(sb).then_with(|| b.cmp(a))
    })?;
    Some(QueryResult {
        file,
        line,
        confidence: (score as f32 / total).min(1.0),
    })
}

fn query(idx: &Index, component: Option<&str>, classes: Option<&[String]>) -> Option<QueryResult> {
    if let Some(name) = component {
        if let Some(entries) = idx.components.get(name) {
            if entries.len() > 1 {
                if let Some(classes) = classes {
                    let allow = entries
                        .iter()
                        .map(|entry| (entry.file.clone(), entry.line.unwrap_or(1)))
                        .collect::<HashMap<_, _>>();
                    return score_classes(idx, classes, Some(&allow));
                }
                return None;
            }
            if let Some(best) = entries.first() {
                return Some(QueryResult {
                    file: best.file.clone(),
                    line: best.line.unwrap_or(1),
                    confidence: 1.0,
                });
            }
        }
    }

    if let Some(classes) = classes {
        return score_classes(idx, classes, None);
    }

    None
}

fn query_usage(idx: &Index, component: &str, owners: Option<&[String]>) -> Option<UsageQueryResult> {
    let entries = idx.usages.get(component)?;
    if entries.is_empty() {
        return None;
    }

    if let Some(names) = owners {
        let allow = names
            .iter()
            .enumerate()
            .map(|(idx, name)| (name.as_str(), idx as u32))
            .collect::<HashMap<_, _>>();
        let best = entries
            .iter()
            .filter_map(|entry| {
                let owner = entry.owner.as_deref()?;
                let rank = allow.get(owner).copied()?;
                Some((rank, entry))
            })
            .min_by(|(left_rank, left), (right_rank, right)| {
                left_rank
                    .cmp(right_rank)
                    .then_with(|| left.file.cmp(&right.file))
                    .then_with(|| left.line.cmp(&right.line))
            });
        if let Some((rank, entry)) = best {
            let total = names.len().max(1) as f32;
            let confidence = (1.0 - (rank as f32 / total)).max(0.2);
            return Some(UsageQueryResult {
                file: entry.file.clone(),
                line: entry.line,
                owner: entry.owner.clone(),
                confidence,
            });
        }
        return None;
    }

    if entries.len() > 1 {
        return None;
    }
    let best = entries.first()?;
    Some(UsageQueryResult {
        file: best.file.clone(),
        line: best.line,
        owner: best.owner.clone(),
        confidence: 0.6,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    #[cfg(unix)]
    use std::os::unix::fs::symlink;

    fn temp() -> PathBuf {
        std::env::temp_dir().join(format!("opencode-design-index-{}", Uuid::new_v4()))
    }

    fn write(root: &Path, rel: &str, content: &str) -> PathBuf {
        let path = root.join(rel);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, content).unwrap();
        path
    }

    #[test]
    fn normalize_rel_uses_forward_slashes() {
        assert_eq!(
            normalize_rel(r"src\components\Hero.tsx"),
            "src/components/Hero.tsx"
        );
    }

    #[test]
    fn parse_finds_default_and_named_exports() {
        let root = temp();
        write(
            &root,
            "src/components/index.tsx",
            "const Hero = () => null\nexport default Hero\nfunction Card() { return null }\nexport { Card }\n",
        );

        let idx = build(&root);
        fs::remove_dir_all(&root).unwrap();

        assert_eq!(idx.components.get("Hero").unwrap()[0].file, "src/components/index.tsx");
        assert_eq!(idx.components.get("Card").unwrap()[0].file, "src/components/index.tsx");
    }

    #[test]
    fn parse_handles_large_utf8_files() {
        let root = temp();
        let pad = "a".repeat(11_999);
        write(
            &root,
            "src/components/Hero.tsx",
            &format!("{pad}é\nexport default function Hero() {{ return null }}\n"),
        );

        let idx = build(&root);
        fs::remove_dir_all(&root).unwrap();

        assert_eq!(idx.components.get("Hero").unwrap()[0].file, "src/components/Hero.tsx");
    }

    #[test]
    fn parse_keeps_line_numbers() {
        let root = temp();
        write(
            &root,
            "src/components/Hero.tsx",
            "\n\nexport default function Hero() {\n  return <div className=\"hero\" />\n}\n",
        );

        let idx = build(&root);
        fs::remove_dir_all(&root).unwrap();

        assert_eq!(idx.components.get("Hero").unwrap()[0].line, Some(3));
        assert_eq!(idx.classes.get("hero").unwrap()[0].line, Some(4));
    }

    #[test]
    fn apply_replaces_file_entries() {
        let root = temp();
        write(
            &root,
            "src/components/index.tsx",
            "export default Hero\nconst Hero = () => null\n<div className=\"hero\" />\n",
        );

        let mut idx = build(&root);
        write(
            &root,
            "src/components/index.tsx",
            "export default Card\nconst Card = () => null\n<div className=\"card\" />\n",
        );
        apply(&mut idx, &root, &["src/components/index.tsx".to_string()]);
        fs::remove_dir_all(&root).unwrap();

        assert!(idx.components.get("Hero").is_none());
        assert!(idx.classes.get("hero").is_none());
        assert_eq!(idx.components.get("Card").unwrap()[0].file, "src/components/index.tsx");
        assert_eq!(idx.classes.get("card").unwrap()[0].file, "src/components/index.tsx");
    }

    #[test]
    fn apply_removes_deleted_file_entries() {
        let root = temp();
        let path = write(
            &root,
            "src/components/index.tsx",
            "export default Hero\nconst Hero = () => null\n<div className=\"hero\" />\n",
        );

        let mut idx = build(&root);
        fs::remove_file(path).unwrap();
        apply(&mut idx, &root, &["src/components/index.tsx".to_string()]);
        fs::remove_dir_all(&root).unwrap();

        assert!(idx.components.get("Hero").is_none());
        assert!(idx.classes.get("hero").is_none());
        assert!(idx.names.is_empty());
    }

    #[test]
    fn apply_removes_deleted_directory_entries() {
        let root = temp();
        write(
            &root,
            "src/sections/Hero.tsx",
            "export default function Hero() { return <div className=\"hero\" /> }\n",
        );
        write(
            &root,
            "src/sections/Footer.tsx",
            "export default function Footer() { return <div className=\"footer\" /> }\n",
        );

        let mut idx = build(&root);
        fs::remove_dir_all(root.join("src/sections")).unwrap();
        apply(&mut idx, &root, &["src/sections".to_string()]);
        fs::remove_dir_all(&root).unwrap();

        assert!(idx.components.get("Hero").is_none());
        assert!(idx.components.get("Footer").is_none());
        assert!(idx.classes.get("hero").is_none());
        assert!(idx.classes.get("footer").is_none());
    }

    #[test]
    fn query_dedupes_class_hits_per_file() {
        let root = temp();
        write(
            &root,
            "src/components/A.tsx",
            "export default function A() { return <div className=\"foo foo foo\" /> }\n",
        );
        write(
            &root,
            "src/components/B.tsx",
            "export default function B() { return <div className=\"foo bar\" /> }\n",
        );

        let idx = build(&root);
        let result = query(&idx, None, Some(&["foo".to_string(), "bar".to_string()])).unwrap();
        fs::remove_dir_all(&root).unwrap();

        assert_eq!(result.file, "src/components/B.tsx");
        assert_eq!(result.confidence, 1.0);
    }

    #[test]
    fn query_breaks_ties_by_file_name() {
        let root = temp();
        write(
            &root,
            "src/components/Beta.tsx",
            "export default function Beta() { return <div className=\"foo bar\" /> }\n",
        );
        write(
            &root,
            "src/components/Alpha.tsx",
            "export default function Alpha() { return <div className=\"foo bar\" /> }\n",
        );

        let idx = build(&root);
        let result = query(&idx, None, Some(&["foo".to_string(), "bar".to_string()])).unwrap();
        fs::remove_dir_all(&root).unwrap();

        assert_eq!(result.file, "src/components/Alpha.tsx");
    }

    #[cfg(unix)]
    #[test]
    fn build_skips_symlink_dirs() {
        let root = temp();
        let other = temp();
        write(
            &root,
            "src/components/Hero.tsx",
            "export default function Hero() { return null }\n",
        );
        write(
            &other,
            "linked/Leak.tsx",
            "export default function Leak() { return null }\n",
        );
        fs::create_dir_all(root.join("src")).unwrap();
        symlink(other.join("linked"), root.join("src/linked")).unwrap();

        let idx = build(&root);
        fs::remove_dir_all(&root).unwrap();
        fs::remove_dir_all(&other).unwrap();

        assert!(idx.components.get("Hero").is_some());
        assert!(idx.components.get("Leak").is_none());
    }

    #[test]
    fn build_respects_gitignore() {
        let root = temp();
        write(&root, ".gitignore", "src/ignored/\n");
        write(
            &root,
            "src/components/Hero.tsx",
            "export default function Hero() { return null }\n",
        );
        write(
            &root,
            "src/ignored/Leak.tsx",
            "export default function Leak() { return null }\n",
        );

        let idx = build(&root);
        fs::remove_dir_all(&root).unwrap();

        assert!(idx.components.get("Hero").is_some());
        assert!(idx.components.get("Leak").is_none());
    }

    #[test]
    fn parse_extracts_component_usages() {
        let root = temp();
        write(
            &root,
            "src/sections/Hero.tsx",
            "export default function Hero() { return <GridSection><Button /></GridSection> }\n",
        );

        let idx = build(&root);
        fs::remove_dir_all(&root).unwrap();

        let usages = idx.usages.get("Button").unwrap();
        assert_eq!(usages[0].file, "src/sections/Hero.tsx");
        assert_eq!(usages[0].owner.as_deref(), Some("Hero"));
    }

    #[test]
    fn parse_ignores_ts_generics_for_usage() {
        let root = temp();
        write(
            &root,
            "src/lib/api.ts",
            "export function run() { return fetcher<ButtonPayload>() }\n",
        );

        let idx = build(&root);
        fs::remove_dir_all(&root).unwrap();

        assert!(idx.usages.get("ButtonPayload").is_none());
    }

    #[test]
    fn parse_tracks_usage_owner_per_scope() {
        let root = temp();
        write(
            &root,
            "src/sections/Mixed.tsx",
            "export function Hero() { return <Button>Hero CTA</Button> }\nexport function Footer() { return <Button>Footer CTA</Button> }\n",
        );

        let idx = build(&root);
        fs::remove_dir_all(&root).unwrap();

        let usages = idx.usages.get("Button").unwrap();
        let hero = usages
            .iter()
            .find(|entry| entry.line == 1)
            .and_then(|entry| entry.owner.as_deref());
        let footer = usages
            .iter()
            .find(|entry| entry.line == 2)
            .and_then(|entry| entry.owner.as_deref());
        assert_eq!(hero, Some("Hero"));
        assert_eq!(footer, Some("Footer"));
    }

    #[test]
    fn parse_extracts_usage_from_jsx_js() {
        let root = temp();
        write(
            &root,
            "src/sections/Hero.js",
            "export function Hero(){return <Button>Go</Button>}\n",
        );

        let idx = build(&root);
        fs::remove_dir_all(&root).unwrap();

        let usages = idx.usages.get("Button").unwrap();
        assert_eq!(usages[0].owner.as_deref(), Some("Hero"));
    }

    #[test]
    fn query_usage_prefers_owner_rank() {
        let idx = Index {
            usages: HashMap::from([(
                "Button".to_string(),
                vec![
                    UsageEntry {
                        file: "src/sections/Services.tsx".to_string(),
                        line: 10,
                        owner: Some("Services".to_string()),
                    },
                    UsageEntry {
                        file: "src/sections/Hero.tsx".to_string(),
                        line: 20,
                        owner: Some("Hero".to_string()),
                    },
                ],
            )]),
            ..Default::default()
        };

        let out = query_usage(
            &idx,
            "Button",
            Some(&["GridSection".to_string(), "Hero".to_string(), "Services".to_string()]),
        )
        .unwrap();
        assert_eq!(out.file, "src/sections/Hero.tsx");
        assert_eq!(out.owner.as_deref(), Some("Hero"));
    }

    #[test]
    fn query_usage_returns_none_when_owner_filter_misses() {
        let idx = Index {
            usages: HashMap::from([(
                "Button".to_string(),
                vec![UsageEntry {
                    file: "src/sections/Hero.tsx".to_string(),
                    line: 20,
                    owner: Some("Hero".to_string()),
                }],
            )]),
            ..Default::default()
        };

        let out = query_usage(&idx, "Button", Some(&["Layout".to_string()]));
        assert!(out.is_none());
    }

    #[test]
    fn query_usage_returns_none_when_unfiltered_is_ambiguous() {
        let idx = Index {
            usages: HashMap::from([(
                "Button".to_string(),
                vec![
                    UsageEntry {
                        file: "src/sections/Hero.tsx".to_string(),
                        line: 20,
                        owner: Some("Hero".to_string()),
                    },
                    UsageEntry {
                        file: "src/sections/Footer.tsx".to_string(),
                        line: 5,
                        owner: Some("Footer".to_string()),
                    },
                ],
            )]),
            ..Default::default()
        };

        let out = query_usage(&idx, "Button", None);
        assert!(out.is_none());
    }

    #[test]
    fn query_usage_returns_single_unfiltered_hit() {
        let idx = Index {
            usages: HashMap::from([(
                "Button".to_string(),
                vec![UsageEntry {
                    file: "src/sections/Hero.tsx".to_string(),
                    line: 20,
                    owner: Some("Hero".to_string()),
                }],
            )]),
            ..Default::default()
        };

        let out = query_usage(&idx, "Button", None).unwrap();
        assert_eq!(out.file, "src/sections/Hero.tsx");
        assert!((out.confidence - 0.6).abs() < f32::EPSILON);
    }
}

#[tauri::command]
#[specta::specta]
pub async fn build_design_index(app: AppHandle, root: String) -> Result<Vec<String>, String> {
    let dir = PathBuf::from(&root);
    if !dir.is_dir() {
        if let Ok(mut lock) = app.state::<DesignIndexState>().0.lock() {
            lock.remove(&root);
        }
        return Err(format!("Not a directory: {root}"));
    }

    let dir2 = dir.clone();
    let idx = tauri::async_runtime::spawn_blocking(move || build(&dir2))
        .await
        .map_err(|err| err.to_string())?;

    let names = idx.names.clone();
    let count = idx.components.len();
    let cls = idx.classes.len();
    let files = idx
        .components
        .values()
        .flat_map(|entries| entries.iter().map(|entry| entry.file.as_str()))
        .collect::<std::collections::HashSet<_>>()
        .len();

    let state = app.state::<DesignIndexState>();
    let mut lock = state.0.lock().map_err(|e| e.to_string())?;
    lock.insert(root, idx);

    tracing::info!(
        "Design index built: {} components, {} class entries from {} files",
        count,
        cls,
        files
    );
    Ok(names)
}

#[tauri::command]
#[specta::specta]
pub async fn update_design_index(
    app: AppHandle,
    root: String,
    paths: Vec<String>,
) -> Result<Vec<String>, String> {
    let dir = PathBuf::from(&root);
    if !dir.is_dir() {
        if let Ok(mut lock) = app.state::<DesignIndexState>().0.lock() {
            lock.remove(&root);
        }
        return Err(format!("Not a directory: {root}"));
    }

    if paths.is_empty() {
        return build_design_index(app, root).await;
    }

    let cur = {
        let state = app.state::<DesignIndexState>();
        let lock = state.0.lock().map_err(|e| e.to_string())?;
        lock.get(&root).cloned()
    };

    let dir2 = dir.clone();
    let len = paths.len();
    let idx = tauri::async_runtime::spawn_blocking(move || {
        let Some(mut idx) = cur else {
            return build(&dir2);
        };
        apply(&mut idx, &dir2, &paths);
        idx
    })
    .await
    .map_err(|err| err.to_string())?;

    let names = idx.names.clone();
    let count = idx.components.len();
    let cls = idx.classes.len();

    let state = app.state::<DesignIndexState>();
    let mut lock = state.0.lock().map_err(|e| e.to_string())?;
    lock.insert(root, idx);

    tracing::info!(
        "Design index updated: {} files, {} components, {} class entries",
        len,
        count,
        cls
    );
    Ok(names)
}

#[tauri::command]
#[specta::specta]
pub fn query_design_index(
    app: AppHandle,
    root: String,
    component: Option<String>,
    classes: Option<Vec<String>>,
) -> Result<Option<QueryResult>, String> {
    let state = app.state::<DesignIndexState>();
    let lock = state
        .0
        .lock()
        .map_err(|e: std::sync::PoisonError<_>| e.to_string())?;
    let Some(idx) = lock.get(&root) else {
        return Ok(None);
    };

    Ok(query(idx, component.as_deref(), classes.as_deref()))
}

#[tauri::command]
#[specta::specta]
pub fn query_design_usage_index(
    app: AppHandle,
    root: String,
    component: String,
    owners: Option<Vec<String>>,
) -> Result<Option<UsageQueryResult>, String> {
    let state = app.state::<DesignIndexState>();
    let lock = state
        .0
        .lock()
        .map_err(|e: std::sync::PoisonError<_>| e.to_string())?;
    let Some(idx) = lock.get(&root) else {
        return Ok(None);
    };

    Ok(query_usage(idx, &component, owners.as_deref()))
}
