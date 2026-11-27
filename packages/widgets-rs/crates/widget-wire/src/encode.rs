//! The host's encoder: the VM's value (a [`HostValue`] tree, as a host function receives it) straight into the binary
//! format, with no JSON text in between except for the generic data that stays JSON.

use std::borrow::Cow;
use std::time::{Duration, Instant};

use psychoscript::{Data, HostString, HostValue};

use crate::VERSION;
use crate::draw::{
    Cap, Color, Fill, Gradient, GradientShape, MAX_COMMANDS, Paint, TextAlign, TextOptions, Token,
};
use crate::gpu::Arg;
use crate::json;
use crate::native::{Canvas, Found};
use crate::schema::*;

/// Why a value can't be written: a program error in the phase its kind names (`widgets-binary.md`, Errors).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EncodeError {
    /// `InvalidView`, `InvalidDraw` or `InvalidGpu` (phase `view`, `draw` or `gpu`); `InvalidDataValue` for a value
    /// that is none of those (an unknown post type, a step output that isn't an object).
    pub kind: &'static str,
    pub message: String,
}

impl std::fmt::Display for EncodeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.kind, self.message)
    }
}

impl std::error::Error for EncodeError {}

pub const INVALID_VIEW: &str = "InvalidView";
pub const INVALID_DRAW: &str = "InvalidDraw";
pub const INVALID_GPU: &str = "InvalidGpu";
pub const INVALID_DATA: &str = "InvalidDataValue";

/// A run's output, as one value: a draw step's `{ commands }` as `01 D`, an init or event step's
/// `{ state, view, submit?, dismiss?, send? }` as `01 S`, the view already the tree clients get. Fails for an invalid
/// draw (`InvalidDraw`) or a value that isn't a step output. (Protocol 1's output; a native host uses [`NativeStep`].)
pub fn encode_output(v: &HostValue) -> Result<Vec<u8>, EncodeError> {
    let v = &*as_json(v);
    let fail = |kind| move |message| EncodeError { kind, message };
    if !matches!(v, HostValue::Object(_)) {
        return Err(fail(INVALID_DATA)(
            "a step must return an object with state and view".into(),
        ));
    }
    let mut out = vec![VERSION];
    match field(v, "commands") {
        Some(commands) => draw_section(commands, &mut out).map_err(fail(INVALID_DRAW))?,
        None => {
            let send = field(v, "send")
                .filter(|s| matches!(s, HostValue::Object(_)))
                .map(|s| {
                    let value = field(s, "value").filter(|v| !json::skipped(v));
                    (
                        value.map_or_else(|| "null".into(), json::write),
                        !matches!(field(s, "wake"), Some(HostValue::Bool(false))),
                    )
                });
            step_head(
                &mut out,
                field(v, "state").map(json::write),
                field(v, "submit")
                    .filter(|s| !json::skipped(s))
                    .map(json::write),
                matches!(field(v, "dismiss"), Some(HostValue::Bool(true))),
                send,
            );
            let mut s = Streams::default();
            write_node(&mut s, field(v, "view").unwrap_or(&HostValue::Null), 0)
                .map_err(fail(INVALID_VIEW))?;
            s.finish_into(&mut out);
        }
    }
    Ok(out)
}

/// Why a native host's call fails, besides an invalid value.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum CallError {
    /// A program error: the call throws it (uncaught, the run fails with its kind and message, at the call).
    Invalid(EncodeError),
    /// A function in argument `arg` (from 1) where none may go: the call throws the runtime's `TypeError`
    /// `Argument <arg> to <name> contains a function, which cannot be passed to the host.`
    Function { arg: usize },
    /// A key `encodeURIComponent` can't write: the call throws `URIError: URI malformed`.
    Uri,
    /// An `Error` with this message, which the program can catch (a draw for a key the last render has no canvas
    /// for, or a GPU canvas).
    Throw(String),
    /// The view breaks Keys and depth, or the prelude says so: a program error in phase `view` with this message,
    /// which ends a live run at once; the call doesn't throw.
    View(String),
    /// A program error that ends a live run at once, the call not throwing (a draw post without a string key).
    End(EncodeError),
}

impl From<crate::native::Stop> for CallError {
    fn from(s: crate::native::Stop) -> Self {
        match s {
            crate::native::Stop::View(m) => CallError::View(m.into()),
            crate::native::Stop::Function => CallError::Function { arg: 1 },
            crate::native::Stop::Uri => CallError::Uri,
        }
    }
}

/// A native host's step (`widgets.md`, Native hosts). In an `init` or `event` step, `__widget_emit(view, failure?)`
/// gives the view as built, which is walked as it is encoded, and the run's result the rest of the output
/// ([`NativeStep::finish`]). In a `draw` step, `__widget_emit(commands)` gives the commands, and the run has no result.
#[derive(Debug, Default)]
pub struct NativeStep {
    draw: bool,
    view: Option<Vec<u8>>,
    failure: Option<String>,
    commands: Option<Result<Vec<u8>, EncodeError>>,
}

impl NativeStep {
    /// A step of the phase the host asked for: `draw`, or `init` and `event`.
    pub fn new(draw: bool) -> NativeStep {
        NativeStep {
            draw,
            ..NativeStep::default()
        }
    }

    /// `__widget_emit`'s arguments. A view breaking Keys and depth (or a failure the prelude passes) is kept for
    /// [`NativeStep::failure`], not thrown; so is a draw's failure, for [`NativeStep::finish`].
    pub fn emit(&mut self, args: &[HostValue]) -> Result<(), CallError> {
        if self.draw {
            // Read as JSON reads them (markers left out of objects, `null` in arrays), then checked as a draw output.
            let commands = args.first().unwrap_or(&HostValue::Undefined);
            let commands = match crate::native::marked(commands) {
                true => Cow::Owned(unmark(commands)),
                false => as_json(commands),
            };
            let mut out = vec![VERSION];
            self.commands = Some(draw_section(&commands, &mut out).map(|()| out).map_err(
                |message| EncodeError {
                    kind: INVALID_DRAW,
                    message,
                },
            ));
            return Ok(());
        }
        let view = args.first().unwrap_or(&HostValue::Undefined);
        let failure = args.get(1).unwrap_or(&HostValue::Undefined);
        if let Some(arg) = args.iter().skip(2).position(crate::native::marked) {
            return Err(CallError::Function { arg: arg + 3 });
        }
        if let HostValue::String(f) = failure {
            self.failure = Some(f.to_string_lossy().into_owned());
            return Ok(());
        }
        if crate::native::marked(failure) {
            return Err(CallError::Function { arg: 2 });
        }
        let mut s = Streams::default();
        match crate::native::walk(Some(&mut s), view) {
            Ok(_) => {
                let mut out = Vec::new();
                s.finish_into(&mut out);
                self.view = Some(out);
                self.failure = None;
                Ok(())
            }
            Err(crate::native::Stop::View(m)) => {
                self.failure = Some(m.into());
                Ok(())
            }
            Err(e) => Err(e.into()),
        }
    }

