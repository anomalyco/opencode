mod cli;
mod constants;
#[cfg(target_os = "linux")]
pub mod linux_display;
#[cfg(target_os = "linux")]
pub mod linux_windowing;
mod logging;
mod markdown;
mod os;
mod server;
mod window_customizer;
mod windows;

use crate::cli::CommandChild;
use futures::FutureExt;
use serde_json::json;
use std::{
    env, fs,
    net::TcpListener,
    path::PathBuf,
    process::Command,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use tauri::{AppHandle, Listener, Manager, RunEvent, State, ipc::Channel, path::BaseDirectory};
#[cfg(any(target_os = "linux", all(debug_assertions, windows)))]
use tauri_plugin_deep_link::DeepLinkExt;
use tauri_specta::Event;
use tokio::{
    sync::{oneshot, watch},
    time::{sleep, timeout},
};

use crate::cli::{sqlite_migration::SqliteMigrationProgress, sync_cli};
use crate::constants::*;
use crate::windows::{LoadingWindow, MainWindow};

#[derive(Clone, serde::Serialize, specta::Type, Debug)]
#[serde(rename_all = "camelCase")]
struct ConfigFile {
    id: String,
    label: String,
    path: String,
    exists: bool,
    scope: String,
    kind: String,
}

#[derive(Clone, serde::Serialize, specta::Type, Debug)]
#[serde(rename_all = "camelCase")]
struct ConfigWorkspaceFile {
    name: String,
    path: String,
    kind: String,
}

#[derive(Clone, serde::Serialize, specta::Type, Debug)]
#[serde(rename_all = "camelCase")]
struct ConfigWorkspace {
    config_root: Option<String>,
    agents_root: Option<String>,
    skills_root: Option<String>,
    plugins_root: Option<String>,
    agents_md_path: Option<String>,
    agents: Vec<ConfigWorkspaceFile>,
    plugins: Vec<ConfigWorkspaceFile>,
}

#[derive(Clone, serde::Serialize, specta::Type, Debug)]
#[serde(rename_all = "camelCase")]
struct ConfigTreeItem {
    path: String,
    kind: String,
}

#[derive(Clone, serde::Serialize, specta::Type, Debug)]
#[serde(rename_all = "camelCase")]
struct TrellisTask {
    id: String,
    name: String,
    title: String,
    status: String,
    priority: Option<String>,
    assignee: Option<String>,
    package: Option<String>,
    parent: Option<String>,
    children: Vec<String>,
    created_at: Option<String>,
    completed_at: Option<String>,
    path: String,
    worktree_root: String,
    worktree_name: String,
    current: bool,
}

#[derive(Clone, serde::Serialize, specta::Type, Debug)]
#[serde(rename_all = "camelCase")]
struct TrellisTaskList {
    root: String,
    current: Option<String>,
    skipped: u32,
    tasks: Vec<TrellisTask>,
}

#[derive(Clone, serde::Serialize, specta::Type, Debug)]
struct ServerReadyData {
    url: String,
    username: Option<String>,
    password: Option<String>,
}

#[derive(Clone, serde::Serialize, specta::Type, Debug)]
#[serde(rename_all = "camelCase")]
struct OpenclawTestResult {
    ok: bool,
    logs: Vec<String>,
}

#[derive(Clone, serde::Serialize, specta::Type, Debug)]
#[serde(rename_all = "camelCase")]
struct GenericagentTestResult {
    ok: bool,
    logs: Vec<String>,
}

#[derive(Clone, serde::Serialize, specta::Type, Debug)]
#[serde(rename_all = "camelCase")]
struct HermesTestResult {
    ok: bool,
    logs: Vec<String>,
}

#[derive(Clone, serde::Serialize, specta::Type, Debug)]
#[serde(tag = "phase", rename_all = "snake_case")]
enum InitStep {
    ServerWaiting,
    SqliteWaiting,
    Done,
    Failed { detail: String },
}

#[derive(serde::Deserialize, specta::Type)]
#[serde(rename_all = "snake_case")]
enum WslPathMode {
    Windows,
    Linux,
}

struct InitState {
    current: watch::Receiver<InitStep>,
}

#[derive(Clone, serde::Serialize, specta::Type, Debug)]
#[serde(rename_all = "camelCase")]
struct StartupSample {
    origin: String,
    phase: String,
    native_elapsed_ms: u32,
    delta_ms: u32,
    frontend_elapsed_ms: Option<f64>,
    detail: Option<String>,
}

struct StartupState {
    start: Instant,
    last: Mutex<Instant>,
    list: Mutex<Vec<StartupSample>>,
}

impl StartupState {
    fn new() -> Self {
        let now = Instant::now();
        Self {
            start: now,
            last: Mutex::new(now),
            list: Mutex::new(Vec::new()),
        }
    }
}

struct ServerState {
    child: Arc<Mutex<Option<CommandChild>>>,
    hostname: String,
    port: u32,
    password: Arc<Mutex<String>>,
}

struct OpenclawState {
    child: Arc<Mutex<Option<CommandChild>>>,
    data: Arc<Mutex<Option<ServerReadyData>>>,
    config: Arc<Mutex<Option<server::OpenclawConfig>>>,
    test: Arc<Mutex<Option<CommandChild>>>,
}

struct GenericagentState {
    child: Arc<Mutex<Option<CommandChild>>>,
    data: Arc<Mutex<Option<ServerReadyData>>>,
    config: Arc<Mutex<Option<server::GenericagentConfig>>>,
    test: Arc<Mutex<Option<CommandChild>>>,
}

struct HermesState {
    child: Arc<Mutex<Option<CommandChild>>>,
    data: Arc<Mutex<Option<ServerReadyData>>>,
    config: Arc<Mutex<Option<server::HermesConfig>>>,
    test: Arc<Mutex<Option<CommandChild>>>,
}

/// Resolves with sidecar credentials as soon as the sidecar is spawned (before health check).
struct SidecarReady(futures::future::Shared<oneshot::Receiver<Option<ServerReadyData>>>);

#[derive(Clone, Default)]
struct InitialPathState(Arc<Mutex<Option<String>>>);

const BRIDGE_FILE: &str = "openclaw-bridge.json";

fn config_root() -> Option<PathBuf> {
    if let Ok(dir) = env::var("XDG_CONFIG_HOME") {
        if !dir.is_empty() {
            return Some(PathBuf::from(dir).join("opencode"));
        }
    }

    if let Ok(dir) = env::var("HOME") {
        if !dir.is_empty() {
            return Some(PathBuf::from(dir).join(".config").join("opencode"));
        }
    }

    dirs::home_dir().map(|dir| dir.join(".config").join("opencode"))
}

fn expand_user_path(input: &str) -> PathBuf {
    let trimmed = input.trim();
    if trimmed == "~" {
        if let Some(home) = dirs::home_dir() {
            return home;
        }
    }
    if let Some(rest) = trimmed.strip_prefix("~/") {
        if let Some(home) = dirs::home_dir() {
            return home.join(rest);
        }
    }
    PathBuf::from(trimmed)
}

fn startup_mark(
    app: &AppHandle,
    origin: &str,
    phase: &str,
    detail: Option<String>,
    frontend_elapsed_ms: Option<f64>,
) -> StartupSample {
    let Some(state) = app.try_state::<StartupState>() else {
        let sample = StartupSample {
            origin: origin.to_string(),
            phase: phase.to_string(),
            native_elapsed_ms: 0,
            delta_ms: 0,
            frontend_elapsed_ms,
            detail,
        };

        tracing::info!(
            origin,
            phase,
            native_elapsed_ms = sample.native_elapsed_ms,
            delta_ms = sample.delta_ms,
            frontend_elapsed_ms = ?sample.frontend_elapsed_ms,
            detail = ?sample.detail,
            "Startup profile"
        );

        return sample;
    };

    let state = state.inner();
    let now = Instant::now();
    let native_elapsed_ms = now.duration_since(state.start).as_millis() as u32;
    let delta_ms = state
        .last
        .lock()
        .map(|mut last| {
            let delta = now.duration_since(*last).as_millis() as u32;
            *last = now;
            delta
        })
        .unwrap_or_default();

    let sample = StartupSample {
        origin: origin.to_string(),
        phase: phase.to_string(),
        native_elapsed_ms,
        delta_ms,
        frontend_elapsed_ms,
        detail,
    };

    if let Ok(mut list) = state.list.lock() {
        list.push(sample.clone());
    }

    tracing::info!(
        origin,
        phase,
        native_elapsed_ms = sample.native_elapsed_ms,
        delta_ms = sample.delta_ms,
        frontend_elapsed_ms = ?sample.frontend_elapsed_ms,
        detail = ?sample.detail,
        "Startup profile"
    );

    sample
}

fn reload_webview(app: &AppHandle) -> Result<(), String> {
    let Some(window) = app.get_webview_window(MainWindow::LABEL) else {
        tracing::warn!("reload webview skipped: main window missing");
        return Err("Main window not found".to_string());
    };

    tracing::info!(label = %window.label(), "reloading webview");
    window.reload().map_err(|err| {
        tracing::warn!(label = %window.label(), error = ?err, "reload webview failed");
        err.to_string()
    })
}

fn push_config_file(
    list: &mut Vec<ConfigFile>,
    id: &str,
    label: &str,
    path: PathBuf,
    scope: &str,
    kind: &str,
) {
    let exists = path.is_file();
    list.push(ConfigFile {
        id: id.to_string(),
        label: label.to_string(),
        path: path.to_string_lossy().to_string(),
        exists,
        scope: scope.to_string(),
        kind: kind.to_string(),
    });
}

fn list_workspace_files(dir: &PathBuf, exts: &[&str], kind: &str) -> Vec<ConfigWorkspaceFile> {
    let Ok(entries) = fs::read_dir(dir) else {
        return Vec::new();
    };

    let mut list = entries
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.path())
        .filter(|path| path.is_file())
        .filter(|path| {
            path.extension()
                .and_then(|ext| ext.to_str())
                .is_some_and(|ext| exts.iter().any(|item| item.eq_ignore_ascii_case(ext)))
        })
        .map(|path| ConfigWorkspaceFile {
            name: path
                .file_stem()
                .and_then(|name| name.to_str())
                .unwrap_or_default()
                .to_string(),
            path: path.to_string_lossy().to_string(),
            kind: kind.to_string(),
        })
        .collect::<Vec<_>>();

    list.sort_by(|a, b| a.name.cmp(&b.name));
    list
}

