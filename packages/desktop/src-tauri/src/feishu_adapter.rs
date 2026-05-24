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

    // plugin 模式(2026-05-09 起):plugin 启动时把 server 凭证写到
    // ~/.opencode/feishu-plugin-server.json,Tauri command 调用时 lazy 读。
    // init() 这里不预读 — 因为 plugin 启动晚于 DeskFox setup。
    // (旧 env var 兼容路径保留作 dev 测试 fallback)
    if let (Ok(url), Ok(username), Ok(password)) = (
        std::env::var("FEISHU_ADAPTER_URL"),
        std::env::var("FEISHU_ADAPTER_USERNAME"),
        std::env::var("FEISHU_ADAPTER_PASSWORD"),
    ) {
        if let Ok(mut slot) = state.ready.lock() {
            *slot = Some(AdapterReady {
                url,
                username,
                password,
            });
            tracing::info!("[feishu-adapter] loaded ready data from env vars (legacy)");
        }
    }

    app.manage(state);
}

/// Lazy 读 ~/.opencode/feishu-plugin-server.json(plugin 启动后写入)。
///
/// 每次 Tauri command 调用前 try-load — plugin 启动是异步,DeskFox setup 时 file 还没,
/// 等 user 触发 OAuth 时再读(那时 plugin 必然已 ready)。
fn load_ready_from_file() -> Option<AdapterReady> {
    let home = dirs::home_dir()?;
    let path = home.join(".opencode").join("feishu-plugin-server.json");
    let content = std::fs::read_to_string(&path).ok()?;
    serde_json::from_str(&content).ok()
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
    // 已有 ready → 直接返
    {
        let slot = state
            .ready
            .lock()
            .map_err(|_| "adapter state lock poisoned".to_string())?;
        if let Some(r) = slot.as_ref() {
            return Ok(r.clone());
        }
    }

    // Lazy load:plugin 启动后写 ~/.opencode/feishu-plugin-server.json,这里读
    if let Some(r) = load_ready_from_file() {
        if let Ok(mut slot) = state.ready.lock() {
            *slot = Some(r.clone());
        }
        tracing::info!("[feishu-adapter] loaded ready data from feishu-plugin-server.json");
        return Ok(r);
    }

    Err("adapter not ready: 飞书桥接 plugin 还未启动 — 检查 \
         ~/.config/opencode/opencode.json 是否注册了 plugin,且 opencode-cli sidecar 已启动"
        .to_string())
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
///
/// plugin 模式:state.ready 启动时 None,首次调用时 lazy-load
/// `~/.opencode/feishu-plugin-server.json`(plugin 启动后写入)。
#[tauri::command]
#[specta::specta]
pub fn feishu_adapter_status(state: State<'_, AdapterState>) -> bool {
    if let Ok(g) = state.ready.lock() {
        if g.is_some() {
            return true;
        }
    }
    if let Some(r) = load_ready_from_file() {
        if let Ok(mut slot) = state.ready.lock() {
            *slot = Some(r);
        }
        return true;
    }
    false
}

// ============================================================
// 账户管理(C1.6)— save / list / delete
// ============================================================

#[derive(Debug, Serialize, Deserialize, specta::Type)]
pub struct SaveAccountRequest {
    pub domain: String,
    pub app_id: String,
    pub app_secret: String,
    pub open_id: String,
    pub account_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, specta::Type)]
pub struct ModelRef {
    pub provider_id: String,
    pub model_id: String,
}

#[derive(Debug, Serialize, Deserialize, specta::Type)]
pub struct AccountSummary {
    pub account_id: String,
    pub app_id: String,
    pub open_id: String,
    pub domain: String,
    pub agent: String,
    pub enabled: Option<bool>,
    pub model: Option<ModelRef>,
    pub bot_name: Option<String>,
}

/// adapter wire request 转 camelCase
#[derive(Serialize)]
struct SaveAccountWire<'a> {
    domain: &'a str,
    #[serde(rename = "appId")]
    app_id: &'a str,
    #[serde(rename = "appSecret")]
    app_secret: &'a str,
    #[serde(rename = "openId")]
    open_id: &'a str,
    #[serde(rename = "accountId", skip_serializing_if = "Option::is_none")]
    account_id: Option<&'a str>,
}

