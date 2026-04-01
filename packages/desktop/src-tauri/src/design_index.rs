use regex::Regex;
use std::collections::HashMap;
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

#[derive(Debug, Clone, Default)]
pub struct Index {
    components: HashMap<String, Vec<IndexEntry>>,
    classes: HashMap<String, Vec<IndexEntry>>,
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

fn scan_dir(dir: &Path, files: &mut Vec<PathBuf>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        if should_skip(&entry) {
            continue;
        }
        let path = entry.path();
        if path.is_dir() {
            scan_dir(&path, files);
        } else if has_ext(&path) {
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
    if skip(&rel) {
        return None;
    }
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
    if !idx.names.contains(&name.to_string()) {
        idx.names.push(name.to_string());
    }
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
}

fn sync(idx: &mut Index) {
    idx.names = idx.components.keys().cloned().collect();
    idx.names.sort();
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
    let mut comp = None;

    // Extract exported component names
    for cap in comp_re().captures_iter(slice) {
        let name = cap[1].to_string();
        if comp.is_none() {
            comp = Some(name.clone());
        }
        let line = content[..cap.get(0).unwrap().start()].matches('\n').count() as u32 + 1;
        push_component(idx, &rel, &name, line);
    }

    for cap in default_re().captures_iter(slice) {
        let name = cap[1].to_string();
        if comp.is_none() {
            comp = Some(name.clone());
        }
        let line = content[..cap.get(0).unwrap().start()].matches('\n').count() as u32 + 1;
        push_component(idx, &rel, &name, line);
    }

    for cap in named_re().captures_iter(slice) {
        let name = cap[1].to_string();
        if comp.is_none() {
            comp = Some(name.clone());
        }
        let line = content[..cap.get(0).unwrap().start()].matches('\n').count() as u32 + 1;
        push_component(idx, &rel, &name, line);
    }

    // Also try filename-based component (e.g. Hero.tsx → Hero)
    if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
        if stem.chars().next().is_some_and(|c| c.is_uppercase()) && stem != "index" {
            let name = stem.to_string();
            if comp.is_none() {
                comp = Some(name.clone());
            }
            push_component(idx, &rel, &name, 1);
        }
    }

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
        let line = content[..cap.get(0).unwrap().start()].matches('\n').count() as u32 + 1;
        add(&cap[1], line);
    }

    for cap in class_expr_re().captures_iter(slice) {
        let line = content[..cap.get(0).unwrap().start()].matches('\n').count() as u32 + 1;
        add(&cap[1], line);
    }
}

fn build(root: &Path) -> Index {
    let mut files = Vec::new();
    scan_dir(root, &mut files);

    let mut idx = Index::default();
    for file in &files {
        parse(file, root, &mut idx);
    }
    idx
}

fn apply(idx: &mut Index, root: &Path, paths: &[String]) {
    for raw in paths {
        let Some((path, rel)) = resolve(root, raw) else {
            continue;
        };
        trim(idx, &rel);
        if path.is_file() && has_ext(&path) {
            parse(&path, root, idx);
        }
    }
    sync(idx);
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

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

    // 1. Try component name lookup
    if let Some(name) = &component {
        if let Some(entries) = idx.components.get(name) {
            if entries.len() > 1 {
                if let Some(cls) = &classes {
                    let mut scores: HashMap<String, (u32, u32)> = HashMap::new();
                    for entry in entries {
                        scores.insert(entry.file.clone(), (0, entry.line.unwrap_or(1)));
                    }
                    for c in cls {
                        if let Some(matches) = idx.classes.get(c.as_str()) {
                            for entry in matches {
                                if let Some(score) = scores.get_mut(&entry.file) {
                                    score.0 += 1;
                                }
                            }
                        }
                    }
                    if let Some((file, (score, line))) =
                        scores.into_iter().max_by_key(|(_, (s, _))| *s)
                    {
                        if score > 0 {
                            return Ok(Some(QueryResult {
                                file,
                                line,
                                confidence: 1.0,
                            }));
                        }
                    }
                }
                return Ok(None);
            }
            if let Some(best) = entries.first() {
                return Ok(Some(QueryResult {
                    file: best.file.clone(),
                    line: best.line.unwrap_or(1),
                    confidence: 1.0,
                }));
            }
        }
    }

    // 2. Try class combination lookup
    if let Some(cls) = &classes {
        let mut scores: HashMap<String, (u32, u32)> = HashMap::new();
        for c in cls {
            if let Some(entries) = idx.classes.get(c.as_str()) {
                for e in entries {
                    let entry = scores
                        .entry(e.file.clone())
                        .or_insert((0, e.line.unwrap_or(1)));
                    entry.0 += 1;
                }
            }
        }
        if let Some((file, (score, line))) = scores.into_iter().max_by_key(|(_, (s, _))| *s) {
            let total = cls.len().max(1) as f32;
            return Ok(Some(QueryResult {
                file,
                line,
                confidence: score as f32 / total,
            }));
        }
    }

    Ok(None)
}