    /// The view's failure, a program error in phase `view` that fails the step whatever the run did.
    pub fn failure(&self) -> Option<&str> {
        self.failure.as_deref()
    }

    /// The step's bytes: `01 S` from the run's result (markers in it left out, as JSON leaves functions out) and the
    /// emitted view, or for a draw step `01 D` from the emitted commands.
    pub fn finish(&self, result: &Data) -> Result<Vec<u8>, EncodeError> {
        let fail = |kind| move |message| EncodeError { kind, message };
        if self.draw {
            return self
                .commands
                .clone()
                .unwrap_or_else(|| Err(fail(INVALID_DRAW)("draw commands must be a list".into())));
        }
        let mut out = vec![VERSION];
        let Some(view) = &self.view else {
            return Err(fail(INVALID_DATA)("The step gave no view".into()));
        };
        if !matches!(result, Data::Object(_)) {
            return Err(fail(INVALID_DATA)(
                "a step must return an object with state and view".into(),
            ));
        }
        let get = |d: &'_ Data, k: &str| {
            d.get(k)
                .filter(|v| !matches!(v, Data::FunctionMarker))
                .cloned()
        };
        let send = get(result, "send")
            .filter(|s| matches!(s, Data::Object(_)))
            .map(|s| {
                (
                    get(&s, "value").map_or_else(|| "null".into(), |v| v.to_json_string()),
                    !matches!(get(&s, "wake"), Some(Data::Bool(false))),
                )
            });
        step_head(
            &mut out,
            get(result, "state").map(|v| v.to_json_string()),
            get(result, "submit").map(|v| v.to_json_string()),
            matches!(get(result, "dismiss"), Some(Data::Bool(true))),
            send,
        );
        out.extend_from_slice(view);
        Ok(out)
    }
}

/// `v` as JSON reads it: function markers left out of objects and `null` in arrays, other values as their JSON.
fn unmark(v: &HostValue) -> HostValue {
    match v {
        HostValue::Array(items) => HostValue::Array(
            items
                .iter()
                .map(|i| match i {
                    Some(HostValue::FunctionMarker) => Some(HostValue::Null),
                    i => i.as_ref().map(unmark),
                })
                .collect(),
        ),
        HostValue::Object(fields) => HostValue::Object(
            fields
                .iter()
                .filter(|(_, v)| !matches!(v, HostValue::FunctionMarker))
                .map(|(k, v)| (k.clone(), unmark(v)))
                .collect(),
        ),
        HostValue::FunctionMarker => HostValue::Undefined,
        v => json_view(v),
    }
}

/// The post rate (`widgets-live.md`, Post rate): a bucket of this many tokens, refilled at [`POSTS_PER_SECOND`].
pub const BURST: f64 = 8.0;
pub const POSTS_PER_SECOND: f64 = 240.0;
const EPSILON: f64 = 1e-9;
/// The failure of a draw post without a canvas key (an invalid post, phase `main`).
pub const DRAW_KEY: &str = "A draw post needs a string key";

/// A host that replays a live run's GPU batches itself (`widgets-gpu.md`) instead of handing them to the client.
/// [`LivePosts`] calls it in the order the program posted what it calls for, a batch never ahead of a waiting
/// `render` or `draw` (`widgets-live.md`, Post rate).
pub trait GpuHost: Send {
    /// A batch: its ops as JSON reads them, and its bytes (the program's `ArrayBuffer`, borrowed, when it applies at
    /// once).
    fn batch(&mut self, ops: &[Arg], bytes: &[u8]);
    /// A posted batch of the wrong shape: the spec's message (`a batch must be an object`, `a batch's ops must be a
    /// list`, `a batch's bytes must be an ArrayBuffer`), a program error in phase `gpu` (`Gpu::shape_error`), with
    /// its ops when they are a list. The run goes on.
    fn shape_error(&mut self, ops: Option<&[Arg]>, message: String);
    /// A frame request (`Gpu::end_frame`), after the batch it carries; one while a request is pending isn't.
    fn end_frame(&mut self);
    /// The keys of the `gpu: true` canvases of the render just posted, when they changed.
    fn canvases(&mut self, keys: &[String]);
    /// A `{ type: "canvas", key, width, height }` the program received.
    fn resize(&mut self, key: &str, width: u32, height: u32);
}

/// What the GPU host does, when it waits behind counted posts.
enum Step {
    Batch(Vec<Arg>, Vec<u8>),
    ShapeError(Option<Vec<Arg>>, String),
    EndFrame,
    Canvases(Vec<String>),
    Resize(String, u32, u32),
}

enum Waiting {
    /// A counted post: the render (`None`) or a draw by canvas key.
    Counted(Option<String>, Vec<u8>),
    /// Behind them without a token: a step for the GPU host, then the bytes of the post that carried it.
    Behind(Option<Step>, Option<Vec<u8>>),
}

/// A native host's live posts (`widgets-live.md`): each render is walked as it is encoded, a draw names its canvas by
/// key, which the last render's canvases map to the canvas's id, and `render` and `draw` posts go to the client under
/// the post rate. Every post is checked and encoded when the program posts it; only its delivery waits. With a
/// [`GpuHost`], it gets the GPU batches; without one (no GPU: the program gets `gpu.available` false), they are
/// dropped. Batches never reach the client.
pub struct LivePosts {
    last: Found,
    per_second: f64,
    tokens: f64,
    at: Option<Instant>,
    /// The posts waiting, oldest first: counted ones for a token, and posts carrying a batch behind them.
    waiting: Vec<Waiting>,
    /// A frame request went out and no frame came since.
    frame: bool,
    gpu: Option<Box<dyn GpuHost>>,
    /// The GPU canvas keys last given to the host.
    gpu_keys: Vec<String>,
    /// The batches posted, as the GPU fixtures write them ([`LivePosts::record_batches`]).
    #[cfg(feature = "test-hooks")]
    recorded: Option<Vec<serde_json::Value>>,
}

impl std::fmt::Debug for LivePosts {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("LivePosts")
            .field("last", &self.last)
            .field("tokens", &self.tokens)
            .field("waiting", &self.waiting.len())
            .field("frame", &self.frame)
            .field("gpu", &self.gpu.is_some())
            .finish()
    }
}

impl Default for LivePosts {
    fn default() -> Self {
        LivePosts::with_rate(POSTS_PER_SECOND)
    }
}

impl LivePosts {
    pub fn new() -> LivePosts {
        LivePosts::default()
    }

    /// Under a post rate of `per_second` (the spec's is [`POSTS_PER_SECOND`]).
    pub fn with_rate(per_second: f64) -> LivePosts {
        LivePosts {
            last: Found::default(),
            per_second,
            tokens: BURST,
            at: None,
            waiting: Vec::new(),
            frame: false,
            gpu: None,
            gpu_keys: Vec::new(),
            #[cfg(feature = "test-hooks")]
            recorded: None,
        }
    }

    /// For tests (feature `test-hooks`): keeps every batch posted from now on, as the GPU conformance fixtures write
    /// them ([`LivePosts::recorded`]).
    #[cfg(feature = "test-hooks")]
    pub fn record_batches(&mut self) {
        self.recorded.get_or_insert_with(Vec::new);
    }