#[derive(Deserialize)]
struct SaveAccountWireResponse {
    #[serde(rename = "accountId")]
    account_id: String,
    #[serde(rename = "appId")]
    app_id: String,
    #[serde(rename = "openId")]
    open_id: String,
    domain: String,
    agent: String,
    #[serde(rename = "botName", default)]
    bot_name: Option<String>,
}

#[tauri::command]
#[specta::specta]
pub async fn feishu_save_account(
    state: State<'_, AdapterState>,
    request: SaveAccountRequest,
) -> Result<AccountSummary, String> {
    let ready = current_ready(&state)?;
    let wire = SaveAccountWire {
        domain: &request.domain,
        app_id: &request.app_id,
        app_secret: &request.app_secret,
        open_id: &request.open_id,
        account_id: request.account_id.as_deref(),
    };
    let r: SaveAccountWireResponse = post_json(&ready, "/accounts/save", &wire).await?;
    Ok(AccountSummary {
        account_id: r.account_id,
        app_id: r.app_id,
        open_id: r.open_id,
        domain: r.domain,
        agent: r.agent,
        enabled: None,
        model: None,
        bot_name: r.bot_name,
    })
}

// ============================================================
// per-account model 选择(Phase 1.x)— Tauri commands
// ============================================================

#[derive(Debug, Serialize, Deserialize, specta::Type)]
pub struct UpdateAccountModelRequest {
    pub account_id: String,
    /// `Some(model)` 设;`None` 清除(走 user 全局 default)
    pub model: Option<ModelRef>,
}

#[derive(Serialize)]
struct UpdateAccountModelWire<'a> {
    #[serde(rename = "accountId")]
    account_id: &'a str,
    /// 飞书 plugin server 接受 `null` 表示清除
    model: Option<ModelRefWire<'a>>,
}

#[derive(Serialize)]
struct ModelRefWire<'a> {
    #[serde(rename = "providerID")]
    provider_id: &'a str,
    #[serde(rename = "modelID")]
    model_id: &'a str,
}

#[derive(Deserialize)]
struct UpdateAccountModelWireResponse {
    updated: bool,
}

#[tauri::command]
#[specta::specta]
pub async fn feishu_update_account_model(
    state: State<'_, AdapterState>,
    request: UpdateAccountModelRequest,
) -> Result<bool, String> {
    let ready = current_ready(&state)?;
    let wire = UpdateAccountModelWire {
        account_id: &request.account_id,
        model: request.model.as_ref().map(|m| ModelRefWire {
            provider_id: &m.provider_id,
            model_id: &m.model_id,
        }),
    };
    let r: UpdateAccountModelWireResponse = post_json(&ready, "/accounts/update-model", &wire).await?;
    Ok(r.updated)
}

// ============================================================
// FORK: per-account settings partial update
// [feat: feishu-create-group-toggle-gui] 2026-05-24
// ============================================================

/// Tauri 命令请求 — partial settings 更新(model + enableAutoGroupCreate 任一子集)。
/// 字段都 Option:`None` = 不动,`Some(value)` = 改;model 的 `Some(None)` 用 nested Option
/// 区分(Some(Some(m))=设 model,Some(None)=清,None=不动)。
#[derive(Debug, Serialize, Deserialize, specta::Type)]
pub struct UpdateAccountSettingsRequest {
    pub account_id: String,
    /// Some(Some(m)) = 设 model;Some(None) = 清除走 default;None = 不动
    #[serde(default)]
    pub model: Option<Option<ModelRef>>,
    /// Some(true/false) = 改 flag;None = 不动
    #[serde(default)]
    pub enable_auto_group_create: Option<bool>,
}

#[derive(Serialize)]
struct UpdateAccountSettingsWire<'a> {
    #[serde(rename = "accountId")]
    account_id: &'a str,
    /// 仅当 Outer Some 时序列化(serde_json::Value::Null = nested None 表"清",省略 = 不动)
    #[serde(skip_serializing_if = "Option::is_none")]
    model: Option<Option<ModelRefWire<'a>>>,
    #[serde(
        rename = "enableAutoGroupCreate",
        skip_serializing_if = "Option::is_none"
    )]
    enable_auto_group_create: Option<bool>,
}