#[tauri::command]
#[specta::specta]
fn list_config_directory(path: String) -> Result<Vec<ConfigTreeItem>, String> {
    let root = expand_user_path(&path);
    let Ok(entries) = fs::read_dir(&root) else {
        return Ok(Vec::new());
    };

    let mut list = entries
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.path())
        .map(|path| ConfigTreeItem {
            path: path.to_string_lossy().to_string(),
            kind: if path.is_dir() {
                "directory".to_string()
            } else {
                "file".to_string()
            },
        })
        .collect::<Vec<_>>();

    list.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(list)
}

#[tauri::command]
#[specta::specta]
fn get_config_workspace() -> ConfigWorkspace {
    let root = config_root();
    let agents_root = root.as_ref().map(|dir| dir.join("agents"));
    let skills_root = root.as_ref().map(|dir| dir.join("skills"));
    let plugins_root = root.as_ref().map(|dir| dir.join("plugins"));
    let agents_md_path = root.as_ref().map(|dir| dir.join("AGENTS.md"));

    ConfigWorkspace {
        config_root: root.as_ref().map(|dir| dir.to_string_lossy().to_string()),
        agents_root: agents_root
            .as_ref()
            .map(|dir| dir.to_string_lossy().to_string()),
        skills_root: skills_root
            .as_ref()
            .map(|dir| dir.to_string_lossy().to_string()),
        plugins_root: plugins_root
            .as_ref()
            .map(|dir| dir.to_string_lossy().to_string()),
        agents_md_path: agents_md_path
            .as_ref()
            .map(|file| file.to_string_lossy().to_string()),
        agents: agents_root
            .as_ref()
            .map(|dir| list_workspace_files(dir, &["md"], "agent"))
            .unwrap_or_default(),
        plugins: plugins_root
            .as_ref()
            .map(|dir| list_workspace_files(dir, &["ts", "js", "mjs"], "plugin"))
            .unwrap_or_default(),
    }
}

#[tauri::command]
#[specta::specta]
fn list_config_files(directory: Option<String>) -> Vec<ConfigFile> {
    let mut list = Vec::new();

    if let Some(root) = config_root() {
        push_config_file(
            &mut list,
            "global-opencode-jsonc",
            "Global opencode.jsonc",
            root.join("opencode.jsonc"),
            "global",
            "config",
        );
        push_config_file(
            &mut list,
            "global-opencode-json",
            "Global opencode.json",
            root.join("opencode.json"),
            "global",
            "config",
        );
        push_config_file(
            &mut list,
            "global-tui-jsonc",
            "Global tui.jsonc",
            root.join("tui.jsonc"),
            "global",
            "tui",
        );
        push_config_file(
            &mut list,
            "global-tui-json",
            "Global tui.json",
            root.join("tui.json"),
            "global",
            "tui",
        );
    }

    if let Some(dir) = directory {
        let root = PathBuf::from(dir);
        push_config_file(
            &mut list,
            "project-opencode-jsonc",
            "Project opencode.jsonc",
            root.join("opencode.jsonc"),
            "project",
            "config",
        );
        push_config_file(
            &mut list,
            "project-opencode-json",
            "Project opencode.json",
            root.join("opencode.json"),
            "project",
            "config",
        );
        push_config_file(
            &mut list,
            "project-tui-jsonc",
            "Project tui.jsonc",
            root.join("tui.jsonc"),
            "project",
            "tui",
        );
        push_config_file(
            &mut list,
            "project-tui-json",
            "Project tui.json",
            root.join("tui.json"),
            "project",
            "tui",
        );
        push_config_file(
            &mut list,
            "project-dir-opencode-jsonc",
            ".opencode/opencode.jsonc",
            root.join(".opencode").join("opencode.jsonc"),
            "project",
            "config_dir",
        );
        push_config_file(
            &mut list,
            "project-dir-opencode-json",
            ".opencode/opencode.json",
            root.join(".opencode").join("opencode.json"),
            "project",
            "config_dir",
        );
    }

    list
}

fn trellis_text(value: &serde_json::Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(|item| item.as_str())
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .map(String::from)
}

fn trellis_children(value: &serde_json::Value) -> Vec<String> {
    value
        .get("children")
        .and_then(|item| item.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.as_str())
                .map(str::trim)
                .filter(|item| !item.is_empty())
                .map(String::from)
                .collect()
        })
        .unwrap_or_default()
}

fn normalize_current_task(root: &PathBuf, raw: &str) -> Option<String> {
    let text = raw.trim();
    if text.is_empty() {
        return None;
    }

    let path = PathBuf::from(text);
    let task = if path.is_absolute() {
        path.file_name().and_then(|name| name.to_str())
    } else {
        path.file_name().and_then(|name| name.to_str()).or(Some(text))
    };

    task.filter(|item| root.join(".trellis").join("tasks").join(item).is_dir())
        .map(String::from)
}

#[tauri::command]
#[specta::specta]
fn list_trellis_tasks(directory: String) -> Result<TrellisTaskList, String> {
    let root = PathBuf::from(directory);
    let root_text = root.to_string_lossy().to_string();
    let worktree_name = root
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("workspace")
        .to_string();
    let trellis = root.join(".trellis");
    let tasks = trellis.join("tasks");
    let current = fs::read_to_string(trellis.join(".current-task"))
        .ok()
        .and_then(|raw| normalize_current_task(&root, &raw));

    let Ok(entries) = fs::read_dir(&tasks) else {
        return Ok(TrellisTaskList {
            root: root_text,
            current,
            skipped: 0,
            tasks: Vec::new(),
        });
    };

    let mut list = Vec::new();
    let mut skipped: u32 = 0;
    for entry in entries.filter_map(|entry| entry.ok()) {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }

        let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
            continue;
        };
        if name == "archive" || name.starts_with('.') {
            continue;
        }

        let file = path.join("task.json");
        let text = match fs::read_to_string(&file) {
            Ok(text) => text,
            Err(err) => {
                eprintln!("[trellis] skipping task {}: failed to read task.json: {err}", path.to_string_lossy());
                skipped += 1;
                continue;
            }
        };
        let data = match serde_json::from_str::<serde_json::Value>(&text) {
            Ok(data) => data,
            Err(err) => {
                eprintln!("[trellis] skipping task {}: failed to parse task.json: {err}", path.to_string_lossy());
                skipped += 1;
                continue;
            }
        };

        let id = trellis_text(&data, "id").unwrap_or_else(|| name.to_string());
        let task_name = trellis_text(&data, "name").unwrap_or_else(|| id.clone());
        let title = trellis_text(&data, "title").unwrap_or_else(|| task_name.clone());
        let status = trellis_text(&data, "status").unwrap_or_else(|| "unknown".to_string());
        let active = current.as_ref().is_some_and(|item| item == name || item == &id);

        list.push(TrellisTask {
            id,
            name: task_name,
            title,
            status,
            priority: trellis_text(&data, "priority"),
            assignee: trellis_text(&data, "assignee"),
            package: trellis_text(&data, "package"),
            parent: trellis_text(&data, "parent"),
            children: trellis_children(&data),
            created_at: trellis_text(&data, "createdAt"),
            completed_at: trellis_text(&data, "completedAt"),
            path: path.to_string_lossy().to_string(),
            worktree_root: root_text.clone(),
            worktree_name: worktree_name.clone(),
            current: active,
        });
    }

    list.sort_by(|a, b| {
        b.current
            .cmp(&a.current)
            .then_with(|| a.status.cmp(&b.status))
            .then_with(|| a.priority.cmp(&b.priority))
            .then_with(|| a.name.cmp(&b.name))
    });

    Ok(TrellisTaskList {
        root: root_text,
        current,
        skipped,
        tasks: list,
    })
}

#[tauri::command]
#[specta::specta]
fn read_config_file(path: String) -> Result<Option<String>, String> {
    match fs::read_to_string(&path) {
        Ok(text) => Ok(Some(text)),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(err) => Err(format!("Failed to read file: {err}")),
    }
}

#[tauri::command]
#[specta::specta]
fn write_config_file(path: String, content: String) -> Result<(), String> {
    let Some(parent) = PathBuf::from(&path).parent().map(PathBuf::from) else {
        return Err("Failed to resolve parent directory".to_string());
    };

    fs::create_dir_all(&parent)
        .map_err(|err| format!("Failed to create parent directory: {err}"))?;
    fs::write(path, content).map_err(|err| format!("Failed to write file: {err}"))
}