    /// The batches posted since [`LivePosts::record_batches`], each `{ frame, ops, bytes }` (`widgets-gpu.md`,
    /// Conformance).
    #[cfg(feature = "test-hooks")]
    pub fn recorded(&self) -> &[serde_json::Value] {
        self.recorded.as_deref().unwrap_or_default()
    }

    /// Replays GPU batches with `host` from now on (`widgets-gpu.md`): they no longer go to the client.
    pub fn set_gpu(&mut self, host: Box<dyn GpuHost>) {
        self.gpu = Some(host);
    }

    /// What the last render found: its handler ids and canvases.
    pub fn last_render(&self) -> &Found {
        &self.last
    }

    /// Takes the canvases of a render before a snapshot (`last_render().canvases`), for draws after a restore.
    pub fn restore_canvases(&mut self, canvases: Vec<Canvas>) {
        self.last.canvases = canvases;
    }

    /// `message`, posted at `now`: the bytes to hand to the client now (none, or several when a `submit` or `dismiss`
    /// releases the waiting posts ahead of itself), and for a render whether its view has a handler, which `post`
    /// returns.
    pub fn post(
        &mut self,
        m: &HostValue,
        now: Instant,
    ) -> Result<(Vec<Vec<u8>>, Option<bool>), CallError> {
        let fields = match m {
            HostValue::Object(fields) => &fields[..],
            _ => &[],
        };
        let rest_marked = |skip: &[&str]| {
            fields.iter().any(|(k, v)| {
                !k.as_str().is_some_and(|k| skip.contains(&k)) && crate::native::marked(v)
            })
        };
        let ty = field(m, "type").and_then(HostValue::as_str);
        match ty {
            Some("render") => {
                if let Some(HostValue::String(f)) = field(m, "failure") {
                    return Err(CallError::View(f.to_string_lossy().into_owned()));
                }
                let node = field(m, "node").unwrap_or(&HostValue::Undefined);
                let mut s = Streams::default();
                let found = crate::native::walk(Some(&mut s), node)?;
                if rest_marked(&["node"]) {
                    return Err(CallError::Function { arg: 1 });
                }
                let handled = !found.handlers.is_empty();
                self.last = found;
                let mut out = Vec::new();
                if self.gpu.is_some() {
                    let keys: Vec<String> = (self.last.canvases.iter())
                        .filter(|c| c.gpu)
                        .map(|c| c.key.clone())
                        .collect();
                    if keys != self.gpu_keys {
                        self.gpu_keys = keys.clone();
                        out = self.behind(Some(Step::Canvases(keys)), None, false);
                    }
                }
                let mut bytes = vec![VERSION, RENDER];
                s.finish_into(&mut bytes);
                out.extend(self.counted(None, bytes, now));
                Ok((out, Some(handled)))
            }
            Some("draw") => {
                let Some(HostValue::String(key)) = field(m, "key") else {
                    return Err(CallError::End(EncodeError {
                        kind: INVALID_DATA,
                        message: DRAW_KEY.into(),
                    }));
                };
                let key = key.to_string_lossy().into_owned();
                let Some(canvas) = self.last.canvases.iter().find(|c| c.key == key) else {
                    return Err(CallError::Throw(format!(
                        "No canvas with key \"{key}\" in the rendered view"
                    )));
                };
                if canvas.wgsl {
                    return Err(CallError::Throw(format!(
                        "Canvas \"{key}\" is drawn by its wgsl; it takes no draw commands"
                    )));
                }
                if canvas.gpu {
                    return Err(CallError::Throw(format!(
                        "Canvas \"{key}\" is drawn by the GPU; it takes no draw commands"
                    )));
                }
                if rest_marked(&[]) {
                    return Err(CallError::Function { arg: 1 });
                }
                let m = &*as_json(m);
                let mut out = vec![VERSION, DRAW];
                put_str(&mut out, &canvas.id);
                let commands = field(m, "commands").unwrap_or(&HostValue::Undefined);
                // The check's message as it is (`widgets.md`, Draw command checks).
                draw_section(commands, &mut out).map_err(|message| {
                    CallError::Invalid(EncodeError {
                        kind: INVALID_DRAW,
                        message,
                    })
                })?;
                Ok((self.counted(Some(key), out, now), None))
            }
            _ if crate::native::marked(m) => Err(CallError::Function { arg: 1 }),
            Some(kind @ ("frame" | "gpu")) => {
                let batch = match kind {
                    "gpu" => Some(m),
                    _ => field(m, "gpu").filter(|g| !matches!(g, HostValue::Null)),
                };
                // A frame request while one is pending changes nothing, but the GPU batch it carries still goes.
                let request = kind == "frame" && !self.frame;
                self.frame |= request;
                #[cfg(feature = "test-hooks")]
                if let (Some(r), true) = (self.recorded.as_mut(), request || batch.is_some()) {
                    r.push(crate::gpu::recorded(request, batch));
                }
                let mut out = Vec::new();
                let gpu = self.gpu.is_some();
                if let (Some(batch), true) = (batch, gpu) {
                    self.batch(batch);
                }
                if request {
                    let bytes = vec![VERSION, FRAME];
                    match (gpu, batch.is_some()) {
                        // The frame request waits behind what waits only when it carries a batch.
                        (true, true) => out = self.behind(Some(Step::EndFrame), Some(bytes), true),
                        (true, false) => {
                            out = self.behind(Some(Step::EndFrame), None, false);
                            out.push(bytes);
                        }
                        (false, _) => out.push(bytes),
                    }
                }
                Ok((out, None))
            }
            _ => {
                let bytes = encode_post(m).map_err(CallError::Invalid)?;
                let mut out = match ty {
                    Some("submit" | "dismiss") => self.release(),
                    _ => Vec::new(),
                };
                out.push(bytes);
                Ok((out, None))
            }
        }
    }

    /// A message the client delivered to the program: a `frame` answers the pending frame request.
    pub fn delivered(&mut self, m: &HostValue) {
        if field(m, "type").and_then(HostValue::as_str) == Some("frame") {
            self.frame = false;
        }
    }

    /// A message the program received: a GPU canvas's size goes to the GPU host after the batches posted before.
    pub fn received(&mut self, m: &HostValue) -> Vec<Vec<u8>> {
        if self.gpu.is_none() || field(m, "type").and_then(HostValue::as_str) != Some("canvas") {
            return Vec::new();
        }
        let size = |k| match field(m, k) {
            Some(HostValue::Number(n)) if *n >= 0.0 && *n <= u32::MAX as f64 => Some(*n as u32),
            _ => None,
        };
        let (Some(key), Some(width), Some(height)) = (
            field(m, "key").and_then(HostValue::as_str),
            size("width"),
            size("height"),
        ) else {
            return Vec::new();
        };
        let step = Step::Resize(key.to_owned(), width, height);
        self.behind(Some(step), None, false)
    }

