use std::sync::{Arc, Mutex, PoisonError};

use psychoscript::{
    Compiled, Data, HostError, HostFunction, HostResult, HostValue, Limits, Runtime,
};

use crate::draw;
use crate::error::Error;
use crate::json::{self, Input};
use crate::live::{LiveOptions, LiveRun, MARK, WIDGET_DEPTH};
use crate::tree::{Walk, WalkError};

/// A program compiled once, to run as often as needed: each run has its own VM. A run reads its JSON input through
/// one sync host function, `input_name` (`__input` by default), and its result is the program's completion value.
#[derive(Debug, Clone)]
pub struct Program {
    compiled: Compiled,
    input_name: String,
}

impl Program {
    /// Compiles `source`. Fails with `Syntax` when it doesn't parse.
    pub fn new(source: &str, input_name: Option<String>) -> Result<Program, Error> {
        let compiled = Runtime::make()
            .compile(source)
            .map_err(|d| Error::from_diagnostic(d, None))?;
        Ok(Program {
            compiled,
            input_name: input_name.unwrap_or_else(|| "__input".to_owned()),
        })
    }

    /// Runs the program to its end with `input_json` behind its input function, under `timeout_ms` of active time,
    /// and returns its result as JSON (`undefined` as `null`), at most `max_output_bytes` of it.
    pub fn run(
        &self,
        input_json: &str,
        timeout_ms: Option<u64>,
        max_output_bytes: Option<u64>,
    ) -> Result<String, Error> {
        let out = self.execute(input_json, timeout_ms, None)?.to_json_string();
        limit(out, max_output_bytes)
    }

    /// [`Program::run`] for a widget step run natively (`return __widget_native_step(__input())`, widgets.md, "Native
    /// hosts"): functions cross as markers, and `__widget_emit(view)` hands over the view as built, which goes out as
    /// the tree clients get, built while it is written ([`crate::tree`]). The result is the run's, its functions left
    /// out as JSON leaves them, with `view` added when one was emitted (`init` and `event` steps; draw steps run with
    /// [`Program::run_draw`]). A view that breaks a rule of views (or that the prelude found too deep to hand over, `__widget_emit(null,
    /// message)`) fails the step with [`Error::View`] once it has run; a function where none may go, or a key
    /// `encodeURIComponent` can't encode, is thrown from `__widget_emit` as the runtime's own error.
    pub fn run_step(
        &self,
        input_json: &str,
        timeout_ms: Option<u64>,
        max_output_bytes: Option<u64>,
    ) -> Result<String, Error> {
        let emitted = Arc::new(Mutex::new(Emitted::default()));
        let result = self.execute(input_json, timeout_ms, Some(&emitted));
        let emitted = std::mem::take(&mut *emitted.lock().unwrap_or_else(PoisonError::into_inner));
        if let Some(failure) = emitted.failure {
            return Err(failure);
        }
        let mut out = result?.to_json_string();
        if let Some(view) = emitted.view
            && out.ends_with('}')
        {
            out.pop();
            if out.len() > 1 {
                out.push(',');
            }
            out.push_str("\"view\":");
            out.push_str(&view);
            out.push('}');
        }
        limit(out, max_output_bytes)
    }

    /// A widget draw step run natively (`return __widget_native_step(__input())` on a `draw` input, widgets.md,
    /// "Native hosts"): functions cross as markers, and the commands the program gives `__widget_emit(commands)`, read
    /// as JSON reads them and checked (widgets.md, Canvas, "Draw command checks"), come back normalised, or `null` when
    /// it gave none; invalid ones fail with [`Error::Draw`]. The run's own result isn't read.
    pub fn run_draw(
        &self,
        input_json: &str,
        timeout_ms: Option<u64>,
        max_output_bytes: Option<u64>,
    ) -> Result<String, Error> {
        let emitted = Arc::new(Mutex::new(Emitted {
            draw: true,
            ..Emitted::default()
        }));
        let result = self.execute(input_json, timeout_ms, Some(&emitted));
        let emitted = std::mem::take(&mut *emitted.lock().unwrap_or_else(PoisonError::into_inner));
        if let Some(failure) = emitted.failure {
            return Err(failure);
        }
        result?;
        limit(
            emitted.view.unwrap_or_else(|| "null".to_owned()),
            max_output_bytes,
        )
    }