#[tauri::command]
#[specta::specta]
fn create_config_file(path: String, content: String) -> Result<(), String> {
    let file = PathBuf::from(&path);
    let Some(parent) = file.parent().map(PathBuf::from) else {
        return Err("Failed to resolve parent directory".to_string());
    };

    if file.exists() {
        return Err("File already exists".to_string());
    }

    fs::create_dir_all(&parent)
        .map_err(|err| format!("Failed to create parent directory: {err}"))?;
    fs::write(file, content).map_err(|err| format!("Failed to write file: {err}"))
}

fn resolve_path_from_args(args: &[String], cwd: &str) -> Option<String> {
    let path_arg = args.get(1)?;
    if path_arg.starts_with('-') {
        return None;
    }

    let path = PathBuf::from(path_arg);
    let absolute = if path.is_absolute() {
        path
    } else {
        PathBuf::from(cwd).join(path)
    };

    if absolute.is_dir() {
        absolute.canonicalize().ok()?.to_str().map(String::from)
    } else {
        None
    }
}

fn bridge_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .resolve(BRIDGE_FILE, BaseDirectory::AppLocalData)
        .map_err(|e| format!("Failed to resolve bridge path: {e}"))
}

fn publish_bridge(app: &AppHandle, server: &ServerReadyData) -> Result<(), String> {
    let file = bridge_path(app)?;
    let dir = file
        .parent()
        .ok_or_else(|| "Failed to resolve bridge parent directory".to_string())?;

    fs::create_dir_all(dir).map_err(|e| format!("Failed to create bridge directory: {e}"))?;

    let body = serde_json::to_vec_pretty(&json!({
        "version": 1,
        "app": {
            "name": app.package_info().name,
            "version": app.package_info().version.to_string(),
            "pid": std::process::id(),
        },
        "server": {
            "url": server.url,
            "username": server.username,
            "password": server.password,
        },
        "time": chrono::Utc::now().timestamp_millis(),
    }))
    .map_err(|e| format!("Failed to serialize bridge file: {e}"))?;

    let tmp = file.with_extension("json.tmp");
    fs::write(&tmp, body).map_err(|e| format!("Failed to write bridge file: {e}"))?;
    fs::rename(&tmp, &file).map_err(|e| format!("Failed to publish bridge file: {e}"))?;
    tracing::info!(path = %file.display(), "Published bridge file");
    Ok(())
}

fn clear_bridge(app: &AppHandle) {
    let Ok(file) = bridge_path(app) else {
        return;
    };

    match fs::remove_file(&file) {
        Ok(()) => tracing::info!(path = %file.display(), "Cleared bridge file"),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {}
        Err(err) => tracing::warn!(path = %file.display(), "Failed to clear bridge file: {err}"),
    }
}

fn kill_openclaw(app: &AppHandle) {
    let Some(state) = app.try_state::<OpenclawState>() else {
        tracing::info!("OpenClaw adapter not running");
        return;
    };

    if let Ok(mut child) = state.child.lock()
        && let Some(child) = child.take()
    {
        let _ = child.kill();
        tracing::info!("Killed OpenClaw adapter");
    }

    if let Ok(mut data) = state.data.lock() {
        *data = None;
    }

    if let Ok(mut cfg) = state.config.lock() {
        *cfg = None;
    }
}

fn kill_openclaw_test(app: &AppHandle) -> bool {
    let Some(state) = app.try_state::<OpenclawState>() else {
        tracing::info!("OpenClaw test adapter not running");
        return false;
    };

    if let Ok(mut child) = state.test.lock()
        && let Some(child) = child.take()
    {
        let _ = child.kill();
        tracing::info!("Killed OpenClaw test adapter");
        return true;
    }

    false
}

fn kill_genericagent(app: &AppHandle) {
    let Some(state) = app.try_state::<GenericagentState>() else {
        tracing::info!("GenericAgent adapter not running");
        return;
    };

    if let Ok(mut child) = state.child.lock()
        && let Some(child) = child.take()
    {
        let _ = child.kill();
        tracing::info!("Killed GenericAgent adapter");
    }

    if let Ok(mut data) = state.data.lock() {
        *data = None;
    }

    if let Ok(mut cfg) = state.config.lock() {
        *cfg = None;
    }
}

fn kill_genericagent_test(app: &AppHandle) -> bool {
    let Some(state) = app.try_state::<GenericagentState>() else {
        tracing::info!("GenericAgent test adapter not running");
        return false;
    };

    if let Ok(mut child) = state.test.lock()
        && let Some(child) = child.take()
    {
        let _ = child.kill();
        tracing::info!("Killed GenericAgent test adapter");
        return true;
    }

    false
}

fn kill_hermes(app: &AppHandle) {
    let Some(state) = app.try_state::<HermesState>() else {
        tracing::info!("Hermes adapter not running");
        return;
    };

    if let Ok(mut child) = state.child.lock()
        && let Some(child) = child.take()
    {
        let _ = child.kill();
        tracing::info!("Killed Hermes adapter");
    }

    if let Ok(mut data) = state.data.lock() {
        *data = None;
    }

    if let Ok(mut cfg) = state.config.lock() {
        *cfg = None;
    }
}

fn kill_hermes_test(app: &AppHandle) -> bool {
    let Some(state) = app.try_state::<HermesState>() else {
        tracing::info!("Hermes test adapter not running");
        return false;
    };

    if let Ok(mut child) = state.test.lock()
        && let Some(child) = child.take()
    {
        let _ = child.kill();
        tracing::info!("Killed Hermes test adapter");
        return true;
    }

    false
}

#[tauri::command]
#[specta::specta]
fn kill_sidecar(app: AppHandle) {
    kill_openclaw(&app);
    kill_hermes(&app);
    kill_genericagent(&app);

    let Some(server_state) = app.try_state::<ServerState>() else {
        tracing::info!("Server not running");
        return;
    };

    let Ok(mut child) = server_state.child.lock() else {
        tracing::warn!("Failed to acquire server state lock");
        return;
    };

    let Some(server_state) = child.take() else {
        tracing::info!("Server state missing");
        return;
    };

    let _ = server_state.kill();
    clear_bridge(&app);

    tracing::info!("Killed server");
}

#[tauri::command]
#[specta::specta]
async fn sync_openclaw_server(app: AppHandle) -> Result<Option<ServerReadyData>, String> {
    let cfg = server::get_openclaw_config(app.clone())?;
    let Some(state) = app.try_state::<OpenclawState>() else {
        return Ok(None);
    };

    if !cfg.enabled || cfg.url.as_deref().is_none_or(|x| x.trim().is_empty()) {
        tracing::info!(
            enabled = cfg.enabled,
            has_url = cfg.url.is_some(),
            "stopping OpenClaw adapter"
        );
        kill_openclaw(&app);
        return Ok(None);
    }

    let current_cfg = state
        .config
        .lock()
        .map_err(|_| "Failed to acquire openclaw config state".to_string())?
        .clone();
    let current = state
        .data
        .lock()
        .map_err(|_| "Failed to acquire openclaw state".to_string())?
        .clone();
    let running = state
        .child
        .lock()
        .map_err(|_| "Failed to acquire openclaw child state".to_string())?
        .is_some();

    if current_cfg.as_ref() == Some(&cfg) && running {
        tracing::info!(url = ?current.as_ref().map(|x| x.url.clone()), "reusing OpenClaw adapter");
        return Ok(current);
    }

    tracing::info!(
        enabled = cfg.enabled,
        has_url = cfg.url.is_some(),
        has_token = cfg.token.is_some(),
        "syncing OpenClaw adapter"
    );
    kill_openclaw(&app);

    let url = cfg
        .url
        .clone()
        .filter(|x| !x.trim().is_empty())
        .ok_or_else(|| "OpenClaw gateway URL is required".to_string())?;
    let port = get_openclaw_port();
    let hostname = "127.0.0.1".to_string();
    let password = uuid::Uuid::new_v4().to_string();
    let http = format!("http://{hostname}:{port}");

    let (child, health_check) =
        crate::cli::serve_openclaw(&app, &hostname, port, &password, &url, cfg.token.as_deref());

    let data = ServerReadyData {
        url: http,
        username: Some("opencode".to_string()),
        password: Some(password),
    };

    {
        let mut handle = state
            .child
            .lock()
            .map_err(|_| "Failed to acquire openclaw child state".to_string())?;
        *handle = Some(child);
    }

    {
        let mut current = state
            .data
            .lock()
            .map_err(|_| "Failed to acquire openclaw state".to_string())?;
        *current = Some(data.clone());
    }

    {
        let mut current = state
            .config
            .lock()
            .map_err(|_| "Failed to acquire openclaw config state".to_string())?;
        *current = Some(cfg);
    }

    let handle = app.clone();
    let url = data.url.clone();
    tauri::async_runtime::spawn(async move {
        match health_check.await {
            Ok(payload) => {
                tracing::warn!(payload = ?payload, url, "OpenClaw adapter exited");
            }
            Err(err) => {
                tracing::warn!(error = %err, url, "OpenClaw adapter exit watch failed");
            }
        }

        let Some(state) = handle.try_state::<OpenclawState>() else {
            return;
        };
        let same = state
            .data
            .lock()
            .ok()
            .and_then(|current| current.clone())
            .is_some_and(|current| current.url == url);
        if !same {
            return;
        }

        if let Ok(mut child) = state.child.lock() {
            *child = None;
        }
        if let Ok(mut data) = state.data.lock() {
            *data = None;
        }
        if let Ok(mut cfg) = state.config.lock() {
            *cfg = None;
        }
    });

    Ok(Some(data))
}