    /// The waiting posts whose tokens came by `now`, in order, and the batches behind them.
    pub fn due(&mut self, now: Instant) -> Vec<Vec<u8>> {
        self.refill(now);
        let mut out = Vec::new();
        while let Some(first) = self.waiting.first() {
            if matches!(first, Waiting::Counted(..)) {
                if self.tokens < 1.0 - EPSILON {
                    break;
                }
                self.tokens -= 1.0;
            }
            let first = self.waiting.remove(0);
            self.run(first, &mut out);
        }
        out
    }

    /// When the next waiting post's token comes, if a post waits.
    pub fn next_due(&self) -> Option<Instant> {
        let at = self.at?;
        (!self.waiting.is_empty())
            .then(|| at + Duration::from_secs_f64((1.0 - self.tokens).max(0.0) / self.per_second))
    }

    /// Every waiting post, at once, in order: the run ends by `submit`, `dismiss`, `main` returning or a program error.
    pub fn release(&mut self) -> Vec<Vec<u8>> {
        let mut out = Vec::new();
        for w in std::mem::take(&mut self.waiting) {
            self.run(w, &mut out);
        }
        out
    }

    /// A waiting post going out: its bytes, after its step.
    fn run(&mut self, w: Waiting, out: &mut Vec<Vec<u8>>) {
        let (step, bytes) = match w {
            Waiting::Counted(_, bytes) => (None, Some(bytes)),
            Waiting::Behind(step, bytes) => (step, bytes),
        };
        if let (Some(step), Some(gpu)) = (step, self.gpu.as_mut()) {
            match step {
                Step::Batch(ops, bytes) => gpu.batch(&ops, &bytes),
                Step::ShapeError(ops, message) => gpu.shape_error(ops.as_deref(), message),
                Step::EndFrame => gpu.end_frame(),
                Step::Canvases(keys) => gpu.canvases(&keys),
                Step::Resize(key, w, h) => gpu.resize(&key, w, h),
            }
        }
        out.extend(bytes);
    }

    /// A step for the GPU host and the bytes of the post that carries it: at once, or behind what waits. A post
    /// carrying a batch (`batch`) waits while anything does; anything else only while a step waits, to keep its order.
    fn behind(&mut self, step: Option<Step>, bytes: Option<Vec<u8>>, batch: bool) -> Vec<Vec<u8>> {
        let wait = match batch {
            true => !self.waiting.is_empty(),
            false => (self.waiting.iter()).any(|w| matches!(w, Waiting::Behind(Some(_), _))),
        };
        if wait {
            self.waiting.push(Waiting::Behind(step, bytes));
            return Vec::new();
        }
        let mut out = Vec::new();
        self.run(Waiting::Behind(step, bytes), &mut out);
        out
    }

    /// A batch for the GPU host: applied at once with the program's bytes in place, or copied to wait.
    fn batch(&mut self, batch: &HostValue) {
        let wait = !self.waiting.is_empty();
        let gpu = self.gpu.as_mut().filter(|_| !wait);
        let queued = crate::gpu::read(batch, |read| match (gpu, read) {
            (Some(gpu), Ok((ops, bytes))) => {
                gpu.batch(&ops, bytes);
                None
            }
            (Some(gpu), Err((ops, message))) => {
                gpu.shape_error(ops.as_deref(), message);
                None
            }
            (None, Ok((ops, bytes))) => Some(Step::Batch(ops, bytes.to_vec())),
            (None, Err((ops, message))) => Some(Step::ShapeError(ops, message)),
        });
        if let Some(step) = queued {
            self.waiting.push(Waiting::Behind(Some(step), None));
        }
    }

    fn refill(&mut self, now: Instant) {
        let at = *self.at.get_or_insert(now);
        let elapsed = now.saturating_duration_since(at).as_secs_f64();
        self.tokens = (self.tokens + elapsed * self.per_second).min(BURST);
        self.at = Some(now.max(at));
    }

    /// A `render` (`key` `None`) or `draw` under the rate: out at once when nothing waits and a token is there, else
    /// in place of the waiting post of its kind, or last.
    fn counted(&mut self, key: Option<String>, bytes: Vec<u8>, now: Instant) -> Vec<Vec<u8>> {
        self.refill(now);
        if self.waiting.is_empty() && self.tokens >= 1.0 - EPSILON {
            self.tokens -= 1.0;
            return vec![bytes];
        }
        let same = self.waiting.iter_mut().find_map(|w| match w {
            Waiting::Counted(k, b) if *k == key => Some(b),
            _ => None,
        });
        match same {
            Some(b) => *b = bytes,
            None => self.waiting.push(Waiting::Counted(key, bytes)),
        }
        Vec::new()
    }
}

/// A live post (`__host.post(message)`). Fails for an invalid post: a render's view (`InvalidView`), a draw
/// (`InvalidDraw`), a GPU batch, invalid or over a limit (`InvalidGpu`), or an unknown type.
pub fn encode_post(m: &HostValue) -> Result<Vec<u8>, EncodeError> {
    let kind = match field(m, "type").and_then(HostValue::as_str) {
        Some("render") => INVALID_VIEW,
        Some("draw") => INVALID_DRAW,
        Some("gpu") => INVALID_GPU,
        Some("frame") if !matches!(field(m, "gpu"), None | Some(HostValue::Null)) => INVALID_GPU,
        _ => INVALID_DATA,
    };
    post(m).map_err(|e| EncodeError {
        kind,
        message: match e {
            PostError::Post(e) => format!("invalid post: {e}"),
            PostError::Draw(e) => e,
        },
    })
}

const STORAGE_KEY: &str = "a storage post needs a key of 1 to 256 characters";
const STORAGE_VALUE: &str = "a storage post's value must be JSON text of at most 64 KiB";

/// Why a post can't be written: a draw's commands fail their check (its message as it is), or the post is invalid.
enum PostError {
    Post(String),
    Draw(String),
}

impl From<String> for PostError {
    fn from(e: String) -> Self {
        PostError::Post(e)
    }
}

impl From<&str> for PostError {
    fn from(e: &str) -> Self {
        PostError::Post(e.into())
    }
}

