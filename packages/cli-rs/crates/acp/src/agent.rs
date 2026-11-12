//! The method table: parameter checks, dispatch to the service, and error mapping
//! (`packages/cli/src/acp/agent.ts`, and the ACP SDK's parameter parsing).
//!
//! Parameters are checked the way the SDK's generated schemas parse them: required fields must have
//! their type, and malformed MCP servers and additional directories are skipped. A failed check answers
//! `Invalid params` with zod's `format()` shape for the first failing field.

use std::future::{Future, ready};
use std::sync::Arc;

use futures_util::future::BoxFuture;
use serde_json::{Value, json};

use crate::connection::{Handler, RequestContext};
use crate::error::{Failure, RpcError};
use crate::service::{Service, Setup};

pub struct Agent {
    pub service: Arc<Service>,
}

impl Handler for Agent {
    fn request(
        &self,
        method: &str,
        params: Value,
        context: RequestContext,
    ) -> Option<BoxFuture<'static, Result<Value, RpcError>>> {
        let service = self.service.clone();
        let work: Result<BoxFuture<'static, Result<Value, Failure>>, RpcError> = match method {
            "initialize" => object(&params).and_then(|params| {
                protocol_version(params)?;
                Ok(boxed(ready(Ok(service.initialize(params)))))
            }),
            "authenticate" => object(&params).and_then(|params| {
                let method_id = string(params, "methodId")?;
                Ok(boxed(ready(service.authenticate(&method_id))))
            }),
            "session/new" => setup(&params, false, true)
                .map(|setup| boxed(async move { service.new_session(setup, context.responded).await })),
            "session/load" => setup(&params, true, true)
                .map(|setup| boxed(async move { service.load_session(setup, context.responded).await })),
            "session/resume" => setup(&params, true, false)
                .map(|setup| boxed(async move { service.resume_session(setup, context.responded).await })),
            "session/fork" => setup(&params, true, false)
                .map(|setup| boxed(async move { service.fork_session(setup, context.responded).await })),
            "session/list" => object(&params).and_then(|params| {
                let cwd = nullable_string(params, "cwd")?;
                let cursor = nullable_string(params, "cursor")?;
                Ok(boxed(async move { service.list_sessions(cwd, cursor).await }))
            }),
            "session/delete" => session_id(&params).map(|id| boxed(async move { service.delete_session(&id).await })),
            "session/close" => session_id(&params).map(|id| boxed(async move { service.close_session(&id).await })),
            "session/set_mode" => object(&params).and_then(|params| {
                let id = string(params, "sessionId")?;
                let mode = string(params, "modeId")?;
                Ok(boxed(async move { service.set_mode(&id, &mode).await }))
            }),
            "session/set_config_option" => object(&params).and_then(|params| {
                let id = string(params, "sessionId")?;
                let config_id = string(params, "configId")?;
                let value = config_value(params)?;
                Ok(boxed(async move { service.set_config_option(&id, &config_id, &value).await }))
            }),
            "session/prompt" => object(&params).and_then(|params| {
                let id = string(params, "sessionId")?;
                let prompt = content_blocks(params)?;
                Ok(service.prompt(id, prompt, &context.cancel, context.responded))
            }),
            // Interim extension until ACP has native mid-turn steering.
            "_session/steering" => {
                steering(&params).map(|(id, prompt)| boxed(async move { service.steer(&id, &prompt).await }))
            }
            _ => return None,
        };
        Some(match work {
            Ok(work) => Box::pin(async move { work.await.map_err(|failure| failure.to_rpc()) }),
            Err(error) => Box::pin(async move { Err(error) }),
        })
    }

    fn notification(&self, method: &str, params: Value) {
        if method != "session/cancel" {
            return;
        }
        let Ok(id) = session_id(&params) else {
            log::error!(params = params.to_string().as_str(); "Error handling notification");
            return;
        };
        tokio::spawn(self.service.turns.cancel(&id));
    }
}

fn boxed(
    work: impl Future<Output = Result<Value, Failure>> + Send + 'static,
) -> BoxFuture<'static, Result<Value, Failure>> {
    Box::pin(work)
}

fn received(value: Option<&Value>) -> &'static str {
    match value {
        None => "undefined",
        Some(Value::Null) => "null",
        Some(Value::Bool(_)) => "boolean",
        Some(Value::Number(_)) => "number",
        Some(Value::String(_)) => "string",
        Some(Value::Array(_)) => "array",
        Some(Value::Object(_)) => "object",
    }
}

fn issue(path: Option<&str>, message: String) -> RpcError {
    let data = match path {
        None => json!({ "_errors": [message] }),
        Some(path) => json!({ "_errors": [], (path): { "_errors": [message] } }),
    };
    RpcError::invalid_params(data, "")
}

fn expected(path: &str, kind: &str, value: Option<&Value>) -> RpcError {
    issue(Some(path), format!("Invalid input: expected {kind}, received {}", received(value)))
}

fn object(params: &Value) -> Result<&Value, RpcError> {
    if params.is_object() {
        return Ok(params);
    }
    let value = (!params.is_null()).then_some(params);
    Err(issue(None, format!("Invalid input: expected object, received {}", received(value))))
}