#[tauri::command]
#[specta::specta]
async fn reload_sidecar(app: AppHandle) -> Result<(), String> {
    let handle = app.clone();
    let Some(server_state) = handle.try_state::<ServerState>() else {
        return Err("Server not running".to_string());
    };

    let hostname = server_state.hostname.clone();
    let port = server_state.port;
    let password = server_state
        .password
        .lock()
        .map_err(|_| "Failed to acquire server password".to_string())?
        .clone();

    if let Some(child) = server_state
        .child
        .lock()
        .map_err(|_| "Failed to acquire server state".to_string())?
        .take()
    {
        let _ = child.kill();
    }

    let data = ServerReadyData {
        url: format!("http://{hostname}:{port}"),
        username: Some("opencode".to_string()),
        password: Some(password.clone()),
    };

    let (child, health_check) = server::spawn_local_server(app.clone(), hostname, port, password)?;
    publish_bridge(&app, &data)?;

    {
        let mut state = server_state
            .child
            .lock()
            .map_err(|_| "Failed to acquire server state".to_string())?;
        *state = Some(child);
    }

    wait_health(health_check).await
}

#[tauri::command]
#[specta::specta]
async fn get_openclaw_server(app: AppHandle) -> Result<Option<ServerReadyData>, String> {
    sync_openclaw_server(app).await
}

#[tauri::command]
#[specta::specta]
async fn test_openclaw_server(
    app: AppHandle,
    config: server::OpenclawConfig,
) -> Result<OpenclawTestResult, String> {
    let _ = kill_openclaw_test(&app);
    let mut logs = vec!["Starting OpenClaw connection test".to_string()];
    if !config.enabled {
        return Ok(OpenclawTestResult {
            ok: false,
            logs: vec![
                "Starting OpenClaw connection test".to_string(),
                "Config check failed: OpenClaw is disabled".to_string(),
            ],
        });
    }

    let Some(url) = config.url.clone().filter(|x| !x.trim().is_empty()) else {
        return Ok(OpenclawTestResult {
            ok: false,
            logs: vec![
                "Starting OpenClaw connection test".to_string(),
                "Config check failed: Gateway URL is required".to_string(),
            ],
        });
    };
    logs.push(format!("Gateway URL detected: {url}"));
    logs.push(format!(
        "Gateway token present: {}",
        config.token.as_ref().is_some_and(|x| !x.trim().is_empty())
    ));
    let port = get_openclaw_port();
    let hostname = "127.0.0.1".to_string();
    let password = uuid::Uuid::new_v4().to_string();
    let http = format!("http://{hostname}:{port}");
    logs.push(format!("Allocating temporary adapter on {http}"));
    let (child, health_check) = crate::cli::serve_openclaw(
        &app,
        &hostname,
        port,
        &password,
        &url,
        config.token.as_deref(),
    );
    logs.push("Temporary adapter spawned".to_string());

    if let Some(state) = app.try_state::<OpenclawState>()
        && let Ok(mut test) = state.test.lock()
    {
        *test = Some(child.clone());
    }

    let ready = async {
        let started = Instant::now();
        loop {
            sleep(Duration::from_millis(100)).await;
            if server::check_health(&http, Some(&password)).await {
                tracing::info!(elapsed = ?started.elapsed(), url = %http, "OpenClaw test adapter ready");
                return Ok(started.elapsed());
            }
        }
    };

    let terminated = async {
        match health_check.await {
            Ok(payload) => Err(format!(
                "OpenClaw adapter terminated before becoming healthy (code={:?} signal={:?})",
                payload.code, payload.signal
            )),
            Err(err) => Err(format!("OpenClaw adapter exit watch failed: {err}")),
        }
    };

    let result = timeout(Duration::from_secs(15), async {
        tokio::select! {
            res = ready => res,
            res = terminated => res,
        }
    })
    .await;

    let _ = child.kill();
    let _ = kill_openclaw_test(&app);
    logs.push("Temporary adapter stopped".to_string());

    match result {
        Ok(Ok(elapsed)) => {
            logs.push(format!("Health check passed in {} ms", elapsed.as_millis()));
            Ok(OpenclawTestResult { ok: true, logs })
        }
        Ok(Err(err)) => {
            logs.push(format!("Health check failed: {err}"));
            Ok(OpenclawTestResult { ok: false, logs })
        }
        Err(_) => {
            logs.push("Health check timed out after 15000 ms".to_string());
            Ok(OpenclawTestResult { ok: false, logs })
        }
    }
}

#[tauri::command]
#[specta::specta]
fn abort_openclaw_test(app: AppHandle) -> bool {
    kill_openclaw_test(&app)
}

#[tauri::command]
#[specta::specta]
async fn sync_genericagent_server(app: AppHandle) -> Result<Option<ServerReadyData>, String> {
    let cfg = server::get_genericagent_config(app.clone())?;
    let Some(state) = app.try_state::<GenericagentState>() else {
        return Ok(None);
    };

    let dir_present = cfg
        .generic_agent_dir
        .as_deref()
        .is_some_and(|x| !x.trim().is_empty());

    if !cfg.enabled || !dir_present {
        tracing::info!(
            enabled = cfg.enabled,
            has_dir = dir_present,
            "stopping GenericAgent adapter"
        );
        kill_genericagent(&app);
        return Ok(None);
    }

    let current_cfg = state
        .config
        .lock()
        .map_err(|_| "Failed to acquire genericagent config state".to_string())?
        .clone();
    let current = state
        .data
        .lock()
        .map_err(|_| "Failed to acquire genericagent state".to_string())?
        .clone();
    let running = state
        .child
        .lock()
        .map_err(|_| "Failed to acquire genericagent child state".to_string())?
        .is_some();

    if current_cfg.as_ref() == Some(&cfg) && running {
        tracing::info!(
            url = ?current.as_ref().map(|x| x.url.clone()),
            "reusing GenericAgent adapter"
        );
        return Ok(current);
    }

    tracing::info!(cfg = ?cfg, "syncing GenericAgent adapter");
    kill_genericagent(&app);

    let generic_agent_dir = cfg
        .generic_agent_dir
        .clone()
        .filter(|x| !x.trim().is_empty())
        .ok_or_else(|| "GenericAgent directory is required".to_string())?;
    let python = cfg
        .python_executable
        .clone()
        .filter(|x| !x.trim().is_empty());
    let port = get_genericagent_port();
    let hostname = "127.0.0.1".to_string();
    let password = uuid::Uuid::new_v4().to_string();
    let http = format!("http://{hostname}:{port}");

    let (child, health_check) = crate::cli::serve_genericagent(
        &app,
        &hostname,
        port,
        &password,
        python.as_deref(),
        &generic_agent_dir,
    );

    let data = ServerReadyData {
        url: http,
        username: Some("opencode".to_string()),
        password: Some(password),
    };

    {
        let mut handle = state
            .child
            .lock()
            .map_err(|_| "Failed to acquire genericagent child state".to_string())?;
        *handle = Some(child);
    }

    {
        let mut current = state
            .data
            .lock()
            .map_err(|_| "Failed to acquire genericagent state".to_string())?;
        *current = Some(data.clone());
    }

    {
        let mut current = state
            .config
            .lock()
            .map_err(|_| "Failed to acquire genericagent config state".to_string())?;
        *current = Some(cfg);
    }

    let handle = app.clone();
    let url = data.url.clone();
    tauri::async_runtime::spawn(async move {
        match health_check.await {
            Ok(payload) => {
                tracing::warn!(payload = ?payload, url, "GenericAgent adapter exited");
            }
            Err(err) => {
                tracing::warn!(error = %err, url, "GenericAgent adapter exit watch failed");
            }
        }

        let Some(state) = handle.try_state::<GenericagentState>() else {
            return;
        };
        let same = state
            .data
            .lock()
            .ok()
            .and_then(|current| current.clone())
            .is_some_and(|current| current.url == url);
        if !same {
            return;
        }

        if let Ok(mut child) = state.child.lock() {
            *child = None;
        }
        if let Ok(mut data) = state.data.lock() {
            *data = None;
        }
        if let Ok(mut cfg) = state.config.lock() {
            *cfg = None;
        }
    });

    Ok(Some(data))
}

#[tauri::command]
#[specta::specta]
async fn get_genericagent_server(app: AppHandle) -> Result<Option<ServerReadyData>, String> {
    sync_genericagent_server(app).await
}