fn post(m: &HostValue) -> Result<Vec<u8>, PostError> {
    // A GPU batch keeps its bytes as they are; its ops are written as JSON reads them (`gpu::put_arg`).
    let gpu = match field(m, "type").and_then(HostValue::as_str) {
        Some("gpu") => true,
        Some("frame") => !matches!(field(m, "gpu"), None | Some(HostValue::Null)),
        _ => false,
    };
    let json;
    let m = if gpu {
        m
    } else {
        json = as_json(m);
        &*json
    };
    let Some(ty) = field(m, "type").and_then(HostValue::as_str) else {
        return Err("a post is an object with a type".into());
    };
    let mut out = vec![VERSION];
    match ty {
        "render" => {
            out.push(RENDER);
            let mut s = Streams::default();
            write_node(&mut s, field(m, "node").unwrap_or(&HostValue::Null), 0)?;
            s.finish_into(&mut out);
        }
        "draw" => {
            out.push(DRAW);
            let Some(HostValue::String(id)) = field(m, "id") else {
                return Err("a draw post needs its canvas's id".into());
            };
            put_str(&mut out, &id.to_string_lossy());
            let commands = field(m, "commands").unwrap_or(&HostValue::Undefined);
            draw_section(commands, &mut out).map_err(PostError::Draw)?;
        }
        "frame" => match field(m, "gpu").filter(|g| !matches!(g, HostValue::Null)) {
            Some(batch) => {
                out.push(FRAME_GPU);
                crate::gpu::encode(batch, &mut out)?;
            }
            None => out.push(FRAME),
        },
        "gpu" => {
            out.push(GPU);
            crate::gpu::encode(m, &mut out)?;
        }
        "submit" => {
            out.push(SUBMIT);
            put_str(
                &mut out,
                &json::write(field(m, "value").unwrap_or(&HostValue::Null)),
            );
        }
        "dismiss" => out.push(DISMISS),
        "send" => {
            out.push(SEND);
            out.push(!matches!(field(m, "wake"), Some(HostValue::Bool(false))) as u8);
            put_str(
                &mut out,
                &json::write(field(m, "value").unwrap_or(&HostValue::Null)),
            );
        }
        "capture" => {
            out.push(CAPTURE);
            out.push(matches!(field(m, "value"), Some(HostValue::Bool(true))) as u8);
        }
        // `widget.storage` (`widgets-live.md`, Storage): the prelude checks the limits; these catch a program that
        // posts around it.
        "storage" => {
            out.push(STORAGE);
            let Some(HostValue::String(key)) = field(m, "key") else {
                return Err(STORAGE_KEY.into());
            };
            let key = key.to_string_lossy();
            if key.is_empty() || key.encode_utf16().count() > 256 {
                return Err(STORAGE_KEY.into());
            }
            put_str(&mut out, &key);
            match field(m, "value") {
                None | Some(HostValue::Undefined) => out.push(0),
                Some(HostValue::String(value)) if value.to_string_lossy().len() <= 64 * 1024 => {
                    out.push(1);
                    put_str(&mut out, &value.to_string_lossy());
                }
                Some(_) => return Err(STORAGE_VALUE.into()),
            }
        }
        other => return Err(format!("unknown post type \"{other}\"").into()),
    }
    Ok(out)
}

/// Whether JSON reads `v` as it is: it holds no value of a kind JSON writes as something else (a Date as its ISO
/// string, a URL as its href, a Set as an array, a Map or a typed array as an object).
fn plain(v: &HostValue) -> bool {
    match v {
        HostValue::Undefined
        | HostValue::Null
        | HostValue::Bool(_)
        | HostValue::Number(_)
        | HostValue::String(_)
        | HostValue::FunctionMarker => true,
        HostValue::Array(items) => items.iter().flatten().all(plain),
        HostValue::Object(fields) => fields.iter().all(|(_, v)| plain(v)),
        _ => false,
    }
}

/// `v` as the JSON path writes it (`HostValue::to_json`), so both read the same values.
pub(crate) fn json_value(v: &HostValue) -> Cow<'_, HostValue> {
    as_json(v)
}

fn as_json(v: &HostValue) -> Cow<'_, HostValue> {
    if plain(v) {
        Cow::Borrowed(v)
    } else {
        Cow::Owned(json_view(v))
    }
}

/// Arrays and objects as they are, other values as their JSON.
fn json_view(v: &HostValue) -> HostValue {
    match v {
        HostValue::Array(items) => {
            HostValue::Array(items.iter().map(|i| i.as_ref().map(json_view)).collect())
        }
        HostValue::Object(fields) => HostValue::Object(
            fields
                .iter()
                .map(|(k, v)| (k.clone(), json_view(v)))
                .collect(),
        ),
        HostValue::Undefined
        | HostValue::Null
        | HostValue::Bool(_)
        | HostValue::Number(_)
        | HostValue::String(_)
        | HostValue::FunctionMarker => v.clone(),
        other => other
            .to_json()
            .map_or(HostValue::Undefined, |j| HostValue::from_json(&j)),
    }
}

/// An object's field, absent when `undefined` (as JSON leaves it out).
pub(crate) fn field<'a>(v: &'a HostValue, key: &str) -> Option<&'a HostValue> {
    v.get(key).filter(|v| !matches!(v, HostValue::Undefined))
}

pub(crate) fn varint(out: &mut Vec<u8>, mut v: u64) {
    while v >= 0x80 {
        out.push((v as u8) | 0x80);
        v >>= 7;
    }
    out.push(v as u8);
}

pub(crate) fn put_str(out: &mut Vec<u8>, s: &str) {
    varint(out, s.len() as u64);
    out.extend_from_slice(s.as_bytes());
}

fn lossy(s: &HostString) -> Cow<'_, str> {
    s.to_string_lossy()
}

// ---- steps and views ----

/// `S`, its flags and its JSON: `state`, then `submit` and `send`'s value when present, each as JSON text.
fn step_head(
    out: &mut Vec<u8>,
    state: Option<String>,
    submit: Option<String>,
    dismiss: bool,
    send: Option<(String, bool)>,
) {
    let wake = send.as_ref().is_some_and(|(_, wake)| *wake);
    out.push(STEP);
    out.push(
        submit.is_some() as u8
            | (dismiss as u8) << 1
            | (send.is_some() as u8) << 2
            | (wake as u8) << 3,
    );
    put_str(out, state.as_deref().unwrap_or("null"));
    if let Some(submit) = submit {
        put_str(out, &submit);
    }
    if let Some((value, _)) = send {
        put_str(out, &value);
    }
}

/// Section `N`'s three streams.
#[derive(Default)]
pub(crate) struct Streams {
    ints: Vec<u8>,
    floats: Vec<u8>,
    strs: Vec<u8>,
}

impl Streams {
    pub(crate) fn int(&mut self, v: u32) {
        varint(&mut self.ints, v as u64);
    }
    fn f64(&mut self, v: f64) {
        self.floats.extend_from_slice(&v.to_le_bytes());
    }
    pub(crate) fn str(&mut self, s: &str) {
        put_str(&mut self.strs, s);
    }
    pub(crate) fn tag(&mut self, id: u32, kind: u32) {
        self.int(id << 3 | kind);
    }
    pub(crate) fn finish_into(&self, out: &mut Vec<u8>) {
        out.reserve(31 + self.ints.len() + self.floats.len() + self.strs.len());
        out.push(b'N');
        varint(out, self.ints.len() as u64);
        varint(out, self.floats.len() as u64);
        varint(out, self.strs.len() as u64);
        out.extend_from_slice(&self.ints);
        out.extend_from_slice(&self.floats);
        out.extend_from_slice(&self.strs);
    }
}

fn finite(v: &HostValue) -> Option<f64> {
    match v {
        HostValue::Number(n) if n.is_finite() => Some(*n),
        _ => None,
    }
}

fn strings(items: &[Option<HostValue>]) -> Option<Vec<Cow<'_, str>>> {
    items
        .iter()
        .map(|i| match i {
            Some(HostValue::String(s)) => Some(lossy(s)),
            _ => None,
        })
        .collect()
}