fn string(params: &Value, key: &str) -> Result<String, RpcError> {
    params.get(key).and_then(Value::as_str).map(str::to_owned).ok_or_else(|| expected(key, "string", params.get(key)))
}

fn nullable_string(params: &Value, key: &str) -> Result<Option<String>, RpcError> {
    match params.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(value)) => Ok(Some(value.clone())),
        other => Err(expected(key, "string", other)),
    }
}

fn protocol_version(params: &Value) -> Result<(), RpcError> {
    let value = params.get("protocolVersion");
    match value.and_then(Value::as_i64) {
        Some(version) if (0..=65_535).contains(&version) => Ok(()),
        _ => Err(expected("protocolVersion", "int", value)),
    }
}

fn session_id(params: &Value) -> Result<String, RpcError> {
    string(object(params)?, "sessionId")
}

fn setup(params: &Value, with_session: bool, mcp_required: bool) -> Result<Setup, RpcError> {
    let params = object(params)?;
    let session_id = if with_session { string(params, "sessionId")? } else { String::new() };
    let cwd = string(params, "cwd")?;
    let mcp = params.get("mcpServers");
    if mcp_required && mcp.is_none() {
        return Err(issue(Some("mcpServers"), "Required value is missing".to_owned()));
    }
    let strings = |value: Option<&Value>| -> Vec<String> {
        value.and_then(Value::as_array).into_iter().flatten().filter_map(Value::as_str).map(str::to_owned).collect()
    };
    Ok(Setup {
        cwd,
        session_id,
        additional_directories: strings(params.get("additionalDirectories")),
        mcp_servers: mcp.and_then(Value::as_array).into_iter().flatten().filter_map(mcp_server).collect(),
    })
}

fn is_string(value: &Value, key: &str) -> bool {
    value.get(key).is_some_and(Value::is_string)
}

fn pairs(value: &Value, key: &str) -> bool {
    value
        .get(key)
        .and_then(Value::as_array)
        .is_some_and(|items| items.iter().all(|item| is_string(item, "name") && is_string(item, "value")))
}

/// `server` as the SDK parses it into one of its MCP server variants (`zMcpServer`). The stdio variant has no
/// `type`, so the SDK strips a `"type": "stdio"` tag.
fn mcp_server(server: &Value) -> Option<Value> {
    if !is_string(server, "name") {
        return None;
    }
    let tagged = match server.get("type").and_then(Value::as_str) {
        Some("http" | "sse") => is_string(server, "url") && pairs(server, "headers"),
        Some("acp") => is_string(server, "serverId"),
        _ => false,
    };
    if tagged {
        return Some(server.clone());
    }
    let stdio = is_string(server, "command")
        && server.get("args").and_then(Value::as_array).is_some_and(|args| args.iter().all(Value::is_string))
        && pairs(server, "env");
    stdio.then(|| {
        let mut server = server.clone();
        server.as_object_mut().map(|object| object.remove("type"));
        server
    })
}

fn config_value(params: &Value) -> Result<Value, RpcError> {
    match params.get("value") {
        Some(Value::String(value)) => Ok(json!(value)),
        Some(Value::Bool(value)) if params.get("type") == Some(&json!("boolean")) => Ok(json!(value)),
        other => Err(expected("value", "string", other)),
    }
}

/// `parseSteering`: `{ sessionId: string, prompt: unknown[] }`, failing with Effect Schema's message as `details`.
fn steering(params: &Value) -> Result<(String, Vec<Value>), RpcError> {
    let fail = |message: &str| RpcError::invalid_params(json!({ "details": message }), "");
    let Some(object) = params.as_object() else { return Err(fail("Expected object")) };
    let id = match object.get("sessionId") {
        None => return Err(fail("Missing key\n  at [\"sessionId\"]")),
        Some(Value::String(id)) => id.clone(),
        Some(_) => return Err(fail("Expected string\n  at [\"sessionId\"]")),
    };
    match object.get("prompt") {
        None => Err(fail("Missing key\n  at [\"prompt\"]")),
        Some(Value::Array(prompt)) => Ok((id, prompt.clone())),
        Some(_) => Err(fail("Expected array\n  at [\"prompt\"]")),
    }
}

fn content_blocks(params: &Value) -> Result<Vec<Value>, RpcError> {
    let value = params.get("prompt");
    let Some(blocks) = value.and_then(Value::as_array) else { return Err(expected("prompt", "array", value)) };
    if let Some(index) = blocks.iter().position(|block| !content_block(block)) {
        return Err(RpcError::invalid_params(
            json!({ "_errors": [], "prompt": { "_errors": [], (index.to_string()): { "_errors": ["Invalid input"] } } }),
            "",
        ));
    }
    Ok(blocks.clone())
}

/// Whether `block` parses as one of the SDK's content block variants.
fn content_block(block: &Value) -> bool {
    match block.get("type").and_then(Value::as_str) {
        Some("text") => is_string(block, "text"),
        Some("image" | "audio") => is_string(block, "data") && is_string(block, "mimeType"),
        Some("resource_link") => is_string(block, "uri") && is_string(block, "name"),
        Some("resource") => block.get("resource").is_some_and(|resource| {
            is_string(resource, "uri") && (is_string(resource, "text") || is_string(resource, "blob"))
        }),
        _ => false,
    }
}