#[tauri::command]
#[specta::specta]
async fn test_genericagent_server(
    app: AppHandle,
    config: server::GenericagentConfig,
) -> Result<GenericagentTestResult, String> {
    let _ = kill_genericagent_test(&app);
    let mut logs = vec!["Starting GenericAgent connection test".to_string()];
    if !config.enabled {
        return Ok(GenericagentTestResult {
            ok: false,
            logs: vec![
                "Starting GenericAgent connection test".to_string(),
                "Config check failed: GenericAgent is disabled".to_string(),
            ],
        });
    }

    let Some(dir) = config
        .generic_agent_dir
        .clone()
        .filter(|x| !x.trim().is_empty())
    else {
        return Ok(GenericagentTestResult {
            ok: false,
            logs: vec![
                "Starting GenericAgent connection test".to_string(),
                "Config check failed: GenericAgent directory is required".to_string(),
            ],
        });
    };
    logs.push(format!("GenericAgent directory: {dir}"));
    let python = config
        .python_executable
        .clone()
        .filter(|x| !x.trim().is_empty());
    logs.push(format!(
        "Python executable: {}",
        python
            .clone()
            .unwrap_or_else(|| "python3 (default)".to_string())
    ));
    let port = get_genericagent_port();
    let hostname = "127.0.0.1".to_string();
    let password = uuid::Uuid::new_v4().to_string();
    let http = format!("http://{hostname}:{port}");
    logs.push(format!("Allocating temporary adapter on {http}"));
    let (child, health_check) =
        crate::cli::serve_genericagent(&app, &hostname, port, &password, python.as_deref(), &dir);
    logs.push("Temporary adapter spawned".to_string());

    if let Some(state) = app.try_state::<GenericagentState>()
        && let Ok(mut test) = state.test.lock()
    {
        *test = Some(child.clone());
    }

    let ready = async {
        let started = Instant::now();
        loop {
            sleep(Duration::from_millis(100)).await;
            if server::check_health(&http, Some(&password)).await {
                tracing::info!(
                    elapsed = ?started.elapsed(),
                    url = %http,
                    "GenericAgent test adapter ready"
                );
                return Ok(started.elapsed());
            }
        }
    };

    let terminated = async {
        match health_check.await {
            Ok(payload) => Err(format!(
                "GenericAgent adapter terminated before becoming healthy (code={:?} signal={:?})",
                payload.code, payload.signal
            )),
            Err(err) => Err(format!("GenericAgent adapter exit watch failed: {err}")),
        }
    };

    let result = timeout(Duration::from_secs(20), async {
        tokio::select! {
            res = ready => res,
            res = terminated => res,
        }
    })
    .await;

    let _ = child.kill();
    let _ = kill_genericagent_test(&app);
    logs.push("Temporary adapter stopped".to_string());

    match result {
        Ok(Ok(elapsed)) => {
            logs.push(format!("Health check passed in {} ms", elapsed.as_millis()));
            Ok(GenericagentTestResult { ok: true, logs })
        }
        Ok(Err(err)) => {
            logs.push(format!("Health check failed: {err}"));
            Ok(GenericagentTestResult { ok: false, logs })
        }
        Err(_) => {
            logs.push("Health check timed out after 20000 ms".to_string());
            Ok(GenericagentTestResult { ok: false, logs })
        }
    }
}

#[tauri::command]
#[specta::specta]
fn abort_genericagent_test(app: AppHandle) -> bool {
    kill_genericagent_test(&app)
}

#[tauri::command]
#[specta::specta]
async fn sync_hermes_server(app: AppHandle) -> Result<Option<ServerReadyData>, String> {
    let cfg = server::get_hermes_config(app.clone())?;
    let Some(state) = app.try_state::<HermesState>() else {
        return Ok(None);
    };

    let dir_present = cfg
        .hermes_dir
        .as_deref()
        .is_some_and(|x| !x.trim().is_empty());

    if !cfg.enabled || !dir_present {
        tracing::info!(
            enabled = cfg.enabled,
            has_dir = dir_present,
            "stopping Hermes adapter"
        );
        kill_hermes(&app);
        return Ok(None);
    }

    let current_cfg = state
        .config
        .lock()
        .map_err(|_| "Failed to acquire hermes config state".to_string())?
        .clone();
    let current = state
        .data
        .lock()
        .map_err(|_| "Failed to acquire hermes state".to_string())?
        .clone();
    let running = state
        .child
        .lock()
        .map_err(|_| "Failed to acquire hermes child state".to_string())?
        .is_some();

    if current_cfg.as_ref() == Some(&cfg) && running {
        tracing::info!(
            url = ?current.as_ref().map(|x| x.url.clone()),
            "reusing Hermes adapter"
        );
        return Ok(current);
    }

    tracing::info!(cfg = ?cfg, "syncing Hermes adapter");
    kill_hermes(&app);

    let hermes_dir = cfg
        .hermes_dir
        .clone()
        .filter(|x| !x.trim().is_empty())
        .ok_or_else(|| "Hermes directory is required".to_string())?;
    let python = cfg
        .python_executable
        .clone()
        .filter(|x| !x.trim().is_empty());
    let home = cfg.hermes_home.clone().filter(|x| !x.trim().is_empty());
    let port = get_hermes_port();
    let hostname = "127.0.0.1".to_string();
    let password = uuid::Uuid::new_v4().to_string();
    let http = format!("http://{hostname}:{port}");

    let (child, health_check) = crate::cli::serve_hermes(
        &app,
        &hostname,
        port,
        &password,
        python.as_deref(),
        &hermes_dir,
        home.as_deref(),
    );

    let data = ServerReadyData {
        url: http,
        username: Some("opencode".to_string()),
        password: Some(password),
    };

    {
        let mut handle = state
            .child
            .lock()
            .map_err(|_| "Failed to acquire hermes child state".to_string())?;
        *handle = Some(child);
    }

    {
        let mut current = state
            .data
            .lock()
            .map_err(|_| "Failed to acquire hermes state".to_string())?;
        *current = Some(data.clone());
    }

    {
        let mut current = state
            .config
            .lock()
            .map_err(|_| "Failed to acquire hermes config state".to_string())?;
        *current = Some(cfg);
    }

    let handle = app.clone();
    let url = data.url.clone();
    tauri::async_runtime::spawn(async move {
        match health_check.await {
            Ok(payload) => {
                tracing::warn!(payload = ?payload, url, "Hermes adapter exited");
            }
            Err(err) => {
                tracing::warn!(error = %err, url, "Hermes adapter exit watch failed");
            }
        }

        let Some(state) = handle.try_state::<HermesState>() else {
            return;
        };
        let same = state
            .data
            .lock()
            .ok()
            .and_then(|current| current.clone())
            .is_some_and(|current| current.url == url);
        if !same {
            return;
        }

        if let Ok(mut child) = state.child.lock() {
            *child = None;
        }
        if let Ok(mut data) = state.data.lock() {
            *data = None;
        }
        if let Ok(mut cfg) = state.config.lock() {
            *cfg = None;
        }
    });

    Ok(Some(data))
}

#[tauri::command]
#[specta::specta]
async fn get_hermes_server(app: AppHandle) -> Result<Option<ServerReadyData>, String> {
    sync_hermes_server(app).await
}

#[tauri::command]
#[specta::specta]
async fn test_hermes_server(
    app: AppHandle,
    config: server::HermesConfig,
) -> Result<HermesTestResult, String> {
    let _ = kill_hermes_test(&app);
    let mut logs = vec!["Starting Hermes connection test".to_string()];
    if !config.enabled {
        return Ok(HermesTestResult {
            ok: false,
            logs: vec![
                "Starting Hermes connection test".to_string(),
                "Config check failed: Hermes is disabled".to_string(),
            ],
        });
    }

    let Some(dir) = config.hermes_dir.clone().filter(|x| !x.trim().is_empty()) else {
        return Ok(HermesTestResult {
            ok: false,
            logs: vec![
                "Starting Hermes connection test".to_string(),
                "Config check failed: Hermes directory is required".to_string(),
            ],
        });
    };
    logs.push(format!("Hermes directory: {dir}"));
    let python = config
        .python_executable
        .clone()
        .filter(|x| !x.trim().is_empty());
    logs.push(format!(
        "Python executable: {}",
        python
            .clone()
            .unwrap_or_else(|| "repo venv or python3".to_string())
    ));
    let home = config.hermes_home.clone().filter(|x| !x.trim().is_empty());
    logs.push(format!(
        "Hermes home: {}",
        home.clone()
            .unwrap_or_else(|| "~/.hermes (default)".to_string())
    ));
    let port = get_hermes_port();
    let hostname = "127.0.0.1".to_string();
    let password = uuid::Uuid::new_v4().to_string();
    let http = format!("http://{hostname}:{port}");
    logs.push(format!("Allocating temporary adapter on {http}"));
    let (child, health_check) = crate::cli::serve_hermes(
        &app,
        &hostname,
        port,
        &password,
        python.as_deref(),
        &dir,
        home.as_deref(),
    );
    logs.push("Temporary adapter spawned".to_string());

    if let Some(state) = app.try_state::<HermesState>()
        && let Ok(mut test) = state.test.lock()
    {
        *test = Some(child.clone());
    }

    let ready = async {
        let started = Instant::now();
        loop {
            sleep(Duration::from_millis(100)).await;
            if server::check_health(&http, Some(&password)).await {
                tracing::info!(elapsed = ?started.elapsed(), url = %http, "Hermes test adapter ready");
                return Ok(started.elapsed());
            }
        }
    };

    let terminated = async {
        match health_check.await {
            Ok(payload) => Err(format!(
                "Hermes adapter terminated before becoming healthy (code={:?} signal={:?})",
                payload.code, payload.signal
            )),
            Err(err) => Err(format!("Hermes adapter exit watch failed: {err}")),
        }
    };

    let result = timeout(Duration::from_secs(20), async {
        tokio::select! {
            res = ready => res,
            res = terminated => res,
        }
    })
    .await;

    let _ = child.kill();
    let _ = kill_hermes_test(&app);
    logs.push("Temporary adapter stopped".to_string());

    match result {
        Ok(Ok(elapsed)) => {
            logs.push(format!("Health check passed in {} ms", elapsed.as_millis()));
            Ok(HermesTestResult { ok: true, logs })
        }
        Ok(Err(err)) => {
            logs.push(format!("Health check failed: {err}"));
            Ok(HermesTestResult { ok: false, logs })
        }
        Err(_) => {
            logs.push("Health check timed out after 20000 ms".to_string());
            Ok(HermesTestResult { ok: false, logs })
        }
    }
}

#[tauri::command]
#[specta::specta]
fn abort_hermes_test(app: AppHandle) -> bool {
    kill_hermes_test(&app)
}