/// A select option's value, label and description.
type SelectOption<'a> = (Cow<'a, str>, Cow<'a, str>, Option<Cow<'a, str>>);

/// A select option's fields, when it has the shape the format writes.
fn option(o: &Option<HostValue>) -> Option<SelectOption<'_>> {
    let o = o.as_ref()?;
    if !matches!(o, HostValue::Object(_)) {
        return None;
    }
    let text = |k: &str| match field(o, k) {
        Some(HostValue::String(s)) => Some(lossy(s)),
        _ => None,
    };
    let description = match field(o, "description") {
        None | Some(HostValue::Null) => None,
        Some(HostValue::String(s)) => Some(lossy(s)),
        Some(_) => return None,
    };
    Some((text("value")?, text("label")?, description))
}

/// One prop, when the format knows its key and its value has a shape the prop takes; otherwise it's left out.
/// A table's `columns` (props 39 and 40), `rows` (41, as many cells per row as there are columns), `sort` (42) and a
/// number `selected` (43) (`widgets-binary.md`), written from the whole node, since a row is as wide as `columns`.
/// `columns` or `rows` that aren't lists of the right things are left out, and the client takes the view as invalid.
pub(crate) fn table_props(s: &mut Streams, v: &HostValue) {
    let Some(HostValue::Array(columns)) = field(v, "columns") else {
        return;
    };
    let Some(labels) = columns
        .iter()
        .map(|c| match c.as_ref().and_then(|c| field(c, "label")) {
            Some(HostValue::String(t)) => Some(lossy(t)),
            _ => None,
        })
        .collect::<Option<Vec<_>>>()
    else {
        return;
    };
    s.tag(39, K_STRS);
    s.int(labels.len() as u32);
    for label in &labels {
        s.str(label);
    }
    s.tag(40, K_F64S);
    s.int(columns.len() as u32);
    for c in columns.iter().flatten() {
        let end =
            matches!(field(c, "align"), Some(HostValue::String(a)) if a.as_str() == Some("end"));
        s.f64(if end { 1.0 } else { 0.0 });
    }
    fn cell(c: Option<&HostValue>) -> Option<Cow<'_, str>> {
        match c {
            None | Some(HostValue::Undefined) => Some(Cow::Borrowed("")),
            Some(HostValue::String(t)) => Some(lossy(t)),
            Some(HostValue::Number(n)) if n.is_finite() => {
                Some(Cow::Owned(crate::native::js_number(*n)))
            }
            _ => None,
        }
    }
    let rows = match field(v, "rows") {
        Some(HostValue::Array(rows)) => rows
            .iter()
            .map(|row| match row {
                Some(HostValue::Array(cells)) if cells.len() <= labels.len() => (0..labels.len())
                    .map(|i| cell(cells.get(i).and_then(Option::as_ref)))
                    .collect::<Option<Vec<_>>>(),
                _ => None,
            })
            .collect::<Option<Vec<_>>>(),
        _ => None,
    };
    if let Some(rows) = rows {
        s.tag(41, K_STRS);
        s.int((rows.len() * labels.len()) as u32);
        for c in rows.iter().flatten() {
            s.str(c);
        }
    }
    if let Some(sort) = field(v, "sort")
        && let Some(column) = field(sort, "column").and_then(finite)
    {
        s.tag(42, K_F64S);
        s.int(2);
        s.f64(column);
        s.f64(
            if matches!(field(sort, "descending"), Some(HostValue::Bool(true))) {
                1.0
            } else {
                0.0
            },
        );
    }
    if let Some(row) = field(v, "selected")
        .and_then(finite)
        .filter(|r| *r >= 0.0 && r.fract() == 0.0)
    {
        s.tag(43, K_INT);
        s.int(row as u32);
    }
}

pub(crate) fn prop(s: &mut Streams, key: &str, v: &HostValue) {
    let id = prop_id(key);
    if id == 0 {
        return;
    }
    match (shape(id), v) {
        (Shape::F64 | Shape::Value | Shape::Inset, HostValue::Number(n)) if n.is_finite() => {
            s.tag(id, K_F64);
            s.f64(*n);
        }
        (Shape::Bool, HostValue::Bool(b)) => {
            s.tag(id, K_INT);
            s.int(*b as u32);
        }
        (Shape::Str | Shape::Value, HostValue::String(t)) => {
            s.tag(id, K_STR);
            s.str(&lossy(t));
        }
        (Shape::Enum(table), HostValue::String(t)) => {
            if let Some(i) = t.as_str().and_then(|t| table.iter().position(|e| *e == t)) {
                s.tag(id, K_INT);
                s.int(i as u32);
            }
        }
        (Shape::Value, HostValue::Array(items)) => {
            if let Some(list) = strings(items) {
                s.tag(id, K_STRS);
                s.int(list.len() as u32);
                for t in list {
                    s.str(&t);
                }
            }
        }
        (Shape::F64s, HostValue::Array(items)) => {
            if let Some(list) = items
                .iter()
                .map(|i| i.as_ref().and_then(finite))
                .collect::<Option<Vec<f64>>>()
            {
                s.tag(id, K_F64S);
                s.int(list.len() as u32);
                for n in list {
                    s.f64(n);
                }
            }
        }
        (Shape::Inset, HostValue::Object(_)) => {
            let side = |k: &str| match field(v, k) {
                None => Some(0.0),
                Some(n) => finite(n),
            };
            if let (Some(t), Some(r), Some(b), Some(l)) =
                (side("top"), side("right"), side("bottom"), side("left"))
            {
                s.tag(id, K_F64S);
                s.int(4);
                for n in [t, r, b, l] {
                    s.f64(n);
                }
            }
        }
        (Shape::Options, HostValue::Array(items)) => {
            if let Some(list) = items.iter().map(option).collect::<Option<Vec<_>>>() {
                s.tag(id, K_OPTS);
                s.int(list.len() as u32);
                for (value, label, description) in list {
                    s.int(description.is_some() as u32);
                    s.str(&value);
                    s.str(&label);
                    if let Some(d) = description {
                        s.str(&d);
                    }
                }
            }
        }
        _ => {}
    }
}

pub(crate) fn too_deep() -> String {
    format!("the view nests deeper than {MAX_DEPTH} levels")
}

/// Children flattened, with `null`, `false`, `undefined` and holes dropped, as clients read them.
fn flat_children<'a>(
    items: &'a [Option<HostValue>],
    out: &mut Vec<&'a HostValue>,
    depth: usize,
) -> Result<(), String> {
    if depth > MAX_DEPTH {
        return Err(too_deep());
    }
    for i in items {
        match i {
            Some(HostValue::Array(nested)) => flat_children(nested, out, depth + 1)?,
            None | Some(HostValue::Null | HostValue::Undefined | HostValue::Bool(false)) => {}
            Some(v) => out.push(v),
        }
    }
    Ok(())
}