    /// One run's result; with `emitted`, a native step's: functions cross as markers, and `__widget_emit` writes the
    /// view there.
    fn execute(
        &self,
        input_json: &str,
        timeout_ms: Option<u64>,
        emitted: Option<&Arc<Mutex<Emitted>>>,
    ) -> Result<Data, Error> {
        if timeout_ms == Some(0) {
            return Err(Error::invalid_input("timeout_ms must be at least 1"));
        }
        let first = Input::parse(input_json)
            .map_err(|e| Error::invalid_input(format!("the input isn't JSON: {e}")))?;
        let slot = Arc::new(Mutex::new(Slot {
            text: input_json.into(),
            first: Some(first),
        }));
        let name = self.input_name.clone();
        let emit = emitted.cloned();
        let mut runtime = Runtime::make()
            .globals(move |_run| {
                let slot = slot.clone();
                let input_name = name.clone();
                let mut globals = vec![(
                    name.clone(),
                    HostFunction::new(move |args: Vec<HostValue>, _call| -> HostResult {
                        json::unmarked(&args, &input_name, 0)?;
                        Ok(slot.lock().unwrap_or_else(PoisonError::into_inner).read())
                    }),
                )];
                if let Some(emitted) = emit.clone() {
                    globals.push((
                        EMIT.to_owned(),
                        HostFunction::new(move |args: Vec<HostValue>, _call| {
                            emitted
                                .lock()
                                .unwrap_or_else(PoisonError::into_inner)
                                .take(&args)
                        })
                        .length(1),
                    ));
                }
                globals
            })
            .limits(Limits {
                timeout_ms,
                max_value_depth: emitted.is_some().then_some(WIDGET_DEPTH),
                ..Limits::default()
            });
        if emitted.is_some() {
            // A widget step: handler functions cross as markers.
            runtime = runtime.translate(MARK);
        }
        let outcome = runtime.execute(&self.compiled);
        drop(runtime);
        outcome
            .result
            .map_err(|d| Error::from_diagnostic(d, timeout_ms))
    }
}

/// The host global a native step hands its view to.
const EMIT: &str = "__widget_emit";

/// What a native step's `__widget_emit` took: the view's wire JSON (a draw step's commands as JSON), or why the view
/// failed.
#[derive(Default)]
struct Emitted {
    /// A draw step: `__widget_emit(commands)`.
    draw: bool,
    view: Option<String>,
    failure: Option<Error>,
}

impl Emitted {
    /// `__widget_emit(view, failure?)`: a string `failure` fails the view with it; else the view is walked. In a draw
    /// step, `__widget_emit(commands)`.
    fn take(&mut self, args: &[HostValue]) -> HostResult {
        json::unmarked(args, EMIT, 1)?;
        if self.draw {
            match draw::check_read(args.first().unwrap_or(&HostValue::Undefined)) {
                Ok(commands) => self.view = Some(commands),
                Err(reason) => {
                    self.failure = Some(Error::Draw {
                        reason,
                        line: None,
                        column: None,
                    })
                }
            }
            return Ok(HostValue::Undefined);
        }
        if let Some(HostValue::String(failure)) = args.get(1) {
            self.failure = Some(Error::View {
                reason: failure.to_string_lossy().into_owned(),
            });
            return Ok(HostValue::Undefined);
        }
        let mut out = String::new();
        match Walk::new().run(args.first().unwrap_or(&HostValue::Undefined), &mut out) {
            Ok(_) => self.view = Some(out),
            Err(WalkError::View(reason)) => {
                self.failure = Some(Error::View {
                    reason: reason.to_owned(),
                })
            }
            Err(WalkError::Function) => return Err(json::carried(1, EMIT)),
            Err(WalkError::Uri) => return Err(uri_error()),
        }
        Ok(HostValue::Undefined)
    }
}

/// The prelude's error for a key `encodeURIComponent` can't encode, located at the call.
pub(crate) fn uri_error() -> HostValue {
    HostError::located("URIError", "URI malformed")
}

/// `out`, unless it's over `max_output_bytes`.
fn limit(out: String, max_output_bytes: Option<u64>) -> Result<String, Error> {
    match max_output_bytes {
        Some(max) if out.len() as u64 > max => Err(Error::OutputTooLarge {
            reason: format!(
                "the result is {} bytes of JSON, over the limit of {max}",
                out.len()
            ),
            max_output_bytes: max,
        }),
        _ => Ok(out),
    }
}

impl Program {
    /// Starts the program as a [`LiveRun`] with `input_json` behind its input function and `__host`.
    pub fn start_live(&self, input_json: &str, options: LiveOptions) -> Result<LiveRun, Error> {
        LiveRun::start(
            self.compiled.clone(),
            self.input_name.clone(),
            input_json,
            options,
        )
    }
}

/// A run's input: the parsed value, handed over whole on the first read, and the text to read it again from.
struct Slot {
    text: Arc<str>,
    first: Option<HostValue>,
}

impl Slot {
    fn read(&mut self) -> HostValue {
        self.first
            .take()
            .unwrap_or_else(|| Input::parse(&self.text).unwrap_or_default())
    }
}