#[tauri::command]
#[specta::specta]
async fn await_initialization(
    state: State<'_, SidecarReady>,
    init_state: State<'_, InitState>,
    events: Channel<InitStep>,
) -> Result<Option<ServerReadyData>, String> {
    let mut rx = init_state.current.clone();

    tokio::spawn(async move {
        let step = rx.borrow().clone();
        let _ = events.send(step.clone());

        while rx.changed().await.is_ok() {
            let step = rx.borrow_and_update().clone();
            let _ = events.send(step.clone());

            if matches!(step, InitStep::Done | InitStep::Failed { .. }) {
                break;
            }
        }
    });

    state
        .inner()
        .0
        .clone()
        .await
        .map_err(|_| "Failed to get sidecar data".to_string())
}

#[tauri::command]
#[specta::specta]
fn record_startup_profile(
    app: AppHandle,
    origin: String,
    phase: String,
    detail: Option<String>,
    frontend_elapsed_ms: Option<f64>,
) {
    startup_mark(&app, &origin, &phase, detail, frontend_elapsed_ms);
}

#[tauri::command]
#[specta::specta]
fn list_startup_profile(app: AppHandle) -> Result<Vec<StartupSample>, String> {
    let state = app
        .try_state::<StartupState>()
        .ok_or_else(|| "Startup profile state missing".to_string())?;

    state
        .list
        .lock()
        .map(|list| list.clone())
        .map_err(|_| "Failed to lock startup profile state".to_string())
}

#[tauri::command]
#[specta::specta]
fn filter_directories(paths: Vec<String>) -> Vec<String> {
    paths
        .into_iter()
        .filter_map(|p| {
            let expanded = expand_user_path(&p);
            if expanded.is_dir() {
                Some(expanded.to_string_lossy().to_string())
            } else {
                None
            }
        })
        .collect()
}

#[tauri::command]
#[specta::specta]
fn check_app_exists(app_name: &str) -> bool {
    #[cfg(target_os = "windows")]
    {
        os::windows::check_windows_app(app_name)
    }

    #[cfg(target_os = "macos")]
    {
        check_macos_app(app_name)
    }

    #[cfg(target_os = "linux")]
    {
        check_linux_app(app_name)
    }
}

#[tauri::command]
#[specta::specta]
fn resolve_app_path(app_name: &str) -> Option<String> {
    #[cfg(target_os = "windows")]
    {
        os::windows::resolve_windows_app_path(app_name)
    }

    #[cfg(not(target_os = "windows"))]
    {
        // On macOS/Linux, just return the app_name as-is since
        // the opener plugin handles them correctly
        Some(app_name.to_string())
    }
}

#[tauri::command]
#[specta::specta]
fn open_path(_app: AppHandle, path: String, app_name: Option<String>) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let app_name = app_name.map(|v| os::windows::resolve_windows_app_path(&v).unwrap_or(v));
        let is_powershell = app_name.as_ref().is_some_and(|v| {
            std::path::Path::new(v)
                .file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| {
                    name.eq_ignore_ascii_case("powershell")
                        || name.eq_ignore_ascii_case("powershell.exe")
                })
        });

        if is_powershell {
            return os::windows::open_in_powershell(path);
        }

        return tauri_plugin_opener::open_path(path, app_name.as_deref())
            .map_err(|e| format!("Failed to open path: {e}"));
    }

    #[cfg(not(target_os = "windows"))]
    tauri_plugin_opener::open_path(path, app_name.as_deref())
        .map_err(|e| format!("Failed to open path: {e}"))
}

#[cfg(target_os = "macos")]
fn check_macos_app(app_name: &str) -> bool {
    // Check common installation locations
    let mut app_locations = vec![
        format!("/Applications/{}.app", app_name),
        format!("/System/Applications/{}.app", app_name),
    ];

    if let Ok(home) = std::env::var("HOME") {
        app_locations.push(format!("{}/Applications/{}.app", home, app_name));
    }

    for location in app_locations {
        if std::path::Path::new(&location).exists() {
            return true;
        }
    }

    // Also check if command exists in PATH
    Command::new("which")
        .arg(app_name)
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}

#[derive(serde::Serialize, serde::Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum LinuxDisplayBackend {
    Wayland,
    Auto,
}

#[tauri::command]
#[specta::specta]
fn get_display_backend() -> Option<LinuxDisplayBackend> {
    #[cfg(target_os = "linux")]
    {
        let prefer = linux_display::read_wayland().unwrap_or(false);
        return Some(if prefer {
            LinuxDisplayBackend::Wayland
        } else {
            LinuxDisplayBackend::Auto
        });
    }

    #[cfg(not(target_os = "linux"))]
    None
}

#[tauri::command]
#[specta::specta]
fn set_display_backend(_app: AppHandle, _backend: LinuxDisplayBackend) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    {
        let prefer = matches!(_backend, LinuxDisplayBackend::Wayland);
        return linux_display::write_wayland(&_app, prefer);
    }

    #[cfg(not(target_os = "linux"))]
    Ok(())
}

#[cfg(target_os = "linux")]
fn check_linux_app(app_name: &str) -> bool {
    return true;
}

#[cfg(target_os = "macos")]
fn shell_escape(s: &str) -> String {
    format!("'{}'", s.replace("'", "'\\''"))
}

#[tauri::command]
#[specta::specta]
fn open_in_finder(path: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Failed to open in Finder: {}", e))?;
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Failed to open in Explorer: {}", e))?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Failed to open in file manager: {}", e))?;
    }
    Ok(())
}

#[tauri::command]
#[specta::specta]
fn open_in_vscode(path: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let result = std::process::Command::new("open")
            .arg("-a")
            .arg("Visual Studio Code")
            .arg(&path)
            .spawn();

        if result.is_ok() {
            return Ok(());
        }

        std::process::Command::new("code")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Failed to open in VSCode: {}", e))?;
    }
    #[cfg(not(target_os = "macos"))]
    {
        std::process::Command::new("code")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Failed to open in VSCode: {}", e))?;
    }
    Ok(())
}

#[tauri::command]
#[specta::specta]
fn open_in_editor(editor: String, path: String, custom_path: Option<String>) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        if let Some(custom) = custom_path {
            return std::process::Command::new(&custom)
                .arg(&path)
                .spawn()
                .map(|_| ())
                .map_err(|e| format!("Failed to open with custom editor '{}': {}", custom, e));
        }

        if editor == "WezTerm" {
            let script = format!(
                r#"
                tell application "System Events"
                    set weztermRunning to (name of processes) contains "wezterm-gui"
                end tell

                if not weztermRunning then
                    tell application "WezTerm" to launch
                    delay 2
                end if

                tell application "WezTerm" to activate

                do shell script "/Applications/WezTerm.app/Contents/MacOS/wezterm cli spawn --cwd {}"
                "#,
                shell_escape(&path)
            );
            return std::process::Command::new("osascript")
                .arg("-e")
                .arg(&script)
                .spawn()
                .map(|_| ())
                .map_err(|e| format!("Failed to open in WezTerm: {}", e));
        }

        let app_name = match editor.as_str() {
            "vscode" => "Visual Studio Code",
            "cursor" => "Cursor",
            "sublime" => "Sublime Text",
            "zed" => "Zed",
            _ => return Err(format!("Unknown editor: {}", editor)),
        };

        let result = std::process::Command::new("open")
            .arg("-a")
            .arg(app_name)
            .arg(&path)
            .spawn();

        if result.is_ok() {
            return Ok(());
        }

        let cli_command = match editor.as_str() {
            "vscode" => "code",
            "cursor" => "cursor",
            "sublime" => "subl",
            "zed" => "zed",
            _ => return Err(format!("Unknown editor: {}", editor)),
        };

        std::process::Command::new(cli_command)
            .arg(&path)
            .spawn()
            .map(|_| ())
            .map_err(|e| format!("Failed to open in {}: {}", editor, e))
    }
    #[cfg(not(target_os = "macos"))]
    {
        if let Some(custom) = custom_path {
            return std::process::Command::new(&custom)
                .arg(&path)
                .spawn()
                .map(|_| ())
                .map_err(|e| format!("Failed to open with custom editor '{}': {}", custom, e));
        }

        let cli_command = match editor.as_str() {
            "vscode" => "code",
            "cursor" => "cursor",
            "sublime" => "subl",
            "zed" => "zed",
            _ => return Err(format!("Unknown editor: {}", editor)),
        };

        std::process::Command::new(cli_command)
            .arg(&path)
            .spawn()
            .map(|_| ())
            .map_err(|e| format!("Failed to open in {}: {}", editor, e))
    }
}

#[tauri::command]
#[specta::specta]
fn get_custom_editor_path(app: AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_store::StoreExt;
    let store = app
        .store(SETTINGS_STORE)
        .map_err(|e| format!("Failed to open settings store: {}", e))?;
    match store.get(CUSTOM_EDITOR_PATH_KEY) {
        Some(v) => Ok(v.as_str().map(String::from)),
        None => Ok(None),
    }
}

#[tauri::command]
#[specta::specta]
async fn set_custom_editor_path(app: AppHandle, path: Option<String>) -> Result<(), String> {
    use tauri_plugin_store::StoreExt;
    let store = app
        .store(SETTINGS_STORE)
        .map_err(|e| format!("Failed to open settings store: {}", e))?;
    match path {
        Some(p) => {
            store.set(CUSTOM_EDITOR_PATH_KEY, serde_json::Value::String(p));
        }
        None => {
            store.delete(CUSTOM_EDITOR_PATH_KEY);
        }
    }
    store
        .save()
        .map_err(|e| format!("Failed to save settings: {}", e))?;
    Ok(())
}