pub(crate) fn write_node(s: &mut Streams, v: &HostValue, depth: usize) -> Result<(), String> {
    if depth > MAX_DEPTH {
        return Err(too_deep());
    }
    let HostValue::Object(fields) = v else {
        s.int(T_UNKNOWN);
        s.int(0);
        s.str("");
        return Ok(());
    };
    let name = match field(v, "type") {
        Some(HostValue::String(t)) => lossy(t),
        _ => Cow::Borrowed(""),
    };
    let t = type_id(&name);
    s.int(t);
    if t == T_UNKNOWN {
        s.int(0);
        s.str(&name);
        return Ok(());
    }
    let mut kids: &[Option<HostValue>] = &[];
    // A table's columns and rows first, as the native walk writes them.
    if t == T_TABLE {
        table_props(s, v);
    }
    for (k, v) in fields {
        let Some(k) = k.as_str() else { continue };
        match k {
            "type" => {}
            "children" => {
                if let HostValue::Array(items) = v {
                    kids = items;
                }
            }
            _ => prop(s, k, v),
        }
    }
    s.int(0);
    if is_container(t) {
        let mut list = Vec::new();
        flat_children(kids, &mut list, depth + 1)?;
        s.int(list.len() as u32);
        for c in list {
            write_node(s, c, depth + 1)?;
        }
    }
    Ok(())
}

// ---- draw commands ----

/// Section `D`'s streams.
#[derive(Default)]
struct DrawStreams {
    ints: Vec<u8>,
    floats: Vec<u8>,
    strs: Vec<u8>,
    commands: u32,
}

impl DrawStreams {
    fn i(&mut self, v: u32) {
        self.ints.extend_from_slice(&v.to_le_bytes());
    }
    fn f(&mut self, v: f32) {
        self.floats.extend_from_slice(&v.to_le_bytes());
    }
    fn s(&mut self, t: &str) {
        put_str(&mut self.strs, t);
    }
    fn finish_into(&self, out: &mut Vec<u8>) -> Result<(), String> {
        let count = |n: usize| u32::try_from(n).map_err(|_| "the drawing is too large".to_owned());
        out.reserve(17 + self.ints.len() + self.floats.len() + self.strs.len());
        out.push(b'D');
        for n in [
            self.commands,
            count(self.ints.len() / 4)?,
            count(self.floats.len() / 4)?,
            count(self.strs.len())?,
        ] {
            out.extend_from_slice(&n.to_le_bytes());
        }
        out.extend_from_slice(&self.ints);
        out.extend_from_slice(&self.floats);
        out.extend_from_slice(&self.strs);
        Ok(())
    }
}

/// A command list as section `D`: the normalised commands, or the failure (`widgets.md`, Draw command checks).
pub(crate) fn draw_section(commands: &HostValue, out: &mut Vec<u8>) -> Result<(), String> {
    let HostValue::Array(list) = commands else {
        return Err("draw commands must be a list".into());
    };
    if list.len() > MAX_COMMANDS {
        return Err(format!(
            "{} draw commands is over the budget of {MAX_COMMANDS} per frame",
            list.len()
        ));
    }
    let mut d = DrawStreams::default();
    for (i, c) in list.iter().enumerate() {
        command(&mut d, c).map_err(|e| format!("draw command {i}: {e}"))?;
    }
    d.finish_into(out)
}

/// An array item as it crossed: `undefined` for a hole.
fn item(v: &Option<HostValue>) -> &HostValue {
    v.as_ref().unwrap_or(&HostValue::Undefined)
}

fn num(v: &HostValue, what: &str) -> Result<f32, String> {
    match v {
        HostValue::Number(n) if n.is_finite() => Ok(*n as f32),
        _ => Err(format!("{what} must be a finite number")),
    }
}

fn color(v: &HostValue) -> Result<Color, String> {
    match v {
        HostValue::String(s) => Color::parse(&lossy(s)),
        _ => None,
    }
    .ok_or_else(|| "not a color".to_owned())
}

/// One of `table`'s strings, else `message`.
fn one_of<T: Copy>(v: &HostValue, table: &[(&str, T)], message: &str) -> Result<T, String> {
    let s = v.as_str();
    table
        .iter()
        .find(|(name, _)| Some(*name) == s)
        .map(|(_, t)| *t)
        .ok_or_else(|| message.to_owned())
}

fn gradient(m: &HostValue) -> Result<Gradient, String> {
    let coords = |key: &str, n: usize| -> Result<Option<Vec<f32>>, String> {
        let Some(a) = field(m, key) else {
            return Ok(None);
        };
        match a {
            HostValue::Array(a) if a.len() == n => a
                .iter()
                .map(|x| num(item(x), key))
                .collect::<Result<Vec<_>, _>>()
                .map(Some),
            _ => Err(format!("a {key} gradient takes {n} numbers")),
        }
    };
    let shape = match (coords("linear", 4)?, coords("radial", 3)?) {
        (Some(c), _) => GradientShape::Linear([c[0], c[1], c[2], c[3]]),
        (None, Some(c)) => GradientShape::Radial([c[0], c[1], c[2]]),
        (None, None) => return Err("a gradient needs linear or radial".into()),
    };
    let Some(HostValue::Array(stops)) = field(m, "stops") else {
        return Err("a gradient needs stops".into());
    };
    let stops = stops
        .iter()
        .map(|s| match item(s) {
            HostValue::Array(p) if p.len() == 2 => Ok((
                num(item(&p[0]), "a stop's offset")?.clamp(0.0, 1.0),
                color(item(&p[1]))?,
            )),
            _ => Err("a stop is [offset, color]".to_owned()),
        })
        .collect::<Result<Vec<_>, String>>()?;
    Ok(Gradient { shape, stops })
}

/// A paint's fields in their order; absent or `undefined` ones take their defaults, `null` is a wrong value.
fn paint(m: &HostValue) -> Result<Paint, String> {
    if !matches!(m, HostValue::Object(_)) {
        return Err("a paint is an object".into());
    }
    let fill = match field(m, "fill") {
        None => None,
        Some(g @ HostValue::Object(_)) => Some(Fill::Gradient(gradient(g)?)),
        Some(c) => Some(Fill::Color(color(c)?)),
    };
    let stroke = field(m, "stroke").map(color).transpose()?;
    let width = match field(m, "width") {
        None => 1.0,
        Some(w) => num(w, "a stroke's width")?.max(0.0),
    };
    let cap = match field(m, "cap") {
        None => Cap::Butt,
        Some(c) => one_of(
            c,
            &[("butt", Cap::Butt), ("round", Cap::Round)],
            "a stroke's cap must be \"butt\" or \"round\"",
        )?,
    };
    Ok(Paint {
        fill,
        stroke,
        width,
        cap,
    })
}

