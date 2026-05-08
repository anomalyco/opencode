// FORK: 飞书 adapter 主进程接入(C1.3)— spawn sidecar + Tauri commands [feat: feishu-bridge] 2026-05-08
//
// 模式跟 opencode-cli sidecar 一致:
//   1. spawn child process(adapter)
//   2. 读 stdout 第一行 JSON ServerReadyData
//   3. 存入全局 Mutex,后续 Tauri commands 通过 reqwest 调 adapter HTTP
//
// v1 范围:
//   - 接口骨架完整(commands / state / spawn fn 签名)
//   - spawn 实现 dev mode 兜底:bun run packages/adapter-feishu-lark/src/main.ts
//   - release packaging(adapter 编译为单文件 binary)留 backlog
//
// 测试模式(暂):user 手动 `bun run packages/adapter-feishu-lark/src/main.ts` 启动 adapter,
// 把 ServerReadyData 一行 JSON 通过 env var 喂给 DeskFox,或主进程读源码 spawn。
// 真生产 packaging 路径 Phase 7 完成。

use std::sync::Mutex;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};

// ============================================================
// 类型 — 跟 adapter server.ts ServerReadyData 严格对齐
// ============================================================

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct AdapterReady {
    pub url: String,
    pub username: String,
    pub password: String,
}

// ============================================================
// 全局状态
// ============================================================

#[derive(Default)]
pub struct AdapterState {
    pub ready: Mutex<Option<AdapterReady>>,
}

// ============================================================
// 内部:HTTP client wrapper
// ============================================================

fn auth_header(ready: &AdapterReady) -> String {
    use base64::Engine;
    let token =
        base64::engine::general_purpose::STANDARD.encode(format!("{}:{}", ready.username, ready.password));
    format!("Basic {token}")
}

async fn post_json<TReq, TRes>(
    ready: &AdapterReady,
    path: &str,
    body: &TReq,
) -> Result<TRes, String>
where
    TReq: Serialize,
    TRes: for<'de> Deserialize<'de>,
{
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|e| format!("client build error: {e}"))?;

    let res = client
        .post(format!("{}{}", ready.url, path))
        .header("Authorization", auth_header(ready))
        .header("Content-Type", "application/json")
        .json(body)
        .send()
        .await
        .map_err(|e| format!("adapter http error: {e}"))?;

    let status = res.status();
    let text = res.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(format!("adapter HTTP {}: {}", status.as_u16(), text));
    }
    serde_json::from_str(&text).map_err(|e| format!("parse error: {e} / body: {text}"))
}

// ============================================================
// public spawn — v1 不真 spawn,留接口给 Phase 2+ 完整实现
// ============================================================

/// 在 setup() 中调用,初始化 AdapterState。
///
/// v1 暂不真 spawn child process(adapter packaging 在 Phase 7 完成)。
/// 测试期 user 可通过 env var 喂 adapter 信息:
///   FEISHU_ADAPTER_URL / FEISHU_ADAPTER_USERNAME / FEISHU_ADAPTER_PASSWORD
pub fn init(app: &AppHandle) {
    let state = AdapterState::default();

    // v1 dev 兜底:从 env var 读 adapter 凭证
    if let (Ok(url), Ok(username), Ok(password)) = (
        std::env::var("FEISHU_ADAPTER_URL"),
        std::env::var("FEISHU_ADAPTER_USERNAME"),
        std::env::var("FEISHU_ADAPTER_PASSWORD"),
    ) {
        if let Ok(mut slot) = state.ready.lock() {
            *slot = Some(AdapterReady { url, username, password });
            tracing::info!("[feishu-adapter] loaded ready data from env vars");
        }
    } else {
        tracing::debug!(
            "[feishu-adapter] no env vars set; adapter not yet spawned. \
             Phase 2+ will spawn child process automatically."
        );
    }

    app.manage(state);
}

// ============================================================
// Tauri commands — 暴露给前端
// ============================================================

#[derive(Debug, Serialize, Deserialize, specta::Type)]
pub struct OauthStartRequest {
    pub domain: String, // "feishu" | "lark"
}

#[derive(Debug, Serialize, Deserialize, specta::Type)]
pub struct OauthStartResponse {
    pub session_id: String,
    pub device_code: String,
    pub user_code: String,
    pub verification_uri: String,
    pub verification_uri_complete: String,
    pub expires_in: u64,
    pub interval: u64,
}

/// 内部 wire format(adapter server 用 camelCase,跟 OAuth flow 一致)
#[derive(Debug, Deserialize)]
struct OauthStartWire {
    #[serde(rename = "sessionId")]
    session_id: String,
    #[serde(rename = "deviceCode")]
    device_code: String,
    #[serde(rename = "userCode")]
    user_code: String,
    #[serde(rename = "verificationUri")]
    verification_uri: String,
    #[serde(rename = "verificationUriComplete")]
    verification_uri_complete: String,
    #[serde(rename = "expiresIn")]
    expires_in: u64,
    interval: u64,
}

