//! The widget encoder (`ValueEncoder` for OpenCode widgets' binary format, `widget-wire`): what a native host of
//! widget protocol 2 hands psychoscript-mobile for steps and live runs, with the run's GPU (psychoscript-mobile's
//! `LiveGpu`) for its GPU canvases.

use std::sync::Arc;
use std::time::Instant;

use psychoscript::{Data, HostError};
#[cfg(feature = "gpu")]
use psychoscript_mobile::gpu::LiveGpu;
use psychoscript_mobile::{
    EncodePosts, EncodeStep, EncodeValues, Failure, HostValue, LiveContext, LiveSurfaces, Reject,
    ValueEncoder,
};

fn failure(e: widget_wire::EncodeError) -> Failure {
    Failure::new(e.kind, e.message)
}

fn reject(e: widget_wire::CallError) -> Reject {
    match e {
        widget_wire::CallError::Invalid(e) => Reject::Failure(failure(e)),
        widget_wire::CallError::Function { arg } => Reject::Function { arg },
        widget_wire::CallError::Uri => {
            Reject::Throw(HostError::located("URIError", "URI malformed"))
        }
        widget_wire::CallError::Throw(m) => {
            Reject::Throw(HostValue::Error(Box::new(HostError::new(m))))
        }
        widget_wire::CallError::View(m) => Reject::End(Failure::new(widget_wire::INVALID_VIEW, m)),
        widget_wire::CallError::End(e) => Reject::End(failure(e)),
    }
}

struct Widget;

impl EncodeValues for Widget {
    fn check(&self, first_line: &str) -> Result<(), Failure> {
        match widget_wire::protocol(first_line) {
            widget_wire::PROTOCOL => Ok(()),
            p if p < widget_wire::PROTOCOL => {
                Err(Failure::new("OlderProtocol", widget_wire::OLDER))
            }
            _ => Err(Failure::new("NewerProtocol", widget_wire::NEWER)),
        }
    }
    fn emit_name(&self) -> &str {
        widget_wire::EMIT
    }
    fn max_value_depth(&self) -> Option<usize> {
        Some(widget_wire::MAX_VALUE_DEPTH)
    }
    fn step(&self, input: &HostValue) -> Box<dyn EncodeStep> {
        let draw = input.get("phase").and_then(HostValue::as_str) == Some("draw");
        Box::new(Step(widget_wire::NativeStep::new(draw)))
    }
    fn live(&self, ctx: LiveContext) -> Box<dyn EncodePosts> {
        #[cfg_attr(not(any(feature = "gpu", feature = "test-hooks")), allow(unused_mut))]
        let mut posts = widget_wire::LivePosts::new();
        #[cfg(feature = "test-hooks")]
        if crate::hooks::RECORD.load(std::sync::atomic::Ordering::SeqCst) {
            posts.record_batches();
        }
        #[cfg(feature = "gpu")]
        let gpu = {
            let gpu = LiveGpu::new(ctx);
            posts.set_gpu(Box::new(Gpu(gpu.clone())));
            gpu
        };
        #[cfg(not(feature = "gpu"))]
        let _ = ctx;
        Box::new(WidgetLive {
            posts,
            #[cfg(feature = "gpu")]
            gpu,
        })
    }
}

/// A widget run's posts ([`widget_wire::LivePosts`]) and, with feature `gpu`, its GPU.
struct WidgetLive {
    posts: widget_wire::LivePosts,
    #[cfg(feature = "gpu")]
    gpu: Arc<LiveGpu>,
}

/// What the run's posts hand its GPU, in the order the program posted it.
#[cfg(feature = "gpu")]
struct Gpu(Arc<LiveGpu>);

#[cfg(feature = "gpu")]
impl widget_wire::GpuHost for Gpu {
    fn batch(&mut self, ops: &[widget_wire::Arg], bytes: &[u8]) {
        self.0.batch(ops, bytes);
    }

    fn shape_error(&mut self, ops: Option<&[widget_wire::Arg]>, message: String) {
        self.0.shape_error(ops, message);
    }

    fn end_frame(&mut self) {
        self.0.end_frame();
    }