#[tauri::command]
#[specta::specta]
fn get_default_editor(app: AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_store::StoreExt;
    let store = app
        .store(SETTINGS_STORE)
        .map_err(|e| format!("Failed to open settings store: {}", e))?;
    match store.get(DEFAULT_EDITOR_KEY) {
        Some(v) => Ok(v.as_str().map(String::from)),
        None => Ok(None),
    }
}

#[tauri::command]
#[specta::specta]
async fn set_default_editor(app: AppHandle, editor: Option<String>) -> Result<(), String> {
    use tauri_plugin_store::StoreExt;
    let store = app
        .store(SETTINGS_STORE)
        .map_err(|e| format!("Failed to open settings store: {}", e))?;
    match editor {
        Some(e) => {
            store.set(DEFAULT_EDITOR_KEY, serde_json::Value::String(e));
        }
        None => {
            store.delete(DEFAULT_EDITOR_KEY);
        }
    }
    store
        .save()
        .map_err(|e| format!("Failed to save settings: {}", e))?;
    Ok(())
}

#[tauri::command]
#[specta::specta]
fn wsl_path(path: String, mode: Option<WslPathMode>) -> Result<String, String> {
    if !cfg!(windows) {
        return Ok(path);
    }

    let flag = match mode.unwrap_or(WslPathMode::Linux) {
        WslPathMode::Windows => "-w",
        WslPathMode::Linux => "-u",
    };

    let output = if path.starts_with('~') {
        let suffix = path.strip_prefix('~').unwrap_or("");
        let escaped = suffix.replace('"', "\\\"");
        let cmd = format!("wslpath {flag} \"$HOME{escaped}\"");
        Command::new("wsl")
            .args(["-e", "sh", "-lc", &cmd])
            .output()
            .map_err(|e| format!("Failed to run wslpath: {e}"))?
    } else {
        Command::new("wsl")
            .args(["-e", "wslpath", flag, &path])
            .output()
            .map_err(|e| format!("Failed to run wslpath: {e}"))?
    };

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        if stderr.is_empty() {
            return Err("wslpath failed".to_string());
        }
        return Err(stderr);
    }

    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = make_specta_builder();

    #[cfg(debug_assertions)] // <- Only export on non-release builds
    export_types(&builder);

    #[cfg(all(target_os = "macos", not(debug_assertions)))]
    let _ = std::process::Command::new("killall")
        .arg("opencode-cli")
        .output();

    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            let path = resolve_path_from_args(&args, &cwd);
            if let Some(window) = app.get_webview_window(MainWindow::LABEL) {
                MainWindow::reveal(&window, path.as_deref());
            } else if let Some(p) = path {
                if let Some(state) = app.try_state::<InitialPathState>() {
                    *state.0.lock().unwrap() = Some(p);
                }
            }
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_os::init())
        .plugin(
            tauri_plugin_window_state::Builder::new()
                .with_state_flags(window_state_flags())
                .with_denylist(&[LoadingWindow::LABEL])
                .build(),
        )
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(crate::window_customizer::PinchZoomDisablePlugin)
        .plugin(tauri_plugin_decorum::init())
        .on_menu_event(|app, event| {
            if event.id() != "app.reload-webview" {
                return;
            }
            tracing::info!(id = ?event.id(), "menu reload webview requested");
            let _ = reload_webview(app);
        })
        .invoke_handler(builder.invoke_handler())
        .setup(move |app| {
            let handle = app.handle().clone();

            let initial_path = resolve_path_from_args(
                &std::env::args().collect::<Vec<_>>(),
                &std::env::current_dir()
                    .map(|p| p.to_string_lossy().to_string())
                    .unwrap_or_default(),
            );
            handle.manage(InitialPathState(Arc::new(Mutex::new(initial_path))));
            handle.manage(StartupState::new());

            let log_dir = app
                .path()
                .app_log_dir()
                .expect("failed to resolve app log dir");
            // Hold the guard in managed state so it lives for the app's lifetime,
            // ensuring all buffered logs are flushed on shutdown.
            handle.manage(logging::init(&log_dir));
            startup_mark(&handle, "native", "setup.ready", None, None);

            builder.mount_events(&handle);
            tauri::async_runtime::spawn(initialize(handle));

            Ok(())
        });

    if UPDATER_ENABLED {
        builder = builder.plugin(tauri_plugin_updater::Builder::new().build());
    }

    builder
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|app, event| match event {
            #[cfg(target_os = "macos")]
            RunEvent::WindowEvent { label, event, .. } => {
                if label == MainWindow::LABEL
                    && let tauri::WindowEvent::CloseRequested { api, .. } = event
                {
                    api.prevent_close();
                    if let Some(window) = app.get_webview_window(MainWindow::LABEL) {
                        let _ = window.hide();
                    }
                }
            }
            #[cfg(target_os = "macos")]
            RunEvent::Reopen {
                has_visible_windows,
                ..
            } => {
                if !has_visible_windows
                    && let Some(window) = app.get_webview_window(MainWindow::LABEL)
                {
                    MainWindow::reveal(&window, None);
                }
            }
            RunEvent::Exit => {
                tracing::info!("Received Exit");
                kill_sidecar(app.clone());
            }
            _ => {}
        });
}

fn make_specta_builder() -> tauri_specta::Builder<tauri::Wry> {
    tauri_specta::Builder::<tauri::Wry>::new()
        // Then register them (separated by a comma)
        .commands(tauri_specta::collect_commands![
            kill_sidecar,
            reload_sidecar,
            sync_openclaw_server,
            cli::install_cli,
            await_initialization,
            record_startup_profile,
            list_startup_profile,
            server::get_default_server_url,
            server::set_default_server_url,
            server::get_wsl_config,
            server::set_wsl_config,
            server::get_openclaw_config,
            server::set_openclaw_config,
            get_display_backend,
            set_display_backend,
            get_openclaw_server,
            test_openclaw_server,
            abort_openclaw_test,
            sync_hermes_server,
            server::get_hermes_config,
            server::set_hermes_config,
            get_hermes_server,
            test_hermes_server,
            abort_hermes_test,
            sync_genericagent_server,
            server::get_genericagent_config,
            server::set_genericagent_config,
            get_genericagent_server,
            test_genericagent_server,
            abort_genericagent_test,
            markdown::parse_markdown_command,
            check_app_exists,
            filter_directories,
            open_in_finder,
            open_in_vscode,
            open_in_editor,
            get_custom_editor_path,
            set_custom_editor_path,
            get_default_editor,
            set_default_editor,
            list_config_files,
            list_trellis_tasks,
            get_config_workspace,
            list_config_directory,
            read_config_file,
            write_config_file,
            create_config_file,
            wsl_path,
            resolve_app_path,
            open_path
        ])
        .events(tauri_specta::collect_events![SqliteMigrationProgress])
        .error_handling(tauri_specta::ErrorHandlingMode::Throw)
}

#[cfg(debug_assertions)]
fn export_types(builder: &tauri_specta::Builder<tauri::Wry>) {
    builder
        .export(
            specta_typescript::Typescript::default(),
            "../src/bindings.ts",
        )
        .expect("Failed to export typescript bindings");
}

#[cfg(test)]
#[test]
fn test_export_types() {
    let builder = make_specta_builder();
    export_types(&builder);
}

