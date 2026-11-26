//! The JavaScript bindings (`wasm32-unknown-unknown`, wasm-bindgen). Errors are thrown as `Error`s named
//! `PsychoScriptError` with `type`, `kind`, `line`, `column` and `phase` (see [`crate::Error`]).

use wasm_bindgen::prelude::*;

#[cfg(feature = "language")]
use crate::{Error, LiveOptions, LiveRun, Program, Pump};

fn set(target: &JsValue, key: &str, value: JsValue) {
    let _ = js_sys::Reflect::set(target, &JsValue::from_str(key), &value);
}

#[cfg(feature = "language")]
fn thrown(e: Error) -> JsValue {
    let error = js_sys::Error::new(e.reason());
    error.set_name("PsychoScriptError");
    let value: JsValue = error.into();
    set(&value, "type", e.type_name().into());
    if let Some(kind) = e.kind() {
        set(&value, "kind", kind.into());
    }
    if let Some((line, column)) = e.location() {
        set(&value, "line", line.into());
        set(&value, "column", column.into());
    }
    if let Some(phase) = e.phase() {
        set(&value, "phase", phase.into());
    }
    value
}

/// A program compiled once, to run as often as needed (each run has its own VM).
#[cfg(feature = "language")]
#[wasm_bindgen(js_name = Program)]
pub struct JsProgram(Program);

#[cfg(feature = "language")]
#[wasm_bindgen(js_class = Program)]
impl JsProgram {
    /// Compiles `source`; its runs read their input through `inputName()` (`__input` by default).
    #[wasm_bindgen(constructor)]
    pub fn new(source: &str, input_name: Option<String>) -> Result<JsProgram, JsValue> {
        Program::new(source, input_name)
            .map(JsProgram)
            .map_err(thrown)
    }

    /// Runs the program with `inputJson` behind its input function; returns its completion value as JSON.
    pub fn run(
        &self,
        input_json: &str,
        timeout_ms: Option<f64>,
        max_output_bytes: Option<f64>,
    ) -> Result<String, JsValue> {
        self.0
            .run(
                input_json,
                timeout_ms.map(|t| t.max(1.0) as u64),
                max_output_bytes.map(|m| m.max(0.0) as u64),
            )
            .map_err(thrown)
    }

    /// Runs a widget step natively (`return __widget_native_step(__input())`, widgets.md "Native hosts"): as `run`,
    /// with the view the program gave `__widget_emit` added as `view`, written as the tree clients get.
    #[wasm_bindgen(js_name = runStep)]
    pub fn run_step(
        &self,
        input_json: &str,
        timeout_ms: Option<f64>,
        max_output_bytes: Option<f64>,
    ) -> Result<String, JsValue> {
        self.0
            .run_step(
                input_json,
                timeout_ms.map(|t| t.max(1.0) as u64),
                max_output_bytes.map(|m| m.max(0.0) as u64),
            )
            .map_err(thrown)
    }

    /// Runs a widget draw step natively: the commands the program gave `__widget_emit`, as JSON (`null` for none).
    #[wasm_bindgen(js_name = runDraw)]
    pub fn run_draw(
        &self,
        input_json: &str,
        timeout_ms: Option<f64>,
        max_output_bytes: Option<f64>,
    ) -> Result<String, JsValue> {
        self.0
            .run_draw(
                input_json,
                timeout_ms.map(|t| t.max(1.0) as u64),
                max_output_bytes.map(|m| m.max(0.0) as u64),
            )
            .map_err(thrown)
    }