    fn canvases(&mut self, keys: &[String]) {
        self.0.canvases(keys);
    }

    fn resize(&mut self, key: &str, width: u32, height: u32) {
        self.0.resize(key, width, height);
    }
}

/// One step's emitted view or draw commands ([`widget_wire::NativeStep`]).
struct Step(widget_wire::NativeStep);

impl EncodeStep for Step {
    fn emit(&mut self, args: &[HostValue]) -> Result<(), Reject> {
        self.0.emit(args).map_err(reject)
    }
    fn failure(&self) -> Option<Failure> {
        (self.0.failure()).map(|m| Failure::new(widget_wire::INVALID_VIEW, m))
    }
    fn finish(&self, result: &Data) -> Result<Vec<u8>, Failure> {
        self.0.finish(result).map_err(failure)
    }
}

impl EncodePosts for WidgetLive {
    fn post(
        &mut self,
        message: &HostValue,
        now: Instant,
    ) -> Result<(Vec<Vec<u8>>, HostValue), Reject> {
        let (bytes, handled) = self.posts.post(message, now).map_err(reject)?;
        Ok((bytes, handled.map_or(HostValue::Undefined, HostValue::Bool)))
    }
    fn due(&mut self, now: Instant) -> Vec<Vec<u8>> {
        #[cfg(feature = "gpu")]
        self.gpu.due();
        self.posts.due(now)
    }
    fn next_due(&self) -> Option<Instant> {
        self.posts.next_due()
    }
    fn release(&mut self) -> Vec<Vec<u8>> {
        let released = self.posts.release();
        #[cfg(feature = "gpu")]
        self.gpu.finish();
        released
    }
    fn delivered(&mut self, message: &HostValue) {
        self.posts.delivered(message)
    }
    fn received(&mut self, message: &HostValue) -> Vec<Vec<u8>> {
        self.posts.received(message)
    }
    /// `{ data, gpu: { available, format } }` (`widgets-gpu.md`).
    fn input(&mut self, input: HostValue) -> HostValue {
        #[cfg(feature = "gpu")]
        if let HostValue::Object(mut fields) = input {
            fields.retain(|(k, _)| k != "gpu");
            fields.push(("gpu".into(), self.gpu.input()));
            return HostValue::Object(fields);
        }
        input
    }
    fn surfaces(&self) -> Option<Arc<dyn LiveSurfaces>> {
        #[cfg(feature = "gpu")]
        return Some(self.gpu.clone());
        #[cfg(not(feature = "gpu"))]
        None
    }
    fn ended(&mut self) {
        #[cfg(feature = "gpu")]
        self.gpu.ended();
    }
    #[cfg(feature = "test-hooks")]
    fn recorded(&self) -> Vec<String> {
        self.posts
            .recorded()
            .iter()
            .map(|v| v.to_string())
            .collect()
    }
    /// `{ canvases: [[key, id, wgsl, gpu], ...], gpu: <the program's last GPU handle>, stops: { all: [kind,
    /// message] | null, canvases: [[key, kind, message], ...] } }` (the canvases errors stopped).
    fn save(&self) -> Data {
        let canvases = Data::Array(
            self.posts
                .last_render()
                .canvases
                .iter()
                .map(|c| {
                    Data::Array(vec![
                        Data::String(c.key.as_str().into()),
                        Data::String(c.id.as_str().into()),
                        Data::Bool(c.wgsl),
                        Data::Bool(c.gpu),
                    ])
                })
                .collect(),
        );
        #[cfg(feature = "gpu")]
        let (last, stops) = {
            let (last, stops) = self.gpu.saved();
            (last, save_stops(&stops))
        };
        #[cfg(not(feature = "gpu"))]
        let (last, stops) = (0, Data::Null);
        Data::Object(vec![
            ("canvases".into(), canvases),
            ("gpu".into(), Data::Number(last.into())),
            ("stops".into(), stops),
        ])
    }
    fn load(&mut self, saved: &Data) {
        // Snapshots from before GPU canvases are the canvases alone.
        let (list, last) = match saved {
            Data::Array(list) => (list, 0),
            Data::Object(_) => match (saved.get("canvases"), saved.get("gpu")) {
                (Some(Data::Array(list)), Some(Data::Number(n))) => (list, n.as_u64().unwrap_or(0)),
                _ => return,
            },
            _ => return,
        };
        let text = |d: &Data| d.as_string().map(|s| s.to_string_lossy().into_owned());
        let canvases: Vec<widget_wire::Canvas> = list
            .iter()
            .filter_map(|c| match c {
                Data::Array(f) if f.len() == 3 || f.len() == 4 => Some(widget_wire::Canvas {
                    key: text(&f[0])?,
                    id: text(&f[1])?,
                    wgsl: matches!(f[2], Data::Bool(true)),
                    gpu: matches!(f.get(3), Some(Data::Bool(true))),
                }),
                _ => None,
            })
            .collect();
        #[cfg(feature = "gpu")]
        self.gpu.restored(
            last,
            canvases
                .iter()
                .filter(|c| c.gpu)
                .map(|c| c.key.clone())
                .collect(),
            saved.get("stops").map(load_stops).unwrap_or_default(),
        );
        #[cfg(not(feature = "gpu"))]
        let _ = last;
        self.posts.restore_canvases(canvases);
    }
}