#[derive(Debug, Serialize, Deserialize, specta::Type)]
pub struct OauthPollRequest {
    pub session_id: String,
}

/// PollResult 的 Tauri 暴露版 — string status + optional 字段
///
/// status: "success" | "pending" | "slow_down" | "denied" | "expired" | "error"
#[derive(Debug, Serialize, Deserialize, specta::Type)]
pub struct OauthPollResponse {
    pub status: String,
    pub app_id: Option<String>,
    pub app_secret: Option<String>,
    pub open_id: Option<String>,
    pub access_token: Option<String>,
    pub refresh_token: Option<String>,
    pub expires_in: Option<u64>,
    pub message: Option<String>,
    pub code: Option<String>,
    pub next_interval_ms: Option<u64>,
}

#[derive(Debug, Deserialize)]
struct OauthPollWire {
    status: String,
    #[serde(rename = "appId")]
    app_id: Option<String>,
    #[serde(rename = "appSecret")]
    app_secret: Option<String>,
    #[serde(rename = "openId")]
    open_id: Option<String>,
    #[serde(rename = "accessToken")]
    access_token: Option<String>,
    #[serde(rename = "refreshToken")]
    refresh_token: Option<String>,
    #[serde(rename = "expiresIn")]
    expires_in: Option<u64>,
    message: Option<String>,
    code: Option<String>,
    #[serde(rename = "nextIntervalMs")]
    next_interval_ms: Option<u64>,
}

fn current_ready(state: &State<'_, AdapterState>) -> Result<AdapterReady, String> {
    state
        .ready
        .lock()
        .map_err(|_| "adapter state lock poisoned".to_string())?
        .clone()
        .ok_or_else(|| {
            "adapter not ready: 飞书桥接 sidecar 还未启动(Phase 2+ 自动 spawn)。\
             dev 测试请 export FEISHU_ADAPTER_URL/USERNAME/PASSWORD 后重启 DeskFox"
                .to_string()
        })
}

#[tauri::command]
#[specta::specta]
pub async fn feishu_oauth_start(
    state: State<'_, AdapterState>,
    request: OauthStartRequest,
) -> Result<OauthStartResponse, String> {
    let ready = current_ready(&state)?;
    let wire: OauthStartWire = post_json(&ready, "/oauth/start", &request).await?;
    Ok(OauthStartResponse {
        session_id: wire.session_id,
        device_code: wire.device_code,
        user_code: wire.user_code,
        verification_uri: wire.verification_uri,
        verification_uri_complete: wire.verification_uri_complete,
        expires_in: wire.expires_in,
        interval: wire.interval,
    })
}

#[tauri::command]
#[specta::specta]
pub async fn feishu_oauth_poll(
    state: State<'_, AdapterState>,
    request: OauthPollRequest,
) -> Result<OauthPollResponse, String> {
    let ready = current_ready(&state)?;
    // adapter server 端 body field 是 sessionId(camelCase)
    #[derive(Serialize)]
    struct WireReq<'a> {
        #[serde(rename = "sessionId")]
        session_id: &'a str,
    }
    let wire: OauthPollWire = post_json(
        &ready,
        "/oauth/poll",
        &WireReq { session_id: &request.session_id },
    )
    .await?;
    Ok(OauthPollResponse {
        status: wire.status,
        app_id: wire.app_id,
        app_secret: wire.app_secret,
        open_id: wire.open_id,
        access_token: wire.access_token,
        refresh_token: wire.refresh_token,
        expires_in: wire.expires_in,
        message: wire.message,
        code: wire.code,
        next_interval_ms: wire.next_interval_ms,
    })
}

/// adapter 是否已就绪(GUI 在 OAuth 操作前 check)。
#[tauri::command]
#[specta::specta]
pub fn feishu_adapter_status(state: State<'_, AdapterState>) -> bool {
    state.ready.lock().map(|g| g.is_some()).unwrap_or(false)
}

// ============================================================
// 单测
// ============================================================

#[cfg(test)]
mod tests {
    use super::*;

    fn dummy_ready() -> AdapterReady {
        AdapterReady {
            url: "http://127.0.0.1:1234".into(),
            username: "u".into(),
            password: "p".into(),
        }
    }

    #[test]
    fn auth_header_basic_编码() {
        let h = auth_header(&dummy_ready());
        // base64("u:p") = "dTpw"
        assert_eq!(h, "Basic dTpw");
    }

    #[test]
    fn adapter_state_默认_ready_为_none() {
        let state = AdapterState::default();
        assert!(state.ready.lock().unwrap().is_none());
    }

    #[test]
    fn adapter_state_set_后_ready_填充() {
        let state = AdapterState::default();
        {
            let mut slot = state.ready.lock().unwrap();
            *slot = Some(dummy_ready());
        }
        let g = state.ready.lock().unwrap();
        assert_eq!(g.as_ref().unwrap().url, "http://127.0.0.1:1234");
    }
}