async fn initialize(app: AppHandle) {
    tracing::info!(pid = %std::process::id(), "[tcc-diagnostic] Initializing app");
    startup_mark(&app, "native", "initialize.start", None, None);

    let (init_tx, init_rx) = watch::channel(InitStep::ServerWaiting);
    let (ready_tx, ready_rx) = oneshot::channel::<Option<ServerReadyData>>();

    setup_app(&app, init_rx);
    spawn_cli_sync_task(app.clone());

    // Spawn sidecar immediately - credentials are known before health check
    let port = get_sidecar_port();
    let hostname = "127.0.0.1";
    let url = format!("http://{hostname}:{port}");
    let password = uuid::Uuid::new_v4().to_string();
    let data = ServerReadyData {
        url: url.clone(),
        username: Some("opencode".to_string()),
        password: Some(password.clone()),
    };

    app.manage(SidecarReady(ready_rx.shared()));
    app.manage(ServerState {
        child: Arc::new(Mutex::new(None)),
        hostname: hostname.to_string(),
        port,
        password: Arc::new(Mutex::new(password.clone())),
    });

    tracing::info!(
        hostname,
        port,
        url,
        pid = %std::process::id(),
        "[tcc-diagnostic] spawning sidecar"
    );
    tracing::info!("Spawning sidecar on {url}");
    startup_mark(&app, "native", "sidecar.spawn.start", Some(url.clone()), None);
    let mut fail = None::<String>;
    let health_check =
        match server::spawn_local_server(app.clone(), hostname.to_string(), port, password.clone())
        {
            Ok((child, health_check)) => {
                tracing::info!(url, "[tcc-diagnostic] sidecar spawn success");
                startup_mark(&app, "native", "sidecar.spawned", Some(url.clone()), None);

                if let Some(state) = app.try_state::<ServerState>()
                    && let Ok(mut handle) = state.child.lock()
                {
                    *handle = Some(child);
                }

                if let Err(err) = publish_bridge(&app, &data) {
                    tracing::warn!(error = %err, "Failed to publish bridge file");
                    startup_mark(&app, "native", "bridge.publish_failed", Some(err), None);
                } else {
                    startup_mark(&app, "native", "bridge.published", None, None);
                }

                let _ = ready_tx.send(Some(data));
                Some(health_check)
            }
            Err(err) => {
                tracing::error!(url, error = %err, "[tcc-diagnostic] sidecar spawn failed");
                startup_mark(
                    &app,
                    "native",
                    "sidecar.spawn_failed",
                    Some(err.clone()),
                    None,
                );
                let _ = ready_tx.send(None);
                fail = Some(format!("Failed to start local backend: {err}"));
                None
            }
        };

    let loading_window = LoadingWindow::create(&app).expect("Failed to create loading window");
    let initial_path = app
        .try_state::<InitialPathState>()
        .and_then(|s| s.0.lock().ok()?.take());
    MainWindow::create_hidden_with_path(&app, initial_path.as_deref())
        .expect("Failed to create main window");
    startup_mark(&app, "native", "windows.created", None, None);

    // SQLite migration handling:
    // We only do this if the sqlite db doesn't exist, and we're expecting the sidecar to create it.
    // A separate loading window is shown for long migrations.
    let needs_migration = !sqlite_file_exists();
    startup_mark(
        &app,
        "native",
        "sqlite.gate",
        Some(if needs_migration { "waiting" } else { "skipped" }.to_string()),
        None,
    );
    let sqlite_done = (needs_migration && fail.is_none()).then(|| {
        tracing::info!(
            path = %opencode_db_path().expect("failed to get db path").display(),
            "Sqlite file not found, waiting for it to be generated"
        );
        startup_mark(&app, "native", "sqlite.waiting", None, None);

        let (done_tx, done_rx) = oneshot::channel::<()>();
        let done_tx = Arc::new(Mutex::new(Some(done_tx)));

        let init_tx = init_tx.clone();
        let id = SqliteMigrationProgress::listen(&app, move |e| {
            let _ = init_tx.send(InitStep::SqliteWaiting);

            if matches!(e.payload, SqliteMigrationProgress::Done)
                && let Some(done_tx) = done_tx.lock().unwrap().take()
            {
                let _ = done_tx.send(());
            }
        });

        let app = app.clone();
        tokio::spawn(async move {
            let _ = done_rx.await;
            app.unlisten(id);
        })
    });

    if let Some(sqlite_done_rx) = sqlite_done {
        let result = if let Some(health_check) = health_check.clone() {
            tokio::select! {
                _ = sqlite_done_rx => Ok(()),
                result = wait_health(health_check) => result,
            }
        } else {
            let _ = sqlite_done_rx.await;
            Ok(())
        };

        if let Err(err) = result {
            tracing::error!("Sqlite startup gating failed: {err}");
            startup_mark(&app, "native", "sqlite.failed", Some(err.clone()), None);
            fail.get_or_insert(err);
        } else {
            startup_mark(&app, "native", "sqlite.ready", None, None);
        }
    } else {
        startup_mark(&app, "native", "sqlite.ready", Some("skipped".to_string()), None);
    }

    tracing::info!("Showing main window after sqlite gating");
    startup_mark(&app, "native", "main_window.showing", None, None);

    // The window-state plugin can restore the main window onto a stale monitor
    // during startup. The loading window consistently appears on the visible
    // screen, so use its monitor as the anchor for the first few main-window
    // presentations until the OS finishes applying window state.
    let monitor = loading_window.current_monitor().ok().flatten();

    if let Some(window) = app.get_webview_window(MainWindow::LABEL) {
        if let Some(ref monitor) = monitor {
            MainWindow::present_on(&window, monitor);
        } else {
            MainWindow::present(&window);
        }
        startup_mark(&app, "native", "main_window.shown", None, None);

        let retry = window.clone();
        let monitor = monitor.clone();
        tauri::async_runtime::spawn(async move {
            // Window-state restore can keep reapplying stale monitor placement for several
            // seconds after startup on macOS. Keep anchoring the main window back to the
            // loading window's visible monitor until those delayed restores settle, but
            // don't steal focus back from whatever app the user switched to meanwhile.
            for delay in [80_u64, 160, 320, 640, 1200, 2400, 4800, 9600] {
                sleep(Duration::from_millis(delay)).await;
                if let Some(ref monitor) = monitor {
                    MainWindow::anchor_on(&retry, monitor);
                } else {
                    MainWindow::anchor(&retry);
                }
            }
        });
    }

    sleep(Duration::from_millis(120)).await;
    let _ = loading_window.close();
    startup_mark(&app, "native", "loading_window.closed", None, None);

    if health_check.is_some() {
        startup_mark(&app, "native", "health.waiting", None, None);
    } else {
        startup_mark(&app, "native", "health.ready", Some("skipped".to_string()), None);
    }
    if let Some(health_check) = health_check {
        match wait_health(health_check).await {
            Ok(()) => {
                tracing::info!("Sidecar health check OK");
                startup_mark(&app, "native", "health.ready", None, None);
            }
            Err(err) => {
                tracing::error!("Sidecar health check failed: {err}");
                startup_mark(&app, "native", "health.failed", Some(err.clone()), None);
                fail.get_or_insert(err);
            }
        }
    }

    tracing::info!("Loading task finished");
    startup_mark(&app, "native", "loading.task_done", None, None);

    if let Some(err) = fail {
        tracing::error!("Initialization failed: {err}");
        let _ = init_tx.send(InitStep::Failed {
            detail: err.clone(),
        });
        startup_mark(&app, "native", "initialize.failed", Some(err), None);
        return;
    }

    tracing::info!("Loading done, completing initialisation");
    let _ = init_tx.send(InitStep::Done);
    startup_mark(&app, "native", "initialize.done", None, None);
}

fn setup_app(app: &tauri::AppHandle, init_rx: watch::Receiver<InitStep>) {
    #[cfg(any(target_os = "linux", all(debug_assertions, windows)))]
    app.deep_link().register_all().ok();

    app.manage(InitState { current: init_rx });
    app.manage(OpenclawState {
        child: Arc::new(Mutex::new(None)),
        data: Arc::new(Mutex::new(None)),
        config: Arc::new(Mutex::new(None)),
        test: Arc::new(Mutex::new(None)),
    });
    app.manage(HermesState {
        child: Arc::new(Mutex::new(None)),
        data: Arc::new(Mutex::new(None)),
        config: Arc::new(Mutex::new(None)),
        test: Arc::new(Mutex::new(None)),
    });
    app.manage(GenericagentState {
        child: Arc::new(Mutex::new(None)),
        data: Arc::new(Mutex::new(None)),
        config: Arc::new(Mutex::new(None)),
        test: Arc::new(Mutex::new(None)),
    });
}

fn spawn_cli_sync_task(app: AppHandle) {
    tokio::spawn(async move {
        if let Err(e) = sync_cli(app) {
            tracing::error!("Failed to sync CLI: {e}");
        }
    });
}

async fn wait_health(health: server::HealthCheck) -> Result<(), String> {
    match timeout(Duration::from_secs(30), health.0).await {
        Ok(Ok(Ok(()))) => Ok(()),
        Ok(Ok(Err(err))) => Err(err),
        Ok(Err(_)) => Err("Local backend readiness watch failed".to_string()),
        Err(_) => Err("Timed out waiting for local backend health".to_string()),
    }
}

fn get_sidecar_port() -> u32 {
    option_env!("OPENCODE_PORT")
        .map(|s| s.to_string())
        .or_else(|| std::env::var("OPENCODE_PORT").ok())
        .and_then(|port_str| port_str.parse().ok())
        .unwrap_or_else(|| {
            TcpListener::bind("127.0.0.1:0")
                .expect("Failed to bind to find free port")
                .local_addr()
                .expect("Failed to get local address")
                .port()
        }) as u32
}

fn get_openclaw_port() -> u32 {
    option_env!("OPENCODE_OPENCLAW_PORT")
        .map(|s| s.to_string())
        .or_else(|| std::env::var("OPENCODE_OPENCLAW_PORT").ok())
        .and_then(|port_str| port_str.parse().ok())
        .unwrap_or_else(|| {
            TcpListener::bind("127.0.0.1:0")
                .expect("Failed to bind to find free OpenClaw port")
                .local_addr()
                .expect("Failed to get local OpenClaw address")
                .port()
        }) as u32
}

fn get_hermes_port() -> u32 {
    option_env!("OPENCODE_HERMES_PORT")
        .map(|s| s.to_string())
        .or_else(|| std::env::var("OPENCODE_HERMES_PORT").ok())
        .and_then(|port_str| port_str.parse().ok())
        .unwrap_or_else(|| {
            TcpListener::bind("127.0.0.1:0")
                .expect("Failed to bind to find free Hermes port")
                .local_addr()
                .expect("Failed to get local Hermes address")
                .port()
        }) as u32
}

fn get_genericagent_port() -> u32 {
    option_env!("OPENCODE_GENERICAGENT_PORT")
        .map(|s| s.to_string())
        .or_else(|| std::env::var("OPENCODE_GENERICAGENT_PORT").ok())
        .and_then(|port_str| port_str.parse().ok())
        .unwrap_or_else(|| {
            TcpListener::bind("127.0.0.1:0")
                .expect("Failed to bind to find free GenericAgent port")
                .local_addr()
                .expect("Failed to get local GenericAgent address")
                .port()
        }) as u32
}

fn sqlite_file_exists() -> bool {
    let Ok(path) = opencode_db_path() else {
        return true;
    };

    path.exists()
}

fn opencode_db_path() -> Result<PathBuf, &'static str> {
    let xdg_data_home = env::var_os("XDG_DATA_HOME").filter(|v| !v.is_empty());

    let data_home = match xdg_data_home {
        Some(v) => PathBuf::from(v),
        None => {
            let home = dirs::home_dir().ok_or("cannot determine home directory")?;
            home.join(".local").join("share")
        }
    };

    Ok(data_home.join("opencode").join("opencode.db"))
}
