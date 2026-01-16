# Tauri/Rust Backend Documentation

**Last Updated:** 2026-01-15

This document covers the Rust backend architecture for the Tauri desktop application and the custom MCP plugin.

## Table of Contents

- [Overview](#overview)
- [Desktop Backend](#desktop-backend)
- [MCP Plugin Architecture](#mcp-plugin-architecture)
- [Command Patterns](#command-patterns)
- [Error Handling](#error-handling)
- [Async Patterns](#async-patterns)
- [State Management](#state-management)
- [Platform-Specific Code](#platform-specific-code)
- [Build Configuration](#build-configuration)

---

## Overview

### Technology Stack
| Component | Version | Purpose |
|-----------|---------|---------|
| Tauri | v2.5.0 | Desktop framework |
| Rust | 2024 Edition | Backend language |
| Tokio | 1.0 | Async runtime |
| Serde | - | Serialization |
| Enigo | 0.3.0 | Input simulation |
| xcap | 0.0.4 | macOS screenshots |
| Interprocess | 2.2.3 | IPC/Named pipes |

### Project Structure
```
packages/desktop/src-tauri/
├── src/
│   ├── lib.rs              # Main Tauri plugin integration
│   ├── main.rs             # Application entry point
│   ├── cli.rs              # CLI argument handling
│   ├── job_object.rs       # Windows process management
│   └── window_customizer.rs # macOS window customization
├── Cargo.toml              # Rust dependencies
├── Cargo.lock
├── tauri.conf.json         # Tauri configuration
├── capabilities/           # Permission definitions
├── icons/                  # Application icons
│   ├── dev/
│   └── prod/
└── sidecars/               # External executables

tauri-plugin-mcp/
├── src/
│   ├── lib.rs              # Plugin entry point
│   ├── error.rs            # Error types
│   ├── config.rs           # Configuration
│   ├── socket_server.rs    # Socket server
│   ├── tools/              # Tool handlers
│   │   ├── mod.rs
│   │   ├── screenshot.rs
│   │   ├── execute_js.rs
│   │   ├── dom.rs
│   │   ├── text_input.rs
│   │   ├── mouse_movement.rs
│   │   ├── local_storage.rs
│   │   └── window_management.rs
│   └── platform/           # Platform-specific code
│       ├── mod.rs
│       ├── macos.rs
│       ├── windows.rs
│       ├── unix.rs
│       └── shared.rs
├── mcp-server-ts/          # TypeScript MCP server
├── guest-js/               # JavaScript bindings
├── permissions/            # Permission definitions
├── Cargo.toml
└── package.json
```

---

## Desktop Backend

### Main Application (`lib.rs`)

The actual implementation from `packages/desktop/src-tauri/src/lib.rs`:

```rust
// State management
struct ServerState {
    child: Arc<Mutex<Option<CommandChild>>>,
    status: future::Shared<oneshot::Receiver<Result<ServerReadyData, String>>>,
}

struct LogState(Arc<Mutex<VecDeque<String>>>);  // Circular buffer, max 200 entries

// Server connection setup
async fn setup_server_connection(
    app: &AppHandle,
    custom_url: Option<String>,
) -> Result<(Option<CommandChild>, ServerReadyData), String> {
    // 1. Check for custom server URL (from desktop settings or CLI config)
    // 2. Health check with retry dialog
    // 3. Fall back to spawning local sidecar with UUID password
}

// Sidecar spawning with port discovery
fn get_sidecar_port() -> u32 {
    option_env!("OPENCODE_PORT")
        .or_else(|| std::env::var("OPENCODE_PORT").ok())
        .and_then(|port_str| port_str.parse().ok())
        .unwrap_or_else(|| {
            TcpListener::bind("127.0.0.1:0")  // OS assigns free port
                .local_addr().port()
        }) as u32
}

pub fn run() {
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| { /* focus window */ }))
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(PinchZoomDisablePlugin);  // Custom Linux gesture fix

    // MCP plugin - development only
    #[cfg(debug_assertions)]
    {
        builder = builder.plugin(
            tauri_plugin_mcp::init_with_config(
                PluginConfig::new("opencode-desktop")
                    .start_socket_server(true)
                    .socket_path("/tmp/tauri-mcp.sock".into()),
            ),
        );
    }

    builder
        .invoke_handler(tauri::generate_handler![
            kill_sidecar,
            install_cli,
            ensure_server_ready,
            get_default_server_url,
            set_default_server_url,
            write_file
        ])
        .setup(move |app| {
            app.manage(LogState::new());
            #[cfg(windows)]
            app.manage(JobObjectState::new());  // Windows process cleanup

            // Spawn server connection task
            // Spawn CLI sync task
            Ok(())
        })
        .run(|app, event| {
            if let RunEvent::Exit = event {
                kill_sidecar(app.clone());  // Cleanup on exit
            }
        });
}
```

### Registered Commands

| Command | Purpose |
|---------|---------|
| `kill_sidecar` | Kill OpenCode server process |
| `install_cli` | Install CLI binary |
| `ensure_server_ready` | Wait for server startup |
| `get_default_server_url` | Get stored server URL |
| `set_default_server_url` | Set stored server URL |
| `write_file` | Write file contents |
| `get_logs` | Access sidecar logs |

---

## MCP Plugin Architecture

### Plugin Initialization

```rust
// tauri-plugin-mcp/src/lib.rs
pub fn init() -> TauriPlugin<Conf> {
    init_with_config(PluginConfig::default())
}

pub fn init_with_config(config: PluginConfig) -> TauriPlugin<Conf> {
    Builder::new("mcp")
        .setup(|app, api| {
            let mcp = TauriMcp::new(app.clone(), config)?;
            app.manage(mcp);
            Ok(())
        })
        .build()
}
```

### Socket Server

The MCP plugin exposes tools via socket server (IPC or TCP):

```rust
// Socket server types
pub enum SocketType {
    Ipc,  // Unix domain sockets / Windows named pipes
    Tcp,  // TCP socket
}

// Socket server implementation
pub struct SocketServer<R: Runtime> {
    app: AppHandle<R>,
    config: PluginConfig,
    listener: Arc<Mutex<Option<Listener>>>,
}

impl<R: Runtime> SocketServer<R> {
    pub fn start(&self) -> Result<()> {
        match self.config.socket_type {
            SocketType::Ipc => self.start_ipc_server(),
            SocketType::Tcp => self.start_tcp_server(),
        }
    }
}
```

### Tool Routing

```rust
// tools/mod.rs
pub async fn handle_command<R: Runtime>(
    app: &AppHandle<R>,
    request: SocketRequest,
) -> SocketResponse {
    match request.command.as_str() {
        "take_screenshot" => screenshot::handle(app, request.payload).await,
        "execute_js" => execute_js::handle(app, request.payload).await,
        "get_dom" => dom::handle(app, request.payload).await,
        "manage_window" => window_management::handle(app, request.payload).await,
        "manage_local_storage" => local_storage::handle(app, request.payload).await,
        "simulate_text_input" => text_input::handle(app, request.payload).await,
        "simulate_mouse_movement" => mouse_movement::handle(app, request.payload).await,
        "get_element_position" => element_position::handle(app, request.payload).await,
        "send_text_to_element" => send_text_to_element::handle(app, request.payload).await,
        _ => SocketResponse::error(format!("Unknown command: {}", request.command)),
    }
}
```

### Extension Trait

```rust
// Extension trait for accessing plugin from AppHandle
pub trait TauriMcpExt<R: Runtime> {
    fn mcp(&self) -> &TauriMcp<R>;
}

impl<R: Runtime> TauriMcpExt<R> for AppHandle<R> {
    fn mcp(&self) -> &TauriMcp<R> {
        self.state::<TauriMcp<R>>().inner()
    }
}

// Usage
let mcp = app.mcp();
let screenshot = mcp.take_screenshot(window_label).await?;
```

---

## Command Patterns

### Basic Command Definition

```rust
#[tauri::command]
async fn my_command(
    app: tauri::AppHandle,
    param: String,
) -> Result<String, String> {
    // Implementation
    Ok("result".to_string())
}

// Register in handler
tauri::generate_handler![my_command]
```

### Command with State

```rust
#[tauri::command]
async fn get_logs(
    app: tauri::AppHandle,
    state: tauri::State<'_, LogState>,
) -> Result<Vec<String>, String> {
    let logs = state.logs.lock().unwrap();
    Ok(logs.iter().cloned().collect())
}
```

### Command with Window

```rust
#[tauri::command]
async fn focus_window(
    window: tauri::Window,
) -> Result<(), String> {
    window.set_focus().map_err(|e| e.to_string())
}
```

### Async Command Pattern

```rust
#[tauri::command]
async fn long_running_task(
    app: tauri::AppHandle,
) -> Result<String, String> {
    // Spawn blocking for CPU-intensive work
    let result = tokio::task::spawn_blocking(|| {
        // Heavy computation
        compute_something()
    }).await.map_err(|e| e.to_string())?;

    Ok(result)
}
```

---

## Error Handling

### Error Type Definition

```rust
// error.rs
use serde::{Serialize, Deserialize};

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "type", content = "message")]
pub enum Error {
    WindowNotFound(String),
    WindowOperationFailed(String),
    PluginInit(String),
    Io(String),
    Anyhow(String),
    TauriError(String),
}

// Type alias for convenience
pub type Result<T> = std::result::Result<T, Error>;
```

### Error Conversions

```rust
impl From<std::io::Error> for Error {
    fn from(err: std::io::Error) -> Self {
        Error::Io(err.to_string())
    }
}

impl From<anyhow::Error> for Error {
    fn from(err: anyhow::Error) -> Self {
        Error::Anyhow(err.to_string())
    }
}

impl From<tauri::Error> for Error {
    fn from(err: tauri::Error) -> Self {
        Error::TauriError(err.to_string())
    }
}
```

### Socket Response Pattern

```rust
#[derive(Debug, Serialize, Deserialize)]
pub struct SocketResponse {
    pub success: bool,
    pub data: Option<serde_json::Value>,
    pub error: Option<String>,
}

impl SocketResponse {
    pub fn success(data: impl Serialize) -> Self {
        Self {
            success: true,
            data: Some(serde_json::to_value(data).unwrap()),
            error: None,
        }
    }

    pub fn error(message: impl Into<String>) -> Self {
        Self {
            success: false,
            data: None,
            error: Some(message.into()),
        }
    }
}
```

---

## Async Patterns

### Tokio Integration

```rust
use tokio::runtime::Runtime;

// Create runtime for sync context
fn blocking_operation() -> Result<String> {
    let rt = Runtime::new()?;
    rt.block_on(async {
        // Async operation
        async_task().await
    })
}

// Use current runtime handle
async fn nested_async() -> Result<String> {
    let handle = tokio::runtime::Handle::current();
    handle.block_on(async {
        // Nested async
        Ok("result".to_string())
    })
}
```

### Channel Communication

```rust
use std::sync::mpsc;
use std::time::Duration;

async fn execute_with_timeout<R: Runtime>(
    app: &AppHandle<R>,
    code: String,
) -> Result<String> {
    let (tx, rx) = mpsc::channel();

    // Execute in webview
    app.emit_to("main", "execute-js", &code)?;

    // Wait for response
    app.once("js-result", move |event| {
        let _ = tx.send(event.payload().to_string());
    });

    // Timeout handling
    rx.recv_timeout(Duration::from_secs(5))
        .map_err(|_| Error::Timeout("JS execution timed out".to_string()))
}
```

### Spawn Blocking

```rust
async fn screenshot<R: Runtime>(
    app: &AppHandle<R>,
    window_label: &str,
) -> Result<String> {
    let label = window_label.to_string();
    let app_clone = app.clone();

    tokio::task::spawn_blocking(move || {
        // Platform-specific screenshot code
        #[cfg(target_os = "macos")]
        {
            macos::capture_window(&app_clone, &label)
        }
        #[cfg(target_os = "windows")]
        {
            windows::capture_window(&app_clone, &label)
        }
        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        {
            unix::capture_window(&app_clone, &label)
        }
    })
    .await
    .map_err(|e| Error::Anyhow(e.to_string()))?
}
```

---

## State Management

### Defining State

```rust
// Server process state
pub struct ServerState {
    pub url_sender: Arc<Mutex<Option<oneshot::Sender<String>>>>,
    pub server_url: Arc<Mutex<Option<String>>>,
}

// Log buffer state
pub struct LogState {
    pub logs: Arc<Mutex<VecDeque<String>>>,
}

impl LogState {
    pub fn new() -> Self {
        Self {
            logs: Arc::new(Mutex::new(VecDeque::with_capacity(200))),
        }
    }

    pub fn push(&self, log: String) {
        let mut logs = self.logs.lock().unwrap();
        if logs.len() >= 200 {
            logs.pop_front();
        }
        logs.push_back(log);
    }
}
```

### Registering State

```rust
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            // Register state
            app.manage(ServerState::new());
            app.manage(LogState::new());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

### Accessing State

```rust
// From command
#[tauri::command]
fn get_server_url(state: tauri::State<'_, ServerState>) -> Option<String> {
    state.server_url.lock().unwrap().clone()
}

// From AppHandle
fn access_state(app: &AppHandle) {
    if let Some(state) = app.try_state::<ServerState>() {
        let url = state.server_url.lock().unwrap();
        // Use url
    }
}
```

### Thread-Safe State

```rust
use std::sync::{Arc, Mutex};

pub struct SharedState {
    pub data: Arc<Mutex<HashMap<String, String>>>,
}

impl SharedState {
    pub fn get(&self, key: &str) -> Option<String> {
        self.data.lock().unwrap().get(key).cloned()
    }

    pub fn set(&self, key: String, value: String) {
        self.data.lock().unwrap().insert(key, value);
    }
}
```

---

## Platform-Specific Code

### Conditional Compilation

```rust
// Platform-specific implementations
#[cfg(target_os = "macos")]
mod macos;

#[cfg(target_os = "windows")]
mod windows;

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
mod unix;

// Platform-specific function
pub fn capture_screen() -> Result<Vec<u8>> {
    #[cfg(target_os = "macos")]
    {
        macos::capture_screen()
    }
    #[cfg(target_os = "windows")]
    {
        windows::capture_screen()
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        unix::capture_screen()
    }
}
```

### macOS Implementation

```rust
// platform/macos.rs
use xcap::Window;

pub fn capture_window(window_label: &str) -> Result<Vec<u8>> {
    let windows = Window::all()?;
    let window = windows
        .iter()
        .find(|w| w.title().contains(window_label))
        .ok_or(Error::WindowNotFound(window_label.to_string()))?;

    let image = window.capture_image()?;
    let encoded = encode_image(&image)?;
    Ok(encoded)
}
```

### Windows Implementation

```rust
// platform/windows.rs
use win_screenshot::prelude::*;

pub fn capture_window(hwnd: HWND) -> Result<Vec<u8>> {
    let buf = capture_window_ex(
        hwnd,
        Using::BitBlt,
        Area::Full,
        None,
        None,
    )?;

    let encoded = encode_image(&buf)?;
    Ok(encoded)
}
```

### Shared Utilities

```rust
// platform/shared.rs
use image::{DynamicImage, ImageOutputFormat};
use base64::{Engine, engine::general_purpose};

pub fn process_image(
    image: DynamicImage,
    max_width: u32,
    max_size_bytes: usize,
) -> Result<String> {
    // Resize if needed
    let resized = if image.width() > max_width {
        let ratio = max_width as f32 / image.width() as f32;
        let new_height = (image.height() as f32 * ratio) as u32;
        image.resize(max_width, new_height, image::imageops::FilterType::Lanczos3)
    } else {
        image
    };

    // Encode with quality adjustment
    let mut quality = 85;
    loop {
        let mut buf = Vec::new();
        resized.write_to(&mut buf, ImageOutputFormat::Jpeg(quality))?;

        if buf.len() <= max_size_bytes || quality <= 10 {
            let b64 = general_purpose::STANDARD.encode(&buf);
            return Ok(format!("data:image/jpeg;base64,{}", b64));
        }
        quality -= 10;
    }
}
```

---

## Build Configuration

### Cargo.toml

```toml
[package]
name = "openwork-desktop"
version = "0.1.0"
edition = "2024"

[dependencies]
tauri = { version = "2.5", features = ["devtools"] }
tauri-plugin-shell = "2"
tauri-plugin-dialog = "2"
tauri-plugin-store = "2"
tauri-plugin-http = "2"
tauri-plugin-clipboard-manager = "2"
tauri-plugin-mcp = { path = "../../tauri-plugin-mcp" }

tokio = { version = "1", features = ["full"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"

[target.'cfg(target_os = "macos")'.dependencies]
cocoa = "0.25"
objc = "0.2"
core-graphics = "0.23"

[target.'cfg(target_os = "windows")'.dependencies]
windows = { version = "0.52", features = ["Win32_Foundation"] }

[profile.dev.package."*"]
opt-level = 0
```

### tauri.conf.json

```json
{
  "productName": "OpenWork",
  "version": "0.1.0",
  "identifier": "ai.openwork.desktop",
  "build": {
    "beforeDevCommand": "bun run dev",
    "beforeBuildCommand": "bun run build",
    "devUrl": "http://localhost:5173",
    "frontendDist": "../dist"
  },
  "app": {
    "windows": [
      {
        "title": "OpenWork",
        "width": 1200,
        "height": 800,
        "minWidth": 800,
        "minHeight": 600
      }
    ],
    "security": {
      "csp": null
    }
  },
  "plugins": {
    "shell": {
      "open": true,
      "sidecar": true
    }
  }
}
```

### Capabilities

```json
// capabilities/default.json
{
  "identifier": "default",
  "description": "Default capabilities",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "shell:default",
    "dialog:default",
    "store:default",
    "http:default",
    "clipboard-manager:default",
    "mcp:default"
  ]
}
```

---

## Testing

### Unit Tests

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_process_image() {
        let image = DynamicImage::new_rgb8(100, 100);
        let result = process_image(image, 50, 10000);
        assert!(result.is_ok());
        assert!(result.unwrap().starts_with("data:image/jpeg;base64,"));
    }

    #[tokio::test]
    async fn test_socket_response() {
        let response = SocketResponse::success("test");
        assert!(response.success);
        assert!(response.error.is_none());
    }
}
```

### Integration Tests

```rust
// tests/integration_test.rs
use tauri::test::mock_builder;

#[test]
fn test_app_initialization() {
    let app = mock_builder().build(tauri::generate_context!());
    assert!(app.is_ok());
}
```

---

## Debugging

### Logging

```rust
use log::{info, warn, error, debug};

pub fn my_function() -> Result<()> {
    info!("Starting operation");
    debug!("Debug info: {:?}", data);

    if let Err(e) = risky_operation() {
        error!("Operation failed: {}", e);
        return Err(e);
    }

    info!("Operation completed");
    Ok(())
}
```

### DevTools

Enable DevTools in `tauri.conf.json`:
```json
{
  "app": {
    "windows": [
      {
        "devtools": true
      }
    ]
  }
}
```

Or programmatically:
```rust
#[cfg(debug_assertions)]
window.open_devtools();
```