#[derive(Deserialize)]
struct UpdateAccountSettingsWireResponse {
    updated: bool,
}

#[tauri::command]
#[specta::specta]
pub async fn feishu_update_account_settings(
    state: State<'_, AdapterState>,
    request: UpdateAccountSettingsRequest,
) -> Result<bool, String> {
    let ready = current_ready(&state)?;
    let wire = UpdateAccountSettingsWire {
        account_id: &request.account_id,
        model: request.model.as_ref().map(|inner| {
            inner.as_ref().map(|m| ModelRefWire {
                provider_id: &m.provider_id,
                model_id: &m.model_id,
            })
        }),
        enable_auto_group_create: request.enable_auto_group_create,
    };
    let r: UpdateAccountSettingsWireResponse =
        post_json(&ready, "/accounts/update-settings", &wire).await?;
    Ok(r.updated)
}

/// 列 opencode 已配 providers + models(给 GUI 选 per-account model)
///
/// 返回 JSON 字符串(specta 不支持 serde_json::Value),前端 JSON.parse。
/// 真实形状跟 opencode `/config/providers` 一致:`{ providers: [...], default: {} }`
#[tauri::command]
#[specta::specta]
pub async fn feishu_list_providers(state: State<'_, AdapterState>) -> Result<String, String> {
    let ready = current_ready(&state)?;
    #[derive(Deserialize)]
    struct Wrap {
        data: serde_json::Value,
    }
    let r: Wrap = get_json(&ready, "/providers").await?;
    serde_json::to_string(&r.data).map_err(|e| format!("serialize providers: {e}"))
}

#[derive(Deserialize)]
struct ListAccountsWire {
    accounts: Vec<ListAccountWireItem>,
}

#[derive(Deserialize)]
struct ListAccountWireItem {
    #[serde(rename = "accountId")]
    account_id: String,
    #[serde(rename = "appId")]
    app_id: String,
    #[serde(rename = "openId")]
    open_id: String,
    domain: String,
    agent: String,
    enabled: Option<bool>,
    model: Option<ListAccountModelWire>,
    #[serde(rename = "botName", default)]
    bot_name: Option<String>,
}

#[derive(Deserialize)]
struct ListAccountModelWire {
    #[serde(rename = "providerID")]
    provider_id: String,
    #[serde(rename = "modelID")]
    model_id: String,
}

/// HTTP GET 简版(reqwest GET + Basic auth)
async fn get_json<TRes>(ready: &AdapterReady, path: &str) -> Result<TRes, String>
where
    TRes: for<'de> Deserialize<'de>,
{
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|e| format!("client build error: {e}"))?;
    let res = client
        .get(format!("{}{}", ready.url, path))
        .header("Authorization", auth_header(ready))
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

#[tauri::command]
#[specta::specta]
pub async fn feishu_list_accounts(
    state: State<'_, AdapterState>,
) -> Result<Vec<AccountSummary>, String> {
    let ready = current_ready(&state)?;
    let r: ListAccountsWire = get_json(&ready, "/accounts").await?;
    Ok(r.accounts
        .into_iter()
        .map(|w| AccountSummary {
            account_id: w.account_id,
            app_id: w.app_id,
            open_id: w.open_id,
            domain: w.domain,
            agent: w.agent,
            enabled: w.enabled,
            model: w.model.map(|m| ModelRef {
                provider_id: m.provider_id,
                model_id: m.model_id,
            }),
            bot_name: w.bot_name,
        })
        .collect())
}

#[derive(Debug, Serialize, Deserialize, specta::Type)]
pub struct DeleteAccountRequest {
    pub account_id: String,
}

#[derive(Deserialize)]
struct DeleteWireResponse {
    deleted: bool,
}

#[tauri::command]
#[specta::specta]
pub async fn feishu_delete_account(
    state: State<'_, AdapterState>,
    request: DeleteAccountRequest,
) -> Result<bool, String> {
    let ready = current_ready(&state)?;
    #[derive(Serialize)]
    struct WireReq<'a> {
        #[serde(rename = "accountId")]
        account_id: &'a str,
    }
    let r: DeleteWireResponse = post_json(
        &ready,
        "/accounts/delete",
        &WireReq { account_id: &request.account_id },
    )
    .await?;
    Ok(r.deleted)
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