    /// Starts the program as a live run with `inputJson` behind its input function and `__host`. `options`:
    /// `{ sliceBudgetMs = 50, maxPostsPerSecond = 240, httpsHosts?: string[], allowLocalNetwork = false,
    /// native = false }` (`native`: a `__widget_live(__input(), true)` run, widgets.md "Native hosts").
    #[wasm_bindgen(js_name = startLive)]
    pub fn start_live(&self, input_json: &str, options: JsValue) -> Result<JsLiveRun, JsValue> {
        let mut o = LiveOptions::default();
        if options.is_object() {
            let get = |k: &str| js_sys::Reflect::get(&options, &JsValue::from_str(k)).ok();
            if let Some(n) = get("sliceBudgetMs").and_then(|v| v.as_f64()) {
                o.slice_budget_ms = n.max(1.0) as u64;
            }
            if let Some(n) = get("maxPostsPerSecond").and_then(|v| v.as_f64()) {
                o.max_posts_per_second = n.max(0.0) as u32;
            }
            o.allow_local_network =
                get("allowLocalNetwork").is_some_and(|v| v.as_bool() == Some(true));
            o.native = get("native").is_some_and(|v| v.as_bool() == Some(true));
            if let Some(hosts) = get("httpsHosts").filter(js_sys::Array::is_array) {
                o.https_hosts = Some(
                    js_sys::Array::from(&hosts)
                        .iter()
                        .filter_map(|h| h.as_string())
                        .collect(),
                );
            }
        }
        self.0
            .start_live(input_json, o)
            .map(JsLiveRun)
            .map_err(thrown)
    }
}

/// A long-running program, driven by `pump` (see `LiveRun` in the crate docs).
#[cfg(feature = "language")]
#[wasm_bindgen(js_name = LiveRun)]
pub struct JsLiveRun(LiveRun);

#[cfg(feature = "language")]
#[wasm_bindgen(js_class = LiveRun)]
impl JsLiveRun {
    /// Runs the program for up to `maxMs`. Returns `-3` once it ended (`exit()` says how), `-2` while still computing
    /// (pump again soon), `-1` when it waits on the host with no timer, else the ms until its next timer.
    pub fn pump(&mut self, max_ms: f64) -> f64 {
        match self.0.pump(max_ms) {
            Pump::Ended => -3.0,
            Pump::Again => -2.0,
            Pump::Wait(None) => -1.0,
            Pump::Wait(Some(ms)) => ms,
        }
    }

    /// Queues a JSON message for `__host.receive()`. Pump afterwards.
    pub fn deliver(&mut self, message_json: &str) -> Result<(), JsValue> {
        self.0.deliver(message_json).map_err(thrown)
    }

    /// What the program posted and the requests it made since the last call, as a JSON array.
    #[wasm_bindgen(js_name = takeOutbox)]
    pub fn take_outbox(&mut self) -> String {
        self.0.take_outbox()
    }

    /// The bytes of the GPU batches in the outbox `takeOutbox` just gave (`bytes: [offset, length]`): call it right
    /// after.
    #[wasm_bindgen(js_name = takeBytes)]
    pub fn take_bytes(&mut self) -> Vec<u8> {
        self.0.take_bytes()
    }

    /// Answers fetch `id`: `metaJson` is `{ status, url, headers }` (the final URL), `body` the body's bytes.
    #[wasm_bindgen(js_name = fetchDone)]
    pub fn fetch_done(&mut self, id: f64, meta_json: &str, body: Vec<u8>) {
        self.0.fetch_done(id as u64, meta_json, body);
    }

    /// Fails fetch `id` with `kind` (`Network`, `Timeout`, `TooLarge`).
    #[wasm_bindgen(js_name = fetchFailed)]
    pub fn fetch_failed(&mut self, id: f64, kind: &str, message: &str) {
        self.0.fetch_failed(id as u64, kind, message);
    }

    pub fn pause(&mut self) -> Result<(), JsValue> {
        self.0.pause().map_err(thrown)
    }

    pub fn resume(&mut self) -> Result<(), JsValue> {
        self.0.resume().map_err(thrown)
    }

    pub fn stop(&mut self) {
        self.0.stop();
    }

    #[wasm_bindgen(js_name = isPaused)]
    pub fn is_paused(&self) -> bool {
        self.0.is_paused()
    }

    #[wasm_bindgen(js_name = nowMs)]
    pub fn now_ms(&self) -> f64 {
        self.0.now_ms()
    }

    /// How the run ended, as JSON (`{ type: "finished", result }`, `{ type: "failed", error }`,
    /// `{ type: "stopped" }`), or `undefined` while it runs.
    pub fn exit(&self) -> Option<String> {
        self.0.exit().map(|e| e.to_json())
    }
}