#[cfg(feature = "gpu")]
fn save_stops(stops: &psychoscript_gpu::SavedStops) -> Data {
    let stop = |s: &psychoscript_gpu::SavedStop| {
        let kind = match s.kind {
            psychoscript_gpu::ErrorKind::Program => "program",
            psychoscript_gpu::ErrorKind::Client => "client",
        };
        vec![
            Data::String(kind.into()),
            Data::String(s.message.as_str().into()),
        ]
    };
    Data::Object(vec![
        (
            "all".into(),
            stops
                .all
                .as_ref()
                .map_or(Data::Null, |s| Data::Array(stop(s))),
        ),
        (
            "canvases".into(),
            Data::Array(
                stops
                    .canvases
                    .iter()
                    .map(|(k, s)| {
                        let mut f = vec![Data::String(k.as_str().into())];
                        f.extend(stop(s));
                        Data::Array(f)
                    })
                    .collect(),
            ),
        ),
    ])
}

#[cfg(feature = "gpu")]
fn load_stops(d: &Data) -> psychoscript_gpu::SavedStops {
    let text = |d: &Data| d.as_string().map(|s| s.to_string_lossy().into_owned());
    let stop = |kind: &Data, message: &Data| {
        Some(psychoscript_gpu::SavedStop {
            kind: match text(kind)?.as_str() {
                "client" => psychoscript_gpu::ErrorKind::Client,
                _ => psychoscript_gpu::ErrorKind::Program,
            },
            message: text(message)?,
        })
    };
    let all = match d.get("all") {
        Some(Data::Array(f)) if f.len() == 2 => stop(&f[0], &f[1]),
        _ => None,
    };
    let canvases = match d.get("canvases") {
        Some(Data::Array(list)) => list
            .iter()
            .filter_map(|c| match c {
                Data::Array(f) if f.len() == 3 => Some((text(&f[0])?, stop(&f[1], &f[2])?)),
                _ => None,
            })
            .collect(),
        _ => Vec::new(),
    };
    psychoscript_gpu::SavedStops { all, canvases }
}

/// OpenCode widgets' binary format (`widget-wire`, opencode `specs/v2/widgets-binary.md`) for a native host of widget
/// protocol 2 (`widgets.md`, Native hosts): steps run `<program>\nreturn __widget_native_step(__input())` with
/// `run_bytes`, live runs `<program>\nreturn await __widget_live(__input(), true)`. A program of another protocol isn't
/// run: `Runtime` of kind `OlderProtocol` (a program error) or `NewerProtocol` (a client error). A value it can't write
/// fails with `Runtime` of kind `InvalidView`, `InvalidDraw` or `InvalidGpu` (the spec's phase `view`, `draw` or
/// `gpu`), else `InvalidDataValue`, at the call's line and column when the call threw it.
#[uniffi::export]
pub fn widget_encoder() -> Arc<ValueEncoder> {
    ValueEncoder::new(Widget)
}