/// A text's style: left off, `undefined` or `null` is `{}`; its fields in their order, as a paint's.
fn text_options(v: &HostValue) -> Result<TextOptions, String> {
    let m = match v {
        HostValue::Undefined | HostValue::Null => &HostValue::Null,
        m @ HostValue::Object(_) => m,
        _ => return Err("a text style is an object".into()),
    };
    let g = |k: &str| field(m, k);
    Ok(TextOptions {
        size: match g("size") {
            None => 13.0,
            Some(n) => num(n, "a text size")?.clamp(1.0, 512.0),
        },
        weight: match g("weight") {
            None => 400,
            Some(HostValue::Number(w)) if [400.0, 500.0, 600.0, 700.0].contains(w) => *w as u16,
            Some(_) => return Err("a text weight must be 400, 500, 600 or 700".into()),
        },
        align: match g("align") {
            None => TextAlign::Left,
            Some(a) => one_of(
                a,
                &[
                    ("left", TextAlign::Left),
                    ("center", TextAlign::Center),
                    ("right", TextAlign::Right),
                ],
                "a text align must be \"left\", \"center\" or \"right\"",
            )?,
        },
        color: g("color").map(color).transpose()?,
        mono: match g("mono") {
            None => false,
            Some(HostValue::Bool(b)) => *b,
            Some(_) => return Err("a text mono must be true or false".into()),
        },
    })
}

fn token_id(t: Token) -> u32 {
    match t {
        Token::Text => 1,
        Token::Muted => 2,
        Token::Accent => 3,
        Token::Bg => 4,
        Token::Surface => 5,
        Token::Border => 6,
        Token::Success => 7,
        Token::Warning => 8,
        Token::Error => 9,
    }
}

fn put_color(d: &mut DrawStreams, c: Color) {
    match c {
        Color::Rgba(rgba) => {
            d.i(0);
            d.i(u32::from_be_bytes(rgba));
        }
        Color::Token(t) => {
            d.i(token_id(t));
            d.i(0);
        }
    }
}

fn put_paint(d: &mut DrawStreams, p: &Paint) {
    match &p.fill {
        None => d.i(0),
        Some(Fill::Color(c)) => {
            d.i(1);
            put_color(d, *c);
        }
        Some(Fill::Gradient(g)) => {
            match g.shape {
                GradientShape::Linear(c) => {
                    d.i(2);
                    d.i(g.stops.len() as u32);
                    c.iter().for_each(|v| d.f(*v));
                }
                GradientShape::Radial(c) => {
                    d.i(3);
                    d.i(g.stops.len() as u32);
                    c.iter().for_each(|v| d.f(*v));
                }
            }
            for (o, c) in &g.stops {
                d.f(*o);
                put_color(d, *c);
            }
        }
    }
    match p.stroke {
        None => d.i(0),
        Some(c) => {
            d.i(1);
            put_color(d, c);
        }
    }
    d.i((p.cap == Cap::Round) as u32);
    d.f(p.width);
}

/// One command, checked in the spec's order (`widgets.md`, Draw command checks): its name, its length, then its
/// arguments first to last.
fn command(d: &mut DrawStreams, v: &Option<HostValue>) -> Result<(), String> {
    let HostValue::Array(a) = item(v) else {
        return Err("a command is an array".into());
    };
    let op = match a.first().map(item) {
        Some(HostValue::String(s)) => lossy(s),
        _ => return Err("a command starts with its name".into()),
    };
    let op = &*op;
    // Its code, its number of arguments, and how many of them may be left off.
    let (code, count, optional) = match op {
        "save" => (1, 0, 0),
        "restore" => (2, 0, 0),
        "translate" => (3, 2, 0),
        "rotate" => (4, 1, 0),
        "scale" => (5, 2, 0),
        "alpha" => (6, 1, 0),
        "rect" => (7, 5, 0),
        "rrect" => (8, 6, 0),
        "circle" => (9, 4, 0),
        "line" => (10, 5, 0),
        "path" => (11, 2, 0),
        "text" => (12, 4, 1),
        "image" => (13, 5, 0),
        _ => return Err(format!("unknown draw command \"{op}\"")),
    };
    if a.len() > count + 1 {
        return Err(format!("\"{op}\" has more than {count} arguments"));
    }
    if a.len() < count + 1 - optional {
        return Err(format!("\"{op}\" is missing argument {}", a.len()));
    }
    let arg = |i: usize| a.get(i).map_or(&HostValue::Undefined, item);
    // The message only when it fails: this runs for every number of every command.
    let n = |i: usize| match arg(i) {
        HostValue::Number(v) if v.is_finite() => Ok(*v as f32),
        _ => Err(format!("\"{op}\" argument {i} must be a finite number")),
    };
    match code {
        1 | 2 => d.i(code),
        3..=6 => {
            let first = n(1)?;
            let second = if count == 2 { Some(n(2)?) } else { None };
            d.i(code);
            d.f(if code == 6 {
                first.clamp(0.0, 1.0)
            } else {
                first
            });
            second.into_iter().for_each(|v| d.f(v));
        }
        7..=10 => {
            let coords = (1..count).map(n).collect::<Result<Vec<_>, _>>()?;
            let paint = paint(arg(count))?;
            d.i(code);
            coords.into_iter().for_each(|c| d.f(c));
            put_paint(d, &paint);
        }
        11 => {
            let HostValue::Array(segments) = arg(1) else {
                return Err("\"path\" takes a list of segments".into());
            };
            let mut verbs = Vec::with_capacity(segments.len());
            let mut coords = Vec::with_capacity(segments.len() * 2);
            for s in segments {
                let HostValue::Array(s) = item(s) else {
                    return Err("a path segment is an array".into());
                };
                let (verb, name, count) = match s.first().map(item).and_then(HostValue::as_str) {
                    Some("M") => (1, "M", 2),
                    Some("L") => (2, "L", 2),
                    Some("Q") => (3, "Q", 4),
                    Some("C") => (4, "C", 6),
                    Some("Z") => (5, "Z", 0),
                    _ => return Err("unknown path segment".into()),
                };
                if s.len() != count + 1 {
                    return Err(format!(
                        "a \"{name}\" path segment takes {count} coordinates"
                    ));
                }
                verbs.push(verb);
                for c in &s[1..] {
                    coords.push(num(item(c), "a path coordinate")?);
                }
            }
            let paint = paint(arg(2))?;
            d.i(code);
            d.i(verbs.len() as u32);
            verbs.into_iter().for_each(|v| d.i(v));
            coords.into_iter().for_each(|c| d.f(c));
            put_paint(d, &paint);
        }
        12 => {
            let (x, y) = (n(1)?, n(2)?);
            let HostValue::String(text) = arg(3) else {
                return Err("\"text\" argument 3 must be a string".into());
            };
            let style = text_options(arg(4))?;
            d.i(code);
            d.f(x);
            d.f(y);
            d.s(&lossy(text));
            d.i(style.weight as u32);
            d.i(match style.align {
                TextAlign::Left => 0,
                TextAlign::Center => 1,
                TextAlign::Right => 2,
            });
            match style.color {
                None => d.i(0),
                Some(c) => {
                    d.i(1);
                    put_color(d, c);
                }
            }
            d.i(style.mono as u32);
            d.f(style.size);
        }
        _ => {
            let HostValue::String(src) = arg(1) else {
                return Err("\"image\" takes a src".into());
            };
            let coords = (2..=5).map(n).collect::<Result<Vec<_>, _>>()?;
            d.i(code);
            d.s(&lossy(src));
            coords.into_iter().for_each(|c| d.f(c));
        }
    }
    d.commands += 1;
    Ok(())
}
