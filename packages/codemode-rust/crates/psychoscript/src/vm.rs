//! The stack machine: frames, calls, exceptions, suspension and the run loop.

use std::collections::VecDeque;
use std::rc::Rc;
use std::time::Instant;

use rustc_hash::FxHashMap;

use crate::bytecode::{Arith, Capture, FuncProto, Op, Program, TemplateSite};
use crate::compiler::{DELEGATE_ASYNC, DELEGATE_NO_ARG};
use crate::object::*;
use crate::strings::{StrId, Strings};
use crate::value::{Id, Slot, Value};
use crate::{DiagnosticKind, Limits, ToolCall};

pub type Res = Result<Value, Value>;
/// A host call's result as it waits to settle its promise.
pub type ToolOutcome = crate::host::Settlement;
pub type NativeFn = fn(&mut Vm, Value, &[Value], Id) -> Res;

pub const MAX_DEPTH: usize = 10_000;
const MAX_OBJECTS: usize = 2_000_000;
const MAX_STRINGS: usize = 4_000_000;
const MAX_NATIVE_DEPTH: usize = 400;
const FUEL: u32 = 20_000;

#[derive(Clone, Copy)]
pub struct Handler {
    pub(crate) pc: u32,
    pub(crate) sp: u32,
}

#[derive(Clone, Copy, PartialEq)]
pub enum FrameKind {
    Normal,
    Async(u32),
    Generator(Id, Resume),
}

/// How a generator resumed from bytecode hands its yields and its completion back to the frame below it. A
/// generator resumed from native code (`is_base`) returns an `Exit` from `run` instead.
#[derive(Clone, Copy, PartialEq)]
pub enum Resume {
    /// To the iteration instruction the resumer stopped at: `IterNext` or `IterStep`.
    Iter,
    /// To a `DelegateCall`: the value, skipping the `DelegateResult` after it unless done.
    Delegate,
    /// Appends each yielded value to this array and keeps running, for spread and rest elements.
    Collect(Id),
    /// As an iterator result object, for a direct `next()` call.
    Result,
}

pub struct Frame {
    pub func: Rc<FuncProto>,
    pub pc: usize,
    pub base: usize,
    pub upvals: Rc<[u32]>,
    /// Where this frame's exception handlers start in `Vm::handlers`.
    pub hbase: u32,
    /// Arguments beyond the declared parameters, kept for rest parameters and `arguments`.
    pub extra: Box<[Value]>,
    pub argc: u32,
    pub kind: FrameKind,
    pub is_base: bool,
    /// Where a generator's frame last yielded, or `NO_YIELD` before its first `yield`.
    pub yield_pc: u32,
}

pub const NO_YIELD: u32 = u32::MAX;

/// Generator request kinds, as `DelegateCall` and async generator queues number them.
pub const REQ_NEXT: u8 = 0;
pub const REQ_THROW: u8 = 1;
pub const REQ_RETURN: u8 = 2;

/// A suspended frame and its stack segment. The box is kept while the frame runs, so suspending again allocates
/// nothing.
pub struct SavedFrame {
    pub frame: Option<Box<Frame>>,
    pub stack: Vec<Slot>,
    pub handlers: Vec<Handler>,
    pub started: bool,
}

/// How `run` left its base frame. The value is packed: returning a two-word `Value` through memory stalls the
/// reload on store forwarding, measurably on short callbacks.
pub enum Exit {
    Return(Slot),
    Yield(Slot),
    /// A suspend stopped the run at a loop back-edge; its frames stay on the job stack, so it can be saved there and
    /// continued later.
    Suspend,
}

pub struct Coroutine {
    pub saved: Option<Box<SavedFrame>>,
    pub promise: Option<Id>,
}

pub enum Reaction {
    Then {
        on_ful: Value,
        on_rej: Value,
        derived: Id,
    },
    Await(u32),
    /// Settle the target the same way, if it is still pending.
    Resolve(Id),
    Comb {
        comb: Id,
        index: u32,
    },
    Finally {
        cleanup: Value,
        derived: Id,
    },
    Restore {
        derived: Id,
        outcome: Result<Value, Value>,
    },
    Program,
    /// Resume the async generator suspended at an `await`.
    AwaitGen(Id),
    /// Answer an async generator's `return` request with how its value settled.
    GenReturn(Id),
    /// An async-from-sync step: answer `made` with an iterator result of the value; on a rejection, close `close`.
    FromSync {
        made: Id,
        done: bool,
        close: Option<Id>,
    },
}

pub enum Job {
    Reaction(Reaction, Result<Value, Value>),
    Thenable {
        promise: Id,
        thenable: Value,
        then: Value,
    },
}

pub struct Names {
    pub length: Atom,
    pub name: Atom,
    pub prototype: Atom,
    pub constructor: Atom,
    pub message: Atom,
    pub next: Atom,
    pub done: Atom,
    pub value: Atom,
    pub then: Atom,
    pub to_string: Atom,
    pub value_of: Atom,
    pub to_json: Atom,
    pub size: Atom,
    pub return_: Atom,
    pub cause: Atom,
    pub status: Atom,
    pub reason: Atom,
    pub errors: Atom,
}

#[derive(Default)]
pub struct Realm {
    pub object_proto: Id,
    pub function_proto: Id,
    pub array_proto: Id,
    pub string_proto: Id,
    pub number_proto: Id,
    pub boolean_proto: Id,
    pub symbol_proto: Id,
    pub error_proto: Id,
    pub type_error_proto: Id,
    pub range_error_proto: Id,
    pub syntax_error_proto: Id,
    pub reference_error_proto: Id,
    pub aggregate_error_proto: Id,
    pub promise_proto: Id,
    pub promise_then: Id,
    pub map_proto: Id,
    pub set_proto: Id,
    pub generator_proto: Id,
    pub async_generator_proto: Id,
    /// What generator, async and async generator functions inherit from, below `Function.prototype`.
    pub generator_function_proto: Id,
    pub async_function_proto: Id,
    pub async_generator_function_proto: Id,
    pub async_from_sync_proto: Id,
    /// The built-in `next` of generators, which calls from bytecode resume without a nested run.
    pub generator_next: Id,
    pub iter_proto: Id,
    pub tools: Id,
    pub std: crate::builtins::StdProtos,
}

pub struct Vm<'rt> {
    pub heap: Vec<Obj>,
    pub cells: Vec<Slot>,
    pub atoms: Strings,
    pub stack: Vec<Slot>,
    /// Boxed, so suspending and resuming a generator moves a pointer rather than the frame; measured faster for
    /// calls too, since pushing a recycled frame copies one word.
    #[allow(clippy::vec_box)]
    pub frames: Vec<Box<Frame>>,
    #[allow(clippy::vec_box)]
    spare_frames: Vec<Box<Frame>>,
    /// The exception handlers of all frames, innermost last.
    handlers: Vec<Handler>,
    pub realm: Realm,
    pub names: Names,
    pub globals: Vec<Value>,
    pub global_names: Vec<Atom>,
    pub global_map: FxHashMap<Atom, Value>,
    pub consts: Vec<Value>,
    templates: Vec<TemplateSite>,
    /// Each tagged template site's strings array, once made.
    template_objs: Vec<Option<Id>>,
    pub protos: Vec<Rc<FuncProto>>,
    pub jobs: VecDeque<Job>,
    pub inbox: VecDeque<(Id, ToolOutcome)>,
    pub coroutines: Vec<Coroutine>,
    pub logs: Vec<String>,
    pub tool_calls: Vec<ToolCall>,
    pub host: crate::host::RunHost<'rt>,
    pub tool_refs: FxHashMap<Rc<str>, Id>,
    pub limits: Limits,
    pub start: Instant,
    fuel: u32,
    pub fatal: Option<(DiagnosticKind, String)>,
    pub outcome: Option<Result<Value, Value>>,
    native_depth: usize,
    /// Address near the bottom of the native stack this run started on, and how much of it calls may use.
    pub stack_base: usize,
    pub stack_budget: usize,
    arg_pool: Vec<Vec<Value>>,
    pub char_strs: Vec<StrId>,
    pub rng: u64,
    /// A suspend (or a round trip) asks the run to stop at its next safe point.
    pub suspend_wanted: bool,
    /// The run stopped for a suspend: at a job boundary, or with frames on the job stack.
    pub suspended: bool,
    /// For the round-trip test mode: back-edges between checkpoints, 0 when off.
    pub roundtrip_every: u32,
    run_depth: u32,
    /// Set by a driver entry point before it runs bytecode that may stop at a back-edge and continue from its
    /// frames later: the program's body, a resumed `await`.
    pub resumable_run: bool,
    /// What a fresh runtime makes before the program runs, which a snapshot saves only the changes to.
    pub snapshot_base: crate::snapshot::Base,
    /// Restored from a snapshot: the program's body already started.
    pub resumed: bool,
}

impl<'rt> Vm<'rt> {
    pub fn new(host: crate::host::RunHost<'rt>, limits: Limits, atoms: Strings) -> Self {
        let mut atoms = atoms;
        let names = Names {
            length: atoms.intern_static("length"),
            name: atoms.intern_static("name"),
            prototype: atoms.intern_static("prototype"),
            constructor: atoms.intern_static("constructor"),
            message: atoms.intern_static("message"),
            next: atoms.intern_static("next"),
            done: atoms.intern_static("done"),
            value: atoms.intern_static("value"),
            then: atoms.intern_static("then"),
            to_string: atoms.intern_static("toString"),
            value_of: atoms.intern_static("valueOf"),
            to_json: atoms.intern_static("toJSON"),
            size: atoms.intern_static("size"),
            return_: atoms.intern_static("return"),
            cause: atoms.intern_static("cause"),
            status: atoms.intern_static("status"),
            reason: atoms.intern_static("reason"),
            errors: atoms.intern_static("errors"),
        };
        let char_strs = (0u8..128)
            .map(|c| atoms.alloc((c as char).to_string()))
            .collect();
        let seed = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos() as u64)
            .unwrap_or(0x9e3779b97f4a7c15);
        Vm {
            heap: Vec::with_capacity(1024),
            cells: Vec::new(),
            atoms,
            stack: Vec::with_capacity(1024),
            frames: Vec::with_capacity(64),
            spare_frames: Vec::new(),
            handlers: Vec::new(),
            realm: Realm::default(),
            names,
            globals: Vec::new(),
            global_names: Vec::new(),
            global_map: FxHashMap::default(),
            consts: Vec::new(),
            templates: Vec::new(),
            template_objs: Vec::new(),
            protos: Vec::new(),
            jobs: VecDeque::new(),
            inbox: VecDeque::new(),
            coroutines: Vec::new(),
            logs: Vec::new(),
            tool_calls: Vec::new(),
            host,
            tool_refs: FxHashMap::default(),
            limits,
            start: Instant::now(),
            fuel: FUEL,
            fatal: None,
            outcome: None,
            native_depth: 0,
            stack_base: 0,
            stack_budget: usize::MAX,
            arg_pool: Vec::new(),
            char_strs,
            rng: seed | 1,
            suspend_wanted: false,
            suspended: false,
            roundtrip_every: 0,
            run_depth: 0,
            resumable_run: false,
            snapshot_base: crate::snapshot::Base::default(),
            resumed: false,
        }
    }

    pub fn load(&mut self, program: Program) {
        crate::builtins::ensure_globals(self, &program.globals);
        self.template_objs = vec![None; program.templates.len()];
        self.templates = program.templates;
        self.consts = program.consts;
        self.protos = program.protos;
        self.globals = program
            .globals
            .iter()
            .map(|a| self.global_map.get(a).cloned().unwrap_or(Value::Uninit))
            .collect();
        self.global_names = program.globals;
        let (gp, next) = (self.realm.generator_proto, self.names.next);
        if let Value::Obj(f) = self.get_obj(gp, next) {
            self.realm.generator_next = f;
        }
    }

    // ---------- allocation ----------

    #[inline]
    pub fn alloc(&mut self, obj: Obj) -> Id {
        if self.heap.len() >= MAX_OBJECTS {
            self.out_of_memory();
        }
        self.heap.push(obj);
        (self.heap.len() - 1) as Id
    }

    /// Runs keep everything they allocate until they end, so a runaway allocation loop is stopped here; the run
    /// ends at its next fuel check.
    #[cold]
    pub fn out_of_memory(&mut self) {
        if self.fatal.is_none() {
            self.fatal = Some((
                DiagnosticKind::ExecutionFailure,
                "Execution exceeded its memory limit.".into(),
            ));
            self.fuel = 1;
        }
    }

    pub fn new_object(&mut self) -> Id {
        let proto = self.realm.object_proto;
        self.alloc(Obj::new(Some(proto), Kind::Ordinary))
    }

    pub fn new_array(&mut self, items: Vec<Value>) -> Value {
        let proto = self.realm.array_proto;
        Value::Obj(self.alloc(Obj::new(Some(proto), Kind::Array(items))))
    }

    pub fn char_str(&mut self, c: u16) -> Value {
        match self.char_strs.get(c as usize) {
            Some(s) => Value::Str(*s),
            None => self.string_val(String::from_utf16_lossy(&[c])),
        }
    }

    /// The concatenation of strings, appending in place to the first one's buffer when it can.
    pub fn concat_strs(&mut self, parts: &[StrId]) -> Value {
        if self.atoms.bufs.len() >= MAX_STRINGS {
            self.out_of_memory();
        }
        Value::Str(self.atoms.concat(parts))
    }

    #[inline]
    pub fn str_val(&mut self, s: &str) -> Value {
        self.string_val(s.to_owned())
    }

    #[inline]
    pub fn string_val(&mut self, s: String) -> Value {
        if self.atoms.bufs.len() >= MAX_STRINGS {
            self.out_of_memory();
        }
        Value::Str(self.atoms.alloc(s))
    }

    /// The interned string for a fixed text, without allocating a new one each time.
    pub fn static_str(&mut self, s: &str) -> Value {
        let a = self.atoms.intern(s);
        Value::Str(self.atoms.atom_str(a))
    }

    pub fn strict_eq(&self, a: &Value, b: &Value) -> bool {
        match (a, b) {
            (Value::Num(x), Value::Num(y)) => x == y,
            (Value::Str(x), Value::Str(y)) => x == y || self.atoms.get(*x) == self.atoms.get(*y),
            (Value::Obj(x), Value::Obj(y)) => x == y,
            (Value::Bool(x), Value::Bool(y)) => x == y,
            (Value::Undef, Value::Undef) | (Value::Null, Value::Null) => true,
            (Value::Sym(x), Value::Sym(y)) => x == y,
            _ => false,
        }
    }

    pub fn same_value_zero(&self, a: &Value, b: &Value) -> bool {
        match (a, b) {
            (Value::Num(x), Value::Num(y)) => x == y || (x.is_nan() && y.is_nan()),
            _ => self.strict_eq(a, b),
        }
    }

    #[inline]
    pub fn text(&self, id: StrId) -> &str {
        self.atoms.get(id)
    }

    #[inline]
    pub fn atom_val(&self, a: Atom) -> Value {
        Value::Str(self.atoms.atom_str(a))
    }

    pub fn make_error(&mut self, proto: Id, msg: &str) -> Value {
        let id = self.alloc(Obj::new(Some(proto), Kind::Error(None)));
        let m = self.names.message;
        let text = self.str_val(msg);
        self.heap[id as usize].props.push_new(m, text, HIDDEN);
        Value::Obj(id)
    }

    /// An interpreter failure: a program error that also remembers its diagnostic.
    pub fn failure(&mut self, proto: Id, msg: &str, kind: DiagnosticKind) -> Value {
        let e = self.make_error(proto, msg);
        if let Value::Obj(id) = e {
            self.heap[id as usize].kind = Kind::Error(Some(Box::new(Failure {
                kind,
                message: msg.to_owned(),
                offset: None,
            })));
        }
        e
    }

    pub fn type_error(&mut self, msg: &str) -> Value {
        let p = self.realm.type_error_proto;
        self.failure(p, msg, DiagnosticKind::ExecutionFailure)
    }

    /// A `TypeError` that reports an invalid data value.
    pub fn invalid_data(&mut self, msg: &str) -> Value {
        let p = self.realm.type_error_proto;
        self.failure(p, msg, DiagnosticKind::InvalidDataValue)
    }

    pub fn range_error(&mut self, msg: &str) -> Value {
        let p = self.realm.range_error_proto;
        self.failure(p, msg, DiagnosticKind::ExecutionFailure)
    }

    pub fn reference_error(&mut self, msg: &str) -> Value {
        let p = self.realm.reference_error_proto;
        self.failure(p, msg, DiagnosticKind::ExecutionFailure)
    }

    pub fn syntax_error(&mut self, msg: &str) -> Value {
        let p = self.realm.syntax_error_proto;
        self.failure(p, msg, DiagnosticKind::ExecutionFailure)
    }

    // ---------- fuel and limits ----------

    #[inline]
    fn tick(&mut self) -> Result<(), Value> {
        self.fuel = self.fuel.saturating_sub(1);
        if self.fuel == 0 {
            self.fuel = FUEL;
            self.checkpoint();
            return self.check_time();
        }
        Ok(())
    }

    pub fn handlers_ref(&self) -> &Vec<Handler> {
        &self.handlers
    }

    pub fn handlers_mut(&mut self) -> &mut Vec<Handler> {
        &mut self.handlers
    }

    pub fn template_objs_ref(&self) -> &Vec<Option<Id>> {
        &self.template_objs
    }

    pub fn template_objs_mut(&mut self) -> &mut Vec<Option<Id>> {
        &mut self.template_objs
    }

    /// Notes a suspend request, or a round trip that is due, every few steps.
    #[cold]
    fn checkpoint(&mut self) {
        if self.roundtrip_every > 0 {
            self.fuel = self.roundtrip_every;
            self.suspend_wanted = true;
        }
        if self
            .host
            .shared
            .requested
            .load(std::sync::atomic::Ordering::Relaxed)
        {
            self.suspend_wanted = true;
        }
    }

    /// Starts counting steps for the round-trip test mode.
    pub fn start_roundtrip(&mut self, every: u32) {
        self.roundtrip_every = every;
        self.fuel = every;
    }

    pub fn check_time(&mut self) -> Result<(), Value> {
        if self.fatal.is_some() {
            return Err(Value::Undef);
        }
        if let Some(ms) = self.limits.timeout_ms
            && self.start.elapsed().as_millis() as u64 >= ms
        {
            self.fatal = Some((
                DiagnosticKind::TimeoutExceeded,
                format!("Execution timed out after {ms}ms."),
            ));
            return Err(Value::Undef);
        }
        Ok(())
    }

    // ---------- calls ----------

    /// Calls any callable value from native code and runs it to completion (or its first suspension).
    #[inline(always)]
    pub fn call(&mut self, f: &Value, this: Value, args: &[Value]) -> Res {
        match self.call_packed(f, this, args) {
            Ok(v) => Ok(v.get()),
            Err(e) => Err(e.get()),
        }
    }

    /// `call` with each outcome packed in one word, so it comes back in registers: a two-word `Value` returned
    /// through memory stalls the caller's reload on store forwarding, measurably on short callbacks.
    #[inline(never)]
    fn call_packed(&mut self, f: &Value, this: Value, args: &[Value]) -> Result<Slot, Slot> {
        let probe = 0u8;
        if let Value::Obj(id) = *f
            && matches!(self.heap[id as usize].kind, Kind::Closure(_))
            && self.native_depth < MAX_NATIVE_DEPTH
            && self.stack_base.abs_diff(&probe as *const u8 as usize) <= self.stack_budget
        {
            let fpos = self.stack.len();
            self.push(*f);
            self.push(this);
            self.stack.extend(args.iter().map(|v| Slot::pack(*v)));
            self.push_closure_frame(id, fpos, args.len(), true)
                .map_err(Slot::pack)?;
            self.native_depth += 1;
            let r = self.run();
            self.native_depth -= 1;
            return match r {
                Ok(Exit::Return(v)) | Ok(Exit::Yield(v)) => Ok(v),
                Ok(Exit::Suspend) => Ok(Slot::UNDEF),
                Err(e) => Err(Slot::pack(e)),
            };
        }
        self.call_slow(f, this, args)
            .map(Slot::pack)
            .map_err(Slot::pack)
    }

    fn call_slow(&mut self, f: &Value, this: Value, args: &[Value]) -> Res {
        let probe = 0u8;
        if self.stack_base.abs_diff(&probe as *const u8 as usize) > self.stack_budget {
            return Err(self.range_error("Maximum call stack size exceeded"));
        }
        let Value::Obj(id) = f else {
            let d = self.describe(f);
            return Err(self.type_error(&format!("{d} is not a function")));
        };
        let id = *id;
        match &self.heap[id as usize].kind {
            Kind::Closure(_) => {
                if self.native_depth >= MAX_NATIVE_DEPTH {
                    return Err(self.range_error("Maximum call stack size exceeded"));
                }
                let fpos = self.stack.len();
                self.push(*f);
                self.push(this);
                self.stack.extend(args.iter().map(|v| Slot::pack(*v)));
                self.push_closure_frame(id, fpos, args.len(), true)?;
                self.native_depth += 1;
                let r = self.run();
                self.native_depth -= 1;
                match r {
                    Ok(Exit::Return(v)) | Ok(Exit::Yield(v)) => Ok(v.get()),
                    Ok(Exit::Suspend) => Ok(Value::Undef),
                    Err(e) => Err(e),
                }
            }
            Kind::Native { f, .. } => {
                let f = *f;
                if self.native_depth >= MAX_NATIVE_DEPTH {
                    return Err(self.range_error("Maximum call stack size exceeded"));
                }
                self.native_depth += 1;
                let r = f(self, this, args, id);
                self.native_depth -= 1;
                r
            }
            Kind::Bound(b) => {
                let (target, bthis, bargs) = (b.0, b.1, b.2.clone());
                let mut all = bargs;
                all.extend_from_slice(args);
                self.call(&target, bthis, &all)
            }
            Kind::ToolRef(path) => {
                let path = path.clone();
                self.call_tool(&path, args)
            }
            _ => {
                let d = self.describe(f);
                Err(self.type_error(&format!("{d} is not a function")))
            }
        }
    }

    /// Pushes a frame for the closure at `stack[fpos]`, with receiver and `argc` arguments above it.
    fn push_closure_frame(
        &mut self,
        id: Id,
        fpos: usize,
        argc: usize,
        is_base: bool,
    ) -> Result<(), Value> {
        if self.frames.len() >= MAX_DEPTH {
            self.stack.truncate(fpos);
            return Err(self.range_error("Maximum call stack size exceeded"));
        }
        self.tick()?;
        let Kind::Closure(c) = &self.heap[id as usize].kind else {
            return Ok(());
        };
        let proto = c.proto.clone();
        let upvals = c.upvals.clone();
        if proto.is_arrow {
            self.stack[fpos + 1] = Slot::pack(c.this);
        }
        let base = fpos + 2;
        let np = proto.nparams as usize;
        let mut extra: Box<[Value]> = Box::default();
        if argc > np {
            if proto.needs_extra {
                extra = self.stack.drain(base + np..).map(Slot::get).collect();
            } else {
                self.stack.truncate(base + np);
            }
        }
        self.stack
            .resize(base + proto.nlocals as usize, Slot::UNDEF);
        let kind = if proto.is_async && !proto.is_generator {
            let promise = if proto.is_program {
                None
            } else {
                Some(self.new_promise())
            };
            self.coroutines.push(Coroutine {
                saved: None,
                promise,
            });
            FrameKind::Async(self.coroutines.len() as u32 - 1)
        } else {
            FrameKind::Normal
        };
        let hbase = self.handlers.len() as u32;
        // Reuse a retired frame and write its fields in place: building a fresh one on the stack and copying it in
        // stalls on store forwarding.
        match self.spare_frames.pop() {
            Some(spare) => {
                self.frames.push(spare);
                let f = self.frames.last_mut().expect("frame");
                f.func = proto;
                f.pc = 0;
                f.base = base;
                f.upvals = upvals;
                f.hbase = hbase;
                f.extra = extra;
                f.argc = argc as u32;
                f.kind = kind;
                f.is_base = is_base;
                f.yield_pc = NO_YIELD;
            }
            None => self.frames.push(Box::new(Frame {
                func: proto,
                pc: 0,
                base,
                upvals,
                hbase,
                extra,
                argc: argc as u32,
                kind,
                is_base,
                yield_pc: NO_YIELD,
            })),
        }
        Ok(())
    }

    /// The `Call` instruction: returns whether a frame was pushed.
    #[inline(never)]
    fn call_op(&mut self, argc: usize) -> Result<bool, Value> {
        let fpos = self.stack.len() - argc - 2;
        let callee = self.stack[fpos].get();
        let Value::Obj(id) = callee else {
            self.stack.truncate(fpos);
            let d = self.describe(&callee);
            return Err(self.type_error(&format!("{d} is not a function")));
        };
        match &self.heap[id as usize].kind {
            Kind::Closure(_) => {
                self.push_closure_frame(id, fpos, argc, false)?;
                Ok(true)
            }
            Kind::Native { f, .. } => {
                let f = *f;
                if id == self.realm.generator_next
                    && let Some(g) = self.suspended_generator(self.stack[fpos + 1])
                {
                    let sent = if argc > 0 {
                        self.stack[fpos + 2]
                    } else {
                        Slot::UNDEF
                    };
                    self.stack.truncate(fpos);
                    if self.enter_generator(g, Resume::Result, false) {
                        self.stack.push(sent);
                    }
                    return Ok(true);
                }
                let mut args = self.arg_pool.pop().unwrap_or_default();
                args.extend(self.stack.drain(fpos + 2..).map(Slot::get));
                let this = self.pop();
                self.stack.pop();
                let r = f(self, this, &args, id);
                args.clear();
                self.arg_pool.push(args);
                self.push(r?);
                Ok(false)
            }
            Kind::Bound(b) => {
                let (target, bthis, bargs) = (b.0, b.1, b.2.clone());
                let n = bargs.len();
                self.stack[fpos] = Slot::pack(target);
                self.stack[fpos + 1] = Slot::pack(bthis);
                let tail = self.stack.split_off(fpos + 2);
                self.stack.extend(bargs.into_iter().map(Slot::pack));
                self.stack.extend(tail);
                self.call_op(argc + n)
            }
            Kind::ToolRef(path) => {
                let path = path.clone();
                let args: Vec<Value> = self.stack.drain(fpos + 2..).map(Slot::get).collect();
                self.stack.truncate(fpos);
                let r = self.call_tool(&path, &args)?;
                self.push(r);
                Ok(false)
            }
            _ => {
                self.stack.truncate(fpos);
                let d = self.describe(&callee);
                Err(self.type_error(&format!("{d} is not a function")))
            }
        }
    }

    #[inline(never)]
    fn construct_op(&mut self, argc: usize) -> Result<(), Value> {
        let fpos = self.stack.len() - argc - 2;
        let callee = self.stack[fpos].get();
        let args: Vec<Value> = self.stack.drain(fpos + 2..).map(Slot::get).collect();
        self.stack.truncate(fpos);
        if let Value::Obj(id) = callee {
            match &self.heap[id as usize].kind {
                Kind::Native { f, ctor: true, .. } => {
                    let f = *f;
                    let r = f(self, Value::Uninit, &args, id)?;
                    self.push(r);
                    return Ok(());
                }
                Kind::Closure(_) => {
                    return Err(self.type_error(
                        "User-defined constructors are not supported; call a function that returns an object instead",
                    ));
                }
                _ => {}
            }
        }
        let d = self.describe(&callee);
        Err(self.type_error(&format!("{d} is not a constructor")))
    }

    pub fn call_tool(&mut self, path: &str, args: &[Value]) -> Res {
        crate::host::call_tool(self, path, args)
    }

    pub fn tool_ref(&mut self, path: &str) -> Value {
        if let Some(id) = self.tool_refs.get(path) {
            return Value::Obj(*id);
        }
        let proto = self.realm.function_proto;
        let rc: Rc<str> = Rc::from(path);
        let id = self.alloc(Obj::new(Some(proto), Kind::ToolRef(rc.clone())));
        self.tool_refs.insert(rc, id);
        Value::Obj(id)
    }

    // ---------- exceptions ----------

    /// Fills in the source location of a failure raised by the instruction before `pc`.
    #[inline(never)]
    fn locate(&mut self, e: &Value, func: &FuncProto, pc: usize) {
        if let Value::Obj(id) = e
            && let Kind::Error(Some(f)) = &mut self.heap[*id as usize].kind
            && f.offset.is_none()
            && matches!(
                f.kind,
                DiagnosticKind::ExecutionFailure | DiagnosticKind::InvalidDataValue
            )
        {
            f.offset = func.pos.get(pc.saturating_sub(1)).copied();
        }
    }

    /// Unwinds to the nearest handler. `Err` carries what `run` must return when the base frame is left.
    #[inline(never)]
    fn handle_throw(&mut self, e: Value) -> Result<(), Result<Exit, Value>> {
        let fatal = self.fatal.is_some();
        loop {
            let Some(f) = self.frames.last_mut() else {
                return Err(Err(e));
            };
            if !fatal && self.handlers.len() > f.hbase as usize {
                let h = self.handlers.pop().expect("handler");
                let sp = f.base + h.sp as usize;
                f.pc = h.pc as usize;
                self.stack.truncate(sp);
                self.push(e);
                return Ok(());
            }
            let frame = self.frames.pop().expect("frame");
            self.handlers.truncate(frame.hbase as usize);
            self.stack.truncate(frame.base - 2);
            match frame.kind {
                FrameKind::Async(c) if !fatal => {
                    let result = match self.coroutines[c as usize].promise {
                        Some(p) => {
                            self.reject(p, e);
                            Value::Obj(p)
                        }
                        None => {
                            self.outcome = Some(Err(e));
                            Value::Undef
                        }
                    };
                    if frame.is_base {
                        return Err(Ok(Exit::Return(Slot::pack(result))));
                    }
                    self.push(result);
                    return Ok(());
                }
                FrameKind::Generator(g, _) => {
                    self.leave_generator(g, None);
                    if self.is_async_generator(g) && !fatal {
                        self.async_generator_finish(g, Err(e));
                        return Err(Ok(Exit::Return(Slot::pack(Value::Undef))));
                    }
                    if frame.is_base {
                        return Err(Err(e));
                    }
                }
                _ => {
                    if frame.is_base {
                        return Err(Err(e));
                    }
                }
            }
        }
    }

    #[inline(never)]
    fn save_top_frame(
        &mut self,
        pc: usize,
        started: bool,
        reuse: Option<Box<SavedFrame>>,
    ) -> (Box<SavedFrame>, bool) {
        let mut frame = self.frames.pop().expect("frame");
        frame.pc = pc;
        let mut saved = reuse.unwrap_or_else(|| {
            Box::new(SavedFrame {
                frame: None,
                stack: Vec::new(),
                handlers: Vec::new(),
                started,
            })
        });
        saved.stack.clear();
        saved.stack.extend(self.stack.drain(frame.base - 2..));
        saved.handlers.clear();
        saved
            .handlers
            .extend(self.handlers.drain(frame.hbase as usize..));
        saved.started = started;
        let is_base = frame.is_base;
        saved.frame = Some(frame);
        (saved, is_base)
    }

    fn restore_frame(&mut self, saved: &mut SavedFrame) -> bool {
        let Some(mut frame) = saved.frame.take() else {
            return false;
        };
        frame.base = self.stack.len() + 2;
        frame.is_base = true;
        frame.hbase = self.handlers.len() as u32;
        self.stack.append(&mut saved.stack);
        self.handlers.append(&mut saved.handlers);
        self.frames.push(frame);
        true
    }

    /// Resumes a suspended async function with the settled value of what it awaited.
    pub fn resume_coroutine(&mut self, c: u32, outcome: Result<Value, Value>) -> Result<(), Value> {
        let Some(mut saved) = self.coroutines[c as usize].saved.take() else {
            return Ok(());
        };
        let restored = self.restore_frame(&mut saved);
        self.coroutines[c as usize].saved = Some(saved);
        if !restored {
            return Ok(());
        }
        match outcome {
            Ok(v) => self.push(v),
            Err(e) => {
                if let Err(r) = self.handle_throw(e) {
                    return r.map(|_| ());
                }
            }
        }
        self.run().map(|_| ())
    }

    /// Whether `v` is a generator that can be resumed now.
    #[inline]
    fn suspended_generator(&self, v: Slot) -> Option<Id> {
        match v.get() {
            Value::Obj(id) => match &self.heap[id as usize].kind {
                Kind::Generator(GenState::Suspended(_)) => Some(id),
                _ => None,
            },
            _ => None,
        }
    }

    pub fn is_async_generator(&self, g: Id) -> bool {
        matches!(self.heap[g as usize].kind, Kind::AsyncGenerator(_))
    }

    /// Pushes a suspended generator's frame and switches to its stack, which holds that frame's slots; the
    /// resumer's stack waits in the generator until it yields or finishes. Nothing is copied. Returns whether a
    /// `next(v)` request must push `v`: the generator waits at a `yield` whose result is used.
    fn enter_generator(&mut self, g: Id, resume: Resume, is_base: bool) -> bool {
        let state = match &mut self.heap[g as usize].kind {
            Kind::Generator(s) => s,
            Kind::AsyncGenerator(a) => &mut a.state,
            _ => return false,
        };
        let GenState::Suspended(mut saved) = std::mem::replace(state, GenState::Done) else {
            return false;
        };
        let Some(frame) = saved.frame.take() else {
            return false;
        };
        std::mem::swap(&mut self.stack, &mut saved.stack);
        let hbase = self.handlers.len() as u32;
        if !saved.handlers.is_empty() {
            self.handlers.append(&mut saved.handlers);
        }
        *state = GenState::Running(saved);
        // Move the frame unchanged and adjust it in place: narrow writes to a moved value stall its copy.
        self.frames.push(frame);
        let f = self.frames.last_mut().expect("frame");
        f.kind = FrameKind::Generator(g, resume);
        f.is_base = is_base;
        f.hbase = hbase;
        f.yield_pc != NO_YIELD
            && !matches!(f.func.code.get(f.yield_pc as usize), Some(Op::YieldDrop(_)))
    }

    /// Switches back to the resumer's stack after the generator's frame was popped: suspended again with `frame`,
    /// or finished without it.
    fn leave_generator(&mut self, g: Id, frame: Option<Box<Frame>>) {
        let state = match &mut self.heap[g as usize].kind {
            Kind::Generator(s) => s,
            Kind::AsyncGenerator(a) => &mut a.state,
            _ => return,
        };
        let GenState::Running(mut saved) = std::mem::replace(state, GenState::Done) else {
            return;
        };
        std::mem::swap(&mut self.stack, &mut saved.stack);
        if let Some(f) = frame {
            if self.handlers.len() > f.hbase as usize {
                saved
                    .handlers
                    .extend(self.handlers.drain(f.hbase as usize..));
            }
            saved.frame = Some(f);
            *state = GenState::Suspended(saved);
        }
    }

    /// Hands a `throw` (1) or `return` (2) request to the generator frame just entered, which has yielded before.
    /// `return(v)` runs the return path after its `yield`; `throw(e)` throws there, or at a `yield*` forwards it.
    fn deliver_abrupt(&mut self, kind: u8, v: Value) -> Result<(), Result<Exit, Value>> {
        let f = self.frames.last_mut().expect("frame");
        let at = f.yield_pc as usize;
        if kind == REQ_RETURN {
            f.pc = at + 1;
        } else if matches!(f.func.code.get(at), Some(Op::YieldStar(_))) {
            f.pc = at + 2;
        } else {
            return self.handle_throw(v);
        }
        self.push(v);
        Ok(())
    }

    /// Delivers a finished generator's completion value to the frame that resumed it from bytecode.
    fn generator_done(&mut self, resume: Resume, v: Value) {
        match resume {
            Resume::Collect(_) => {}
            Resume::Result => {
                let r = self.iter_result(v, true);
                self.push(r);
            }
            Resume::Delegate => {
                let Some(f) = self.frames.last_mut() else {
                    return;
                };
                if let Some(Op::DelegateResult(exit)) = f.func.code.get(f.pc) {
                    f.pc = *exit as usize;
                }
                self.push(v);
            }
            Resume::Iter => {
                let Some(f) = self.frames.last_mut() else {
                    return;
                };
                let base = f.base;
                match f.func.code.get(f.pc.wrapping_sub(1)) {
                    Some(Op::IterNext(slot, exit)) => {
                        f.pc = *exit as usize;
                        self.stack[base + *slot as usize] = Slot::UNDEF;
                    }
                    Some(Op::IterStep(slot)) => {
                        self.stack[base + *slot as usize] = Slot::UNDEF;
                        self.stack.push(Slot::UNDEF);
                    }
                    _ => self.push(v),
                }
            }
        }
    }

    /// Resumes a generator from native code and runs it to its next yield or its end. `mode` is 0 for `next`, 1
    /// for `return` and 2 for `throw`.
    pub fn resume_generator(&mut self, g: Id, mode: u8, v: Value) -> Result<(Value, bool), Value> {
        let started = match &self.heap[g as usize].kind {
            Kind::Generator(GenState::Suspended(s)) => {
                s.frame.as_ref().is_some_and(|f| f.yield_pc != NO_YIELD)
            }
            Kind::Generator(GenState::Running(_)) => {
                return Err(self.type_error("Generator is already running"));
            }
            _ => {
                return match mode {
                    0 => Ok((Value::Undef, true)),
                    1 => Ok((v, true)),
                    _ => Err(v),
                };
            }
        };
        if !started && mode != 0 {
            self.heap[g as usize].kind = Kind::Generator(GenState::Done);
            return if mode == 1 { Ok((v, true)) } else { Err(v) };
        }
        let wants = self.enter_generator(g, Resume::Iter, true);
        let r = match mode {
            0 => {
                if wants {
                    self.push(v);
                }
                self.run()
            }
            _ => {
                let kind = if mode == 1 { REQ_RETURN } else { REQ_THROW };
                match self.deliver_abrupt(kind, v) {
                    Ok(()) => self.run(),
                    Err(r) => r,
                }
            }
        };
        match r {
            Ok(Exit::Yield(y)) => Ok((y.get(), false)),
            Ok(Exit::Suspend) => Ok((Value::Undef, false)),
            Ok(Exit::Return(v)) => Ok((v.get(), true)),
            Err(e) => Err(e),
        }
    }

    /// Runs a generator from native code until it finishes, collecting what it yields.
    pub fn collect_generator(&mut self, g: Id) -> Result<Vec<Value>, Value> {
        let arr = self.new_array(Vec::new());
        let Value::Obj(arr) = arr else {
            return Ok(Vec::new());
        };
        if self.enter_generator(g, Resume::Collect(arr), true) {
            self.push(Value::Undef);
        }
        self.run()?;
        Ok(match &mut self.heap[arr as usize].kind {
            Kind::Array(items) => std::mem::take(items),
            _ => Vec::new(),
        })
    }

    /// Runs an async generator's body from native code, for a request (`awaited` false) or with the outcome of
    /// what it awaited. What the body produces settles its request promises, so only a fatal failure comes back.
    pub fn run_async_generator(
        &mut self,
        g: Id,
        kind: u8,
        outcome: Result<Value, Value>,
        awaited: bool,
    ) -> Result<(), Value> {
        let wants = self.enter_generator(g, Resume::Iter, true);
        let r = match (outcome, awaited) {
            (Ok(v), true) => {
                self.push(v);
                self.run()
            }
            (Err(e), true) => match self.handle_throw(e) {
                Ok(()) => self.run(),
                Err(r) => r,
            },
            (Ok(v), false) | (Err(v), false) => {
                if kind == REQ_NEXT {
                    if wants {
                        self.push(v);
                    }
                    self.run()
                } else {
                    match self.deliver_abrupt(kind, v) {
                        Ok(()) => self.run(),
                        Err(r) => r,
                    }
                }
            }
        };
        r.map(|_| ())
    }

    // ---------- the run loop ----------

    #[inline(always)]
    fn pop(&mut self) -> Value {
        self.stack.pop().unwrap_or_default().get()
    }

    #[inline(always)]
    fn push(&mut self, v: Value) {
        self.stack.push(Slot::pack(v));
    }

    #[inline(always)]
    fn top(&self) -> Value {
        self.stack.last().copied().unwrap_or_default().get()
    }

    /// A template site's strings array, with its read-only `raw` array of the source text.
    #[inline(never)]
    fn template_object(&mut self, i: usize) -> Value {
        if let Some(Some(id)) = self.template_objs.get(i) {
            return Value::Obj(*id);
        }
        let Some(site) = self.templates.get(i) else {
            return Value::Undef;
        };
        let cooked: Vec<Value> = site.cooked.iter().map(|c| c.unwrap_or_default()).collect();
        let raw = site.raw.clone();
        let raw = self.new_array(raw);
        let strings = self.new_array(cooked);
        if let Value::Obj(id) = strings {
            let rk = self.atoms.intern_static("raw");
            self.heap[id as usize].props.push_new(rk, raw, 0);
            if let Some(slot) = self.template_objs.get_mut(i) {
                *slot = Some(id);
            }
        }
        strings
    }

    #[inline(never)]
    fn make_closure(&mut self, idx: u32) -> Value {
        let proto = self.protos[idx as usize].clone();
        let f = self.frames.last().expect("frame");
        let upvals: Rc<[u32]> = proto
            .captures
            .iter()
            .map(|c| match c {
                Capture::Cell(i) => self.stack[f.base + *i as usize].0 as u32,
                Capture::Upval(i) => f.upvals[*i as usize],
            })
            .collect();
        let this = if proto.is_arrow {
            self.stack[f.base - 1].get()
        } else {
            Value::Undef
        };
        let fp = match (proto.is_generator, proto.is_async) {
            (true, true) => self.realm.async_generator_function_proto,
            (true, false) => self.realm.generator_function_proto,
            (false, true) => self.realm.async_function_proto,
            (false, false) => self.realm.function_proto,
        };
        let generator = proto.is_generator.then_some(proto.is_async);
        let id = self.alloc(Obj::new(
            Some(fp),
            Kind::Closure(Box::new(Closure {
                proto,
                upvals,
                this,
            })),
        ));
        // A generator function has its own `prototype`, which its generators inherit from.
        if let Some(is_async) = generator {
            let parent = if is_async {
                self.realm.async_generator_proto
            } else {
                self.realm.generator_proto
            };
            let p = self.alloc(Obj::new(Some(parent), Kind::Ordinary));
            let pk = self.names.prototype;
            self.heap[id as usize]
                .props
                .push_new(pk, Value::Obj(p), WRITABLE);
        }
        Value::Obj(id)
    }

    pub fn run(&mut self) -> Result<Exit, Value> {
        let resumable = std::mem::take(&mut self.resumable_run) && self.run_depth == 0;
        self.run_depth += 1;
        let r = self.run_frames(resumable);
        self.run_depth -= 1;
        r
    }

    /// Continues frames a suspend left on the job stack, as the entry point that started them would have.
    pub fn continue_frames(&mut self) -> Result<(), Value> {
        if self.frames.is_empty() {
            return Ok(());
        }
        self.resumable_run = true;
        let r = self.run();
        self.resumable_run = false;
        r.map(|_| ())
    }

    /// The dispatch loop. `resumable` lets a suspend stop it at a back-edge, leaving its frames for later.
    fn run_frames(&mut self, resumable: bool) -> Result<Exit, Value> {
        'outer: loop {
            let fi = self.frames.len() - 1;
            let func = self.frames[fi].func.clone();
            let code: &[Op] = &func.code;
            let base = self.frames[fi].base;
            let mut pc = self.frames[fi].pc;

            macro_rules! throw {
                ($e:expr) => {{
                    let e = $e;
                    self.frames[fi].pc = pc;
                    self.locate(&e, &func, pc);
                    match self.handle_throw(e) {
                        Ok(()) => continue 'outer,
                        Err(r) => return r,
                    }
                }};
            }
            macro_rules! tri {
                ($e:expr) => {
                    match $e {
                        Ok(v) => v,
                        Err(e) => throw!(e),
                    }
                };
            }
            // An iterator whose step failed is not closed afterwards, so forget it before throwing.
            macro_rules! step {
                ($slot:expr, $e:expr) => {
                    match $e {
                        Ok(v) => v,
                        Err(e) => {
                            self.stack[base + $slot as usize] = Slot::UNDEF;
                            throw!(e)
                        }
                    }
                };
            }
            macro_rules! num_op {
                ($f:expr) => {{
                    let f: fn(f64, f64) -> f64 = $f;
                    let n = self.stack.len();
                    let (a, b) = (self.stack[n - 2], self.stack[n - 1]);
                    if a.is_num() && b.is_num() {
                        self.stack[n - 2] = Slot::num(f(a.f(), b.f()));
                        self.stack.pop();
                    } else {
                        let b = self.pop();
                        let a = self.pop();
                        tri!(self.data_operands(&a, &b));
                        let x = tri!(self.number_of(&a));
                        let y = tri!(self.number_of(&b));
                        self.push(Value::Num(f(x, y)));
                    }
                }};
            }
            macro_rules! int_op {
                ($f:expr) => {{
                    let b = self.pop();
                    let a = self.pop();
                    tri!(self.data_operands(&a, &b));
                    let x = tri!(self.number_of(&a));
                    let y = tri!(self.number_of(&b));
                    let f: fn(f64, f64) -> f64 = $f;
                    self.push(Value::Num(f(x, y)));
                }};
            }
            macro_rules! cmp_op {
                ($op:tt, $swap:expr, $neg_undef:expr) => {{
                    let n = self.stack.len();
                    let (a, b) = (self.stack[n - 2], self.stack[n - 1]);
                    if a.is_num() && b.is_num() {
                        let r = a.f() $op b.f();
                        self.stack.pop();
                        self.stack[n - 2] = Slot::pack(Value::Bool(r));
                        continue;
                    }
                    let b = self.pop();
                    let a = self.pop();
                    tri!(self.data_operands(&a, &b));
                    let r = match (&a, &b) {
                        (Value::Num(x), Value::Num(y)) => *x $op *y,
                        (Value::Str(x), Value::Str(y)) => {
                            self.atoms.sref(*x).cmp16(self.atoms.sref(*y)) $op std::cmp::Ordering::Equal
                        }
                        _ => {
                            let (l, r) = if $swap { (b, a) } else { (a, b) };
                            let c = tri!(self.less_than(&l, &r, !$swap));
                            match c {
                                Some(v) => if $neg_undef { !v } else { v },
                                None => false,
                            }
                        }
                    };
                    self.push(Value::Bool(r));
                }};
            }

            loop {
                let op = code[pc];
                pc += 1;
                match op {
                    Op::Nop => {}
                    Op::Pop => {
                        self.stack.pop();
                    }
                    Op::Dup => {
                        let v = self.stack.last().copied().unwrap_or_default();
                        if v.is_str() {
                            self.atoms.bufs[v.payload() as usize].builder = false;
                        }
                        self.stack.push(v);
                    }
                    Op::Dup2 => {
                        let n = self.stack.len();
                        let (a, b) = (self.stack[n - 2], self.stack[n - 1]);
                        self.stack.push(a);
                        self.stack.push(b);
                    }
                    Op::Swap => {
                        let n = self.stack.len();
                        self.stack.swap(n - 1, n - 2);
                    }
                    Op::Rot3 => {
                        let c = self.stack.pop().unwrap_or_default();
                        let n = self.stack.len();
                        self.stack.insert(n - 2, c);
                    }
                    Op::Rot3Back => {
                        let n = self.stack.len();
                        let a = self.stack.remove(n - 3);
                        self.stack.push(a);
                    }
                    Op::Undef => self.stack.push(Slot::UNDEF),
                    Op::Null => self.push(Value::Null),
                    Op::True => self.push(Value::Bool(true)),
                    Op::False => self.push(Value::Bool(false)),
                    Op::Uninit => self.stack.push(Slot::UNINIT),
                    Op::Int(i) => self.stack.push(Slot::num(i as f64)),
                    Op::Const(i) => {
                        let v = self.consts[i as usize];
                        self.push(v);
                    }
                    Op::GetLocal(i) => {
                        let v = self.stack[base + i as usize];
                        if v.is_str() {
                            self.atoms.bufs[v.payload() as usize].builder = false;
                        }
                        self.stack.push(v);
                    }
                    Op::GetLocal2(a, b) => {
                        for i in [a, b] {
                            let v = self.stack[base + i as usize];
                            if v.is_str() {
                                self.atoms.bufs[v.payload() as usize].builder = false;
                            }
                            self.stack.push(v);
                        }
                    }
                    Op::ArithI(op, k) => {
                        let n = self.stack.len();
                        let a = self.stack[n - 1];
                        let y = k as f64;
                        if a.is_num() {
                            let x = a.f();
                            self.stack[n - 1] = match op {
                                Arith::Add => Slot::num(x + y),
                                Arith::Sub => Slot::num(x - y),
                                Arith::Mul => Slot::num(x * y),
                                Arith::Div => Slot::num(x / y),
                                Arith::Mod => Slot::num(js_rem(x, y)),
                                Arith::Lt => Slot::pack(Value::Bool(x < y)),
                                Arith::Le => Slot::pack(Value::Bool(x <= y)),
                                Arith::Gt => Slot::pack(Value::Bool(x > y)),
                                Arith::Ge => Slot::pack(Value::Bool(x >= y)),
                                Arith::StrictEq => Slot::pack(Value::Bool(x == y)),
                                Arith::StrictNe => Slot::pack(Value::Bool(x != y)),
                            };
                        } else {
                            let r = tri!(self.arith(op, a.get(), Value::Num(y)));
                            self.stack[n - 1] = Slot::pack(r);
                        }
                    }
                    Op::SetLocal(i) => {
                        let v = self.stack.pop().unwrap_or_default();
                        self.stack[base + i as usize] = v;
                    }
                    Op::GetLocalChk(i, name) => {
                        let v = self.stack[base + i as usize];
                        if v == Slot::UNINIT {
                            throw!(self.tdz_error(name));
                        }
                        if v.is_str() {
                            self.atoms.bufs[v.payload() as usize].builder = false;
                        }
                        self.stack.push(v);
                    }
                    Op::NewCell(i) => {
                        self.cells.push(Slot::UNINIT);
                        let c = self.cells.len() as u64 - 1;
                        self.stack[base + i as usize] = Slot(c);
                    }
                    Op::GetCell(i) => {
                        let c = self.stack[base + i as usize].0 as usize;
                        let v = self.cells.get(c).copied().unwrap_or(Slot::UNINIT);
                        self.stack.push(v);
                    }
                    Op::GetCellChk(i, name) => {
                        let c = self.stack[base + i as usize].0 as usize;
                        let v = self.cells.get(c).copied().unwrap_or(Slot::UNINIT);
                        if v == Slot::UNINIT {
                            throw!(self.tdz_error(name));
                        }
                        self.stack.push(v);
                    }
                    Op::SetCell(i) => {
                        let v = self.stack.pop().unwrap_or_default();
                        let c = self.stack[base + i as usize].0 as usize;
                        if let Some(cell) = self.cells.get_mut(c) {
                            *cell = v;
                        }
                    }
                    Op::GetUpval(i) => {
                        let c = self.frames[fi].upvals[i as usize];
                        let v = self.cells[c as usize];
                        self.stack.push(v);
                    }
                    Op::GetUpvalChk(i, name) => {
                        let c = self.frames[fi].upvals[i as usize];
                        let v = self.cells[c as usize];
                        if v == Slot::UNINIT {
                            throw!(self.tdz_error(name));
                        }
                        self.stack.push(v);
                    }
                    Op::SetUpval(i) => {
                        let v = self.stack.pop().unwrap_or_default();
                        let c = self.frames[fi].upvals[i as usize];
                        self.cells[c as usize] = v;
                    }
                    Op::GetGlobal(g) => {
                        let v = self.globals[g as usize];
                        if let Value::Uninit = v {
                            let name = self.protos_global_name(g);
                            throw!(self.reference_error(&format!("Unknown identifier '{name}'.")));
                        }
                        self.push(v);
                    }
                    Op::TypeofGlobal(g) => {
                        let v = self.globals[g as usize];
                        let t = if let Value::Uninit = v {
                            "undefined"
                        } else {
                            self.type_of(&v)
                        };
                        let t = self.static_str(t);
                        self.push(t);
                    }
                    Op::ThrowConst(name) => {
                        let n = self.atoms.text(name).to_owned();
                        throw!(self.type_error(&format!("Cannot assign to constant '{n}'.")));
                    }
                    Op::ThrowRef(name) => {
                        let n = self.atoms.text(name).to_owned();
                        throw!(self.reference_error(&format!("Unknown identifier '{n}'.")));
                    }
                    Op::ThrowType(msg) => {
                        let m = match self.consts[msg as usize] {
                            Value::Str(s) => self.text(s).to_owned(),
                            _ => String::new(),
                        };
                        throw!(self.type_error(&m));
                    }
                    Op::This => {
                        let v = self.stack[base - 1].get();
                        self.push(v);
                    }
                    Op::Callee => {
                        let v = self.stack[base - 2].get();
                        self.push(v);
                    }
                    Op::Arguments => {
                        let f = &self.frames[fi];
                        let n = (f.argc as usize).min(func.nparams as usize);
                        let mut items: Vec<Value> =
                            self.stack[base..base + n].iter().map(|s| s.get()).collect();
                        for v in &items {
                            if let Value::Str(id) = v {
                                self.atoms.bufs[*id as usize].builder = false;
                            }
                        }
                        items.extend(f.extra.iter().cloned());
                        let proto = self.realm.object_proto;
                        let id = self.alloc(Obj::new(Some(proto), Kind::Arguments(items)));
                        self.push(Value::Obj(id));
                    }
                    Op::Rest(_) => {
                        let extra = self.frames[fi].extra.to_vec();
                        let a = self.new_array(extra);
                        self.push(a);
                    }

                    Op::GetProp(a) => {
                        let o = self.pop();
                        let v = tri!(self.get(&o, a));
                        self.push(v);
                    }
                    Op::SetProp(a) => {
                        let v = self.pop();
                        let o = self.pop();
                        tri!(self.check_assignment(&o, &v));
                        tri!(self.set(&o, a, v));
                        self.push(v);
                    }
                    Op::GetElem => {
                        let k = self.pop();
                        let o = self.pop();
                        let v = tri!(self.get_elem(&o, &k));
                        self.push(v);
                    }
                    Op::SetElem => {
                        let v = self.pop();
                        let k = self.pop();
                        let o = self.pop();
                        tri!(self.check_assignment(&o, &v));
                        tri!(self.set_elem(&o, &k, v));
                        self.push(v);
                    }
                    Op::GetMethod(a) => {
                        let o = self.pop();
                        let f = tri!(self.get(&o, a));
                        self.push(f);
                        self.push(o);
                    }
                    Op::DelProp(a) => {
                        let o = self.pop();
                        let r = tri!(self.delete(&o, a));
                        self.push(Value::Bool(r));
                    }
                    Op::DelElem => {
                        let k = self.pop();
                        let o = self.pop();
                        let a = tri!(self.key_of(&k));
                        let r = tri!(self.delete(&o, a));
                        self.push(Value::Bool(r));
                    }
                    Op::In => {
                        let o = self.pop();
                        let k = self.pop();
                        let r = tri!(self.has_property(&o, &k));
                        self.push(Value::Bool(r));
                    }
                    Op::InstanceOf => {
                        let c = self.pop();
                        let v = self.pop();
                        let r = tri!(self.instance_of(&v, &c));
                        self.push(Value::Bool(r));
                    }
                    Op::DefineField(a) => {
                        let v = self.pop();
                        if let Value::Obj(id) = self.top() {
                            self.define(id, a, v);
                        }
                    }
                    Op::DefineElem => {
                        let v = self.pop();
                        let k = self.pop();
                        let a = tri!(self.key_of(&k));
                        if let Value::Obj(id) = self.top() {
                            self.define(id, a, v);
                        }
                    }
                    Op::NewObject => {
                        let id = self.new_object();
                        self.push(Value::Obj(id));
                    }
                    Op::NewArray(n) => {
                        let items = self
                            .stack
                            .drain(self.stack.len() - n as usize..)
                            .map(Slot::get)
                            .collect();
                        let a = self.new_array(items);
                        self.push(a);
                    }
                    Op::ArrayPush => {
                        let v = self.pop();
                        if let Value::Obj(id) = self.top()
                            && let Kind::Array(items) = &mut self.heap[id as usize].kind
                        {
                            items.push(v);
                        }
                    }
                    Op::ArraySpread => {
                        let top = self.stack.last().copied().unwrap_or_default();
                        if let Some(g) = self.suspended_generator(top) {
                            self.stack.pop();
                            self.frames[fi].pc = pc;
                            let arr = self.top().as_obj().unwrap_or(0);
                            if self.enter_generator(g, Resume::Collect(arr), false) {
                                self.stack.push(Slot::UNDEF);
                            }
                            continue 'outer;
                        }
                        let src = self.pop();
                        if !self.is_iterable(&src) {
                            throw!(self.not_iterable(&src, crate::bytecode::ITER_SPREAD));
                        }
                        let items = tri!(self.iterate_to_vec(&src));
                        if let Value::Obj(id) = self.top()
                            && let Kind::Array(arr) = &mut self.heap[id as usize].kind
                        {
                            arr.extend(items);
                        }
                    }
                    Op::ObjectSpread => {
                        let src = self.pop();
                        if let Value::Obj(id) = self.top() {
                            tri!(self.copy_props(id, &src, &[]));
                        }
                    }
                    Op::ObjRest(n) => {
                        let keys: Vec<Value> = self
                            .stack
                            .drain(self.stack.len() - n as usize..)
                            .map(Slot::get)
                            .collect();
                        let src = self.pop();
                        let mut excluded = Vec::with_capacity(keys.len());
                        for k in &keys {
                            excluded.push(tri!(self.key_of(k)));
                        }
                        let id = self.new_object();
                        tri!(self.copy_props(id, &src, &excluded));
                        self.push(Value::Obj(id));
                    }
                    Op::ToKey => {
                        let k = self.top();
                        if !matches!(k, Value::Num(_) | Value::Str(_) | Value::Sym(_)) {
                            self.frames[fi].pc = pc;
                            let a = tri!(self.key_of(&k));
                            self.stack.pop();
                            let v = if a <= SYM_ASYNC_ITERATOR {
                                Value::Sym(a)
                            } else {
                                self.atom_val(a)
                            };
                            self.push(v);
                        }
                    }
                    Op::RequireCoercible => {
                        let v = self.top();
                        if v.is_nullish() {
                            let t = if let Value::Null = v {
                                "null"
                            } else {
                                "undefined"
                            };
                            throw!(
                                self.type_error(&format!("Cannot destructure '{t}' as it is {t}."))
                            );
                        }
                    }

                    Op::Add => {
                        let n = self.stack.len();
                        let (a, b) = (self.stack[n - 2], self.stack[n - 1]);
                        if a.is_num() && b.is_num() {
                            self.stack[n - 2] = Slot::num(a.f() + b.f());
                            self.stack.pop();
                            continue;
                        }
                        let b = self.pop();
                        let a = self.pop();
                        let r = match (&a, &b) {
                            (Value::Num(x), Value::Num(y)) => Value::Num(x + y),
                            _ => tri!(self.add(a, b)),
                        };
                        self.push(r);
                    }
                    Op::Sub => num_op!(|x, y| x - y),
                    Op::Mul => num_op!(|x, y| x * y),
                    Op::Div => num_op!(|x, y| x / y),
                    Op::Mod => num_op!(js_rem),
                    Op::Pow => num_op!(js_pow),
                    Op::BitAnd => int_op!(|x, y| (to_i32(x) & to_i32(y)) as f64),
                    Op::BitOr => int_op!(|x, y| (to_i32(x) | to_i32(y)) as f64),
                    Op::BitXor => int_op!(|x, y| (to_i32(x) ^ to_i32(y)) as f64),
                    Op::Shl => int_op!(|x, y| to_i32(x).wrapping_shl(to_u32(y) & 31) as f64),
                    Op::Shr => int_op!(|x, y| (to_i32(x) >> (to_u32(y) & 31)) as f64),
                    Op::UShr => int_op!(|x, y| (to_u32(x) >> (to_u32(y) & 31)) as f64),
                    Op::Eq => {
                        let b = self.pop();
                        let a = self.pop();
                        tri!(self.loose_eq_operands(&a, &b));
                        let r = tri!(self.loose_eq(&a, &b));
                        self.push(Value::Bool(r));
                    }
                    Op::Ne => {
                        let b = self.pop();
                        let a = self.pop();
                        tri!(self.loose_eq_operands(&a, &b));
                        let r = tri!(self.loose_eq(&a, &b));
                        self.push(Value::Bool(!r));
                    }
                    Op::StrictEq => {
                        let b = self.pop();
                        let a = self.pop();
                        let r = self.strict_eq(&a, &b);
                        self.push(Value::Bool(r));
                    }
                    Op::StrictNe => {
                        let b = self.pop();
                        let a = self.pop();
                        let r = !self.strict_eq(&a, &b);
                        self.push(Value::Bool(r));
                    }
                    Op::Lt => cmp_op!(<, false, false),
                    Op::Gt => cmp_op!(>, true, false),
                    Op::Le => cmp_op!(<=, true, true),
                    Op::Ge => cmp_op!(>=, false, true),
                    Op::Neg => {
                        let a = self.pop();
                        tri!(self.data_operand(&a, "Unary operators require data values."));
                        let x = match a {
                            Value::Num(x) => x,
                            _ => tri!(self.number_of(&a)),
                        };
                        self.push(Value::Num(-x));
                    }
                    Op::ToNumber | Op::ToNumeric => {
                        let a = self.pop();
                        if self.is_opaque_operand(&a) {
                            let msg = match (op, code.get(pc..pc + 3)) {
                                (Op::ToNumeric, Some(next)) if next.contains(&Op::Dec) => {
                                    "'--' requires a data value."
                                }
                                (Op::ToNumeric, _) => "'++' requires a data value.",
                                _ => "Unary operators require data values.",
                            };
                            throw!(self.invalid_data(msg));
                        }
                        let x = match a {
                            Value::Num(x) => x,
                            _ => tri!(self.number_of(&a)),
                        };
                        self.push(Value::Num(x));
                    }
                    Op::Not => {
                        let a = self.pop();
                        self.push(Value::Bool(!self.truthy(&a)));
                    }
                    Op::BitNot => {
                        let a = self.pop();
                        tri!(self.data_operand(&a, "Unary operators require data values."));
                        let x = tri!(self.number_of(&a));
                        self.push(Value::Num(!to_i32(x) as f64));
                    }
                    Op::RegExp => {
                        let flags = self.pop();
                        let pattern = self.pop();
                        let (Value::Str(p), Value::Str(f)) = (pattern, flags) else {
                            continue;
                        };
                        let (p, f) = (self.text(p).to_owned(), self.text(f).to_owned());
                        let r = tri!(crate::builtins::regexp::new_regexp(self, &p, &f));
                        self.push(r);
                    }
                    Op::Typeof => {
                        let a = self.pop();
                        let t = self.type_of(&a);
                        let t = self.static_str(t);
                        self.push(t);
                    }
                    Op::Inc | Op::Dec => {
                        let a = self.pop();
                        let msg = if matches!(op, Op::Inc) {
                            "'++' requires a data value."
                        } else {
                            "'--' requires a data value."
                        };
                        tri!(self.data_operand(&a, msg));
                        let x = match a {
                            Value::Num(x) => x,
                            _ => tri!(self.number_of(&a)),
                        };
                        self.push(Value::Num(if matches!(op, Op::Inc) {
                            x + 1.0
                        } else {
                            x - 1.0
                        }));
                    }
                    Op::ToStr => {
                        let a = self.pop();
                        let s = match a {
                            Value::Str(_) => a,
                            _ => Value::Str(tri!(self.string_of(&a))),
                        };
                        self.push(s);
                    }
                    Op::Concat(n) => {
                        let start = self.stack.len() - n as usize;
                        let parts: Vec<StrId> = self.stack[start..]
                            .iter()
                            .filter(|p| p.is_str())
                            .map(|p| p.payload())
                            .collect();
                        self.stack.truncate(start);
                        let len: usize = parts.iter().map(|p| self.atoms.get(*p).len()).sum();
                        if len > crate::ops::MAX_STRING_LEN {
                            throw!(self.range_error("Invalid string length"));
                        }
                        let v = self.concat_strs(&parts);
                        self.push(v);
                    }
                    Op::Template(i) => {
                        let t = self.template_object(i as usize);
                        self.push(t);
                    }
                    Op::AddLocal(i) => {
                        let b = self.pop();
                        let slot = base + i as usize;
                        let a = self.stack[slot].get();
                        let r = match (a, b) {
                            (Value::Num(x), Value::Num(y)) => Value::Num(x + y),
                            (Value::Str(sa), Value::Str(sb))
                                if sa != sb && self.atoms.bufs[sa as usize].builder =>
                            {
                                let added = self.atoms.get(sb).len();
                                if self.atoms.get(sa).len() + added > crate::ops::MAX_STRING_LEN {
                                    throw!(self.range_error("Invalid string length"));
                                }
                                self.atoms.push_in_place(sa, sb);
                                a
                            }
                            (a, b) => {
                                let r = tri!(self.add(a, b));
                                if let Value::Str(id) = r {
                                    self.atoms.bufs[id as usize].builder = true;
                                }
                                r
                            }
                        };
                        self.stack[slot] = Slot::pack(r);
                    }
                    Op::IncLocal(i) => {
                        let slot = base + i as usize;
                        let v = self.stack[slot];
                        if v.is_num() {
                            self.stack[slot] = Slot::num(v.f() + 1.0);
                        } else {
                            tri!(self.data_operand(&v.get(), "'++' requires a data value."));
                            let x = tri!(self.number_of(&v.get()));
                            self.stack[slot] = Slot::num(x + 1.0);
                        }
                    }

                    Op::Jump(t) => {
                        if (t as usize) < pc {
                            tri!(self.tick());
                            if self.suspend_wanted && resumable {
                                self.frames[fi].pc = t as usize;
                                self.suspended = true;
                                return Ok(Exit::Suspend);
                            }
                        }
                        pc = t as usize;
                    }
                    Op::JumpIfFalse(t) => {
                        let v = self.pop();
                        let jump = match v {
                            Value::Bool(b) => !b,
                            v => !self.truthy(&v),
                        };
                        if jump {
                            pc = t as usize;
                        }
                    }
                    Op::JumpUnless(cmp, t) => {
                        let n = self.stack.len();
                        let (a, b) = (self.stack[n - 2], self.stack[n - 1]);
                        self.stack.truncate(n - 2);
                        let r = if a.is_num() && b.is_num() {
                            compare(cmp, a.f(), b.f())
                        } else {
                            let r = tri!(self.arith(cmp, a.get(), b.get()));
                            self.truthy(&r)
                        };
                        if !r {
                            pc = t as usize;
                        }
                    }
                    Op::JumpUnlessI(cmp, k, t) => {
                        let a = self.stack.pop().unwrap_or_default();
                        let r = if a.is_num() {
                            compare(cmp, a.f(), k as f64)
                        } else {
                            let r = tri!(self.arith(cmp, a.get(), Value::Num(k as f64)));
                            self.truthy(&r)
                        };
                        if !r {
                            pc = t as usize;
                        }
                    }
                    Op::JumpIfTrue(t) => {
                        let v = self.pop();
                        if self.truthy(&v) {
                            if (t as usize) < pc {
                                tri!(self.tick());
                                if self.suspend_wanted && resumable {
                                    self.frames[fi].pc = t as usize;
                                    self.suspended = true;
                                    return Ok(Exit::Suspend);
                                }
                            }
                            pc = t as usize;
                        }
                    }
                    Op::JumpIfFalseKeep(t) => {
                        let v = self.top();
                        if !self.truthy(&v) {
                            pc = t as usize;
                        } else {
                            self.stack.pop();
                        }
                    }
                    Op::JumpIfTrueKeep(t) => {
                        let v = self.top();
                        if self.truthy(&v) {
                            pc = t as usize;
                        } else {
                            self.stack.pop();
                        }
                    }
                    Op::JumpIfNotNullishKeep(t) => {
                        if !self.top().is_nullish() {
                            pc = t as usize;
                        } else {
                            self.stack.pop();
                        }
                    }
                    Op::JumpIfNotUndef(t) => {
                        if self.stack.last() != Some(&Slot::UNDEF) {
                            pc = t as usize;
                        }
                    }
                    Op::OptChain(t) => {
                        if self.top().is_nullish() {
                            self.stack.pop();
                            self.push(Value::Undef);
                            pc = t as usize;
                        }
                    }
                    Op::OptCall(t) => {
                        let n = self.stack.len();
                        if self.stack[n - 2].get().is_nullish() {
                            self.stack.truncate(n - 2);
                            self.push(Value::Undef);
                            pc = t as usize;
                        }
                    }

                    Op::Closure(idx) => {
                        let c = self.make_closure(idx);
                        self.push(c);
                    }
                    Op::Call(argc) => {
                        self.frames[fi].pc = pc;
                        if tri!(self.call_op(argc as usize)) {
                            continue 'outer;
                        }
                    }
                    Op::CallSpread => {
                        self.frames[fi].pc = pc;
                        let arr = self.pop();
                        let args = match &arr {
                            Value::Obj(id) => match &self.heap[*id as usize].kind {
                                Kind::Array(items) => crate::ops::without_holes(items),
                                _ => Vec::new(),
                            },
                            _ => Vec::new(),
                        };
                        let argc = args.len();
                        self.stack.extend(args.into_iter().map(Slot::pack));
                        if tri!(self.call_op(argc)) {
                            continue 'outer;
                        }
                    }
                    Op::New(argc) => {
                        self.frames[fi].pc = pc;
                        tri!(self.construct_op(argc as usize));
                    }
                    Op::NewSpread => {
                        self.frames[fi].pc = pc;
                        let arr = self.pop();
                        let args = match &arr {
                            Value::Obj(id) => match &self.heap[*id as usize].kind {
                                Kind::Array(items) => crate::ops::without_holes(items),
                                _ => Vec::new(),
                            },
                            _ => Vec::new(),
                        };
                        let argc = args.len();
                        self.stack.extend(args.into_iter().map(Slot::pack));
                        tri!(self.construct_op(argc));
                    }
                    Op::Return => {
                        let v = self.pop();
                        let frame = self.frames.pop().expect("frame");
                        self.stack.truncate(frame.base - 2);
                        self.handlers.truncate(frame.hbase as usize);
                        let result = match frame.kind {
                            FrameKind::Normal => v,
                            FrameKind::Async(c) => match self.coroutines[c as usize].promise {
                                Some(p) => {
                                    self.resolve_promise(p, v);
                                    Value::Obj(p)
                                }
                                None => {
                                    self.program_return(v);
                                    Value::Undef
                                }
                            },
                            FrameKind::Generator(g, resume) => {
                                self.leave_generator(g, None);
                                let is_base = frame.is_base;
                                self.spare_frames.push(frame);
                                if self.is_async_generator(g) {
                                    self.async_generator_finish(g, Ok(v));
                                    return Ok(Exit::Return(Slot::pack(Value::Undef)));
                                }
                                if is_base {
                                    return Ok(Exit::Return(Slot::pack(v)));
                                }
                                self.generator_done(resume, v);
                                continue 'outer;
                            }
                        };
                        let is_base = frame.is_base;
                        self.spare_frames.push(frame);
                        if is_base {
                            return Ok(Exit::Return(Slot::pack(result)));
                        }
                        self.push(result);
                        continue 'outer;
                    }
                    Op::GeneratorStart => {
                        let is_async = func.is_async;
                        let (pk, callee) = (self.names.prototype, self.stack[base - 2].get());
                        let proto = match callee {
                            Value::Obj(c) => self.get_obj(c, pk).as_obj(),
                            _ => None,
                        };
                        let proto = proto.unwrap_or(if is_async {
                            self.realm.async_generator_proto
                        } else {
                            self.realm.generator_proto
                        });
                        let g = self.alloc(Obj::new(Some(proto), Kind::Generator(GenState::Done)));
                        self.frames[fi].pc = pc;
                        let mut frame = self.frames.pop().expect("frame");
                        frame.kind = FrameKind::Generator(g, Resume::Iter);
                        frame.yield_pc = NO_YIELD;
                        let start = frame.base - 2;
                        let mut stack = Vec::with_capacity((self.stack.len() - start).max(16));
                        stack.extend(self.stack.drain(start..));
                        frame.base = 2;
                        let is_base = frame.is_base;
                        let state = GenState::Suspended(Box::new(SavedFrame {
                            frame: Some(frame),
                            stack,
                            handlers: Vec::new(),
                            started: false,
                        }));
                        self.heap[g as usize].kind = if is_async {
                            Kind::AsyncGenerator(Box::new(AsyncGen {
                                state,
                                phase: AsyncPhase::Start,
                                queue: VecDeque::new(),
                            }))
                        } else {
                            Kind::Generator(state)
                        };
                        if is_base {
                            return Ok(Exit::Return(Slot::pack(Value::Obj(g))));
                        }
                        self.push(Value::Obj(g));
                        continue 'outer;
                    }
                    Op::Await => {
                        let v = self.pop();
                        let c = match self.frames[fi].kind {
                            FrameKind::Async(c) => c,
                            FrameKind::Generator(g, _) if self.is_async_generator(g) => {
                                // An async generator is always resumed from native code, so `run` returns here.
                                self.frames[fi].pc = pc;
                                let frame = self.frames.pop().expect("frame");
                                self.leave_generator(g, Some(frame));
                                let p = self.promise_resolve(v);
                                self.perform_then(p, Reaction::AwaitGen(g));
                                return Ok(Exit::Return(Slot::pack(Value::Undef)));
                            }
                            _ => {
                                throw!(self.syntax_error("await is only valid in async functions"))
                            }
                        };
                        let reuse = self.coroutines[c as usize].saved.take();
                        let (saved, is_base) = self.save_top_frame(pc, true, reuse);
                        self.coroutines[c as usize].saved = Some(saved);
                        self.await_value(v, c);
                        let result = match self.coroutines[c as usize].promise {
                            Some(p) => Value::Obj(p),
                            None => Value::Undef,
                        };
                        if is_base {
                            return Ok(Exit::Return(Slot::pack(result)));
                        }
                        self.push(result);
                        continue 'outer;
                    }
                    Op::Yield(after) | Op::YieldDrop(after) | Op::YieldStar(after) => {
                        let v = self.pop();
                        let FrameKind::Generator(g, resume) = self.frames[fi].kind else {
                            throw!(self.syntax_error("yield is only valid in generators"));
                        };
                        let pushes = !matches!(op, Op::YieldDrop(_));
                        if let Resume::Collect(arr) = resume {
                            if let Kind::Array(items) = &mut self.heap[arr as usize].kind {
                                if items.len() >= crate::ops::MAX_ARRAY_LEN {
                                    throw!(self.range_error("Invalid array length."));
                                }
                                items.push(v);
                            }
                            if pushes {
                                self.stack.push(Slot::UNDEF);
                            }
                            pc = after as usize;
                            continue;
                        }
                        let at = pc - 1;
                        self.frames[fi].pc = after as usize;
                        self.frames[fi].yield_pc = at as u32;
                        if self.is_async_generator(g) {
                            // Answer the oldest request, then take the next queued one at once if there is one.
                            match self.async_generator_yielded(g, v) {
                                Some((REQ_NEXT, rv)) => {
                                    if pushes {
                                        self.push(rv);
                                    }
                                    pc = after as usize;
                                }
                                Some((REQ_RETURN, rv)) => {
                                    self.push(rv);
                                    pc = at + 1;
                                }
                                Some((_, rv)) => {
                                    if !matches!(op, Op::YieldStar(_)) {
                                        throw!(rv);
                                    }
                                    self.push(rv);
                                    pc = at + 2;
                                }
                                None => {
                                    let frame = self.frames.pop().expect("frame");
                                    self.leave_generator(g, Some(frame));
                                    return Ok(Exit::Yield(Slot::pack(v)));
                                }
                            }
                            continue;
                        }
                        let frame = self.frames.pop().expect("frame");
                        let is_base = frame.is_base;
                        self.leave_generator(g, Some(frame));
                        if is_base {
                            return Ok(Exit::Yield(Slot::pack(v)));
                        }
                        match resume {
                            Resume::Result => {
                                let r = self.iter_result(v, false);
                                self.push(r);
                            }
                            Resume::Delegate => {
                                self.push(v);
                                if let Some(f) = self.frames.last_mut() {
                                    f.pc += 1;
                                }
                            }
                            _ => self.push(v),
                        }
                        continue 'outer;
                    }

                    Op::Throw => {
                        let v = self.pop();
                        throw!(v);
                    }
                    Op::PushCatch(t) | Op::PushFinally(t) => {
                        let sp = (self.stack.len() - base) as u32;
                        self.handlers.push(Handler { pc: t, sp });
                    }
                    Op::PopTry => {
                        if self.handlers.len() > self.frames[fi].hbase as usize {
                            self.handlers.pop();
                        }
                    }

                    Op::GetIter(slot, ctx) => {
                        self.frames[fi].pc = pc;
                        let v = self.pop();
                        let it = tri!(self.get_iterator_in(&v, ctx));
                        let next = tri!(self.record_next(&it));
                        self.stack[base + slot as usize] = Slot::pack(it);
                        self.stack[base + slot as usize + 1] = Slot::pack(next);
                    }
                    Op::IterNext(slot, exit) => {
                        self.frames[fi].pc = pc;
                        let it = self.stack[base + slot as usize];
                        if let Some(g) = self.suspended_generator(it) {
                            if self.enter_generator(g, Resume::Iter, false) {
                                self.stack.push(Slot::UNDEF);
                            }
                            continue 'outer;
                        }
                        let it = it.get();
                        match step!(
                            slot,
                            self.iter_step_with(&it, self.stack[base + slot as usize + 1].get())
                        ) {
                            Some(v) => self.push(v),
                            None => {
                                self.stack[base + slot as usize] = Slot::UNDEF;
                                pc = exit as usize;
                            }
                        }
                    }
                    Op::DelegateCall(slot, flags, missing) => {
                        self.frames[fi].pc = pc;
                        let kind = flags & 3;
                        let received = self.stack.pop().unwrap_or_default();
                        let it = self.stack[base + slot as usize];
                        if flags & DELEGATE_ASYNC == 0 {
                            if kind == REQ_NEXT
                                && let Some(g) = self.suspended_generator(it)
                            {
                                if self.enter_generator(g, Resume::Delegate, false) {
                                    self.stack.push(received);
                                }
                                continue 'outer;
                            }
                            // Iterators the VM runs itself answer with a value and a done flag, not a result object.
                            if let Some(step) =
                                tri!(self.sync_delegate_step(it.get(), kind, received.get()))
                            {
                                match step {
                                    Some((v, done)) => {
                                        self.push(v);
                                        match code.get(pc) {
                                            Some(Op::DelegateResult(exit)) if done => {
                                                pc = *exit as usize
                                            }
                                            _ => pc += 1,
                                        }
                                    }
                                    None => {
                                        self.stack.push(received);
                                        pc = missing as usize;
                                    }
                                }
                                continue;
                            }
                        }
                        let arg = (flags & DELEGATE_NO_ARG == 0).then(|| received.get());
                        let next = self.stack[base + slot as usize + 1].get();
                        match tri!(self.delegate_call(it.get(), kind, arg, next)) {
                            Some(r) => self.push(r),
                            None => {
                                self.stack.push(received);
                                pc = missing as usize;
                            }
                        }
                    }
                    Op::DelegateResult(exit) => {
                        let r = self.pop();
                        let (v, done) = tri!(self.iter_result_parts(&r));
                        self.push(v);
                        if done {
                            pc = exit as usize;
                        }
                    }
                    Op::GetAsyncIter(slot) => {
                        self.frames[fi].pc = pc;
                        let v = self.pop();
                        let it = tri!(self.get_async_iterator(&v));
                        let next = tri!(self.record_next(&it));
                        self.stack[base + slot as usize] = Slot::pack(it);
                        self.stack[base + slot as usize + 1] = Slot::pack(next);
                    }
                    Op::AsyncClose(slot, skip) => {
                        self.frames[fi].pc = pc;
                        let it = std::mem::take(&mut self.stack[base + slot as usize]).get();
                        match tri!(self.async_close(it)) {
                            Some(r) => self.push(r),
                            None => pc = skip as usize,
                        }
                    }
                    Op::CheckObject => {
                        let v = self.top();
                        if !matches!(v, Value::Obj(_)) {
                            let d = self.describe(&v);
                            throw!(
                                self.type_error(&format!("Iterator result {d} is not an object"))
                            );
                        }
                    }
                    Op::IterStep(slot) => {
                        self.frames[fi].pc = pc;
                        let it = self.stack[base + slot as usize];
                        if let Some(g) = self.suspended_generator(it) {
                            if self.enter_generator(g, Resume::Iter, false) {
                                self.stack.push(Slot::UNDEF);
                            }
                            continue 'outer;
                        }
                        let it = it.get();
                        match step!(
                            slot,
                            self.iter_step_with(&it, self.stack[base + slot as usize + 1].get())
                        ) {
                            Some(v) => self.push(v),
                            None => {
                                self.stack[base + slot as usize] = Slot::UNDEF;
                                self.push(Value::Undef);
                            }
                        }
                    }
                    Op::IterRest(slot) => {
                        self.frames[fi].pc = pc;
                        let it = self.stack[base + slot as usize];
                        if let Some(g) = self.suspended_generator(it) {
                            let a = self.new_array(Vec::new());
                            self.push(a);
                            if self.enter_generator(
                                g,
                                Resume::Collect(a.as_obj().unwrap_or(0)),
                                false,
                            ) {
                                self.stack.push(Slot::UNDEF);
                            }
                            continue 'outer;
                        }
                        let it = it.get();
                        let mut items = Vec::new();
                        while let Some(v) = step!(
                            slot,
                            self.iter_step_with(&it, self.stack[base + slot as usize + 1].get())
                        ) {
                            items.push(v);
                        }
                        self.stack[base + slot as usize] = Slot::UNDEF;
                        let a = self.new_array(items);
                        self.push(a);
                    }
                    Op::IterClose(slot) | Op::IterCloseQuiet(slot) => {
                        self.frames[fi].pc = pc;
                        let it = std::mem::take(&mut self.stack[base + slot as usize]).get();
                        let r = self.iter_close(&it);
                        if matches!(op, Op::IterClose(_)) || self.fatal.is_some() {
                            tri!(r);
                        }
                    }
                    Op::ForIn(slot) => {
                        let v = self.pop();
                        if self.as_promise(&v).is_some() {
                            throw!(self.invalid_data(
                                "for...in received an un-awaited Promise; await it before inspecting the result."
                            ));
                        }
                        let keys = self.for_in_keys(&v);
                        let proto = self.realm.iter_proto;
                        let id = self.alloc(Obj::new(
                            Some(proto),
                            Kind::ListIter {
                                items: keys.into(),
                                pos: 0,
                            },
                        ));
                        self.stack[base + slot as usize] = Slot::pack(Value::Obj(id));
                    }
                }
            }
        }
    }

    fn protos_global_name(&self, g: u32) -> String {
        self.global_names
            .get(g as usize)
            .map(|a| self.atoms.text(*a).to_owned())
            .unwrap_or_default()
    }

    #[inline(never)]
    fn tdz_error(&mut self, name: Atom) -> Value {
        let n = self.atoms.text(name).to_owned();
        self.reference_error(&format!("Cannot access '{n}' before initialization"))
    }

    #[inline(never)]
    fn program_return(&mut self, v: Value) {
        let thenable = match &v {
            Value::Obj(id) => {
                matches!(self.heap[*id as usize].kind, Kind::Promise(_)) || {
                    let then = self.names.then;
                    let t = self.get_obj(*id, then);
                    self.is_callable(&t)
                }
            }
            _ => false,
        };
        if thenable {
            let p = self.promise_resolve(v);
            self.perform_then(p, Reaction::Program);
        } else {
            self.outcome = Some(Ok(v));
        }
    }

    // ---------- driver ----------

    /// Runs queued jobs and delivers tool results until the program has an outcome.
    pub fn drive(&mut self) -> Result<(), Value> {
        loop {
            if self.outcome.is_some() {
                return Ok(());
            }
            if self.suspended {
                return Ok(());
            }
            if self.suspend_wanted
                || self
                    .host
                    .shared
                    .requested
                    .load(std::sync::atomic::Ordering::Relaxed)
            {
                self.suspended = true;
                return Ok(());
            }
            if self.fatal.is_some() {
                return Err(Value::Undef);
            }
            if let Some(job) = self.jobs.pop_front() {
                self.tick()?;
                self.run_job(job)?;
                continue;
            }
            if let Some((p, outcome)) = self.inbox.pop_front() {
                self.check_time()?;
                crate::host::settle(self, p, outcome);
                continue;
            }
            if self.host.waiting() {
                return Ok(());
            }
            let e = self.make_error(
                self.realm.error_proto,
                "The program is waiting on a promise that can never settle: nothing else is running, so nothing can resolve it.",
            );
            self.outcome = Some(Err(e));
            return Ok(());
        }
    }
}

#[inline(always)]
fn compare(op: Arith, x: f64, y: f64) -> bool {
    match op {
        Arith::Lt => x < y,
        Arith::Le => x <= y,
        Arith::Gt => x > y,
        Arith::Ge => x >= y,
        Arith::StrictEq => x == y,
        Arith::StrictNe => x != y,
        _ => false,
    }
}

#[inline]
fn to_i32(x: f64) -> i32 {
    crate::value::to_int32(x)
}

#[inline]
fn to_u32(x: f64) -> u32 {
    crate::value::to_uint32(x)
}

pub fn js_rem(x: f64, y: f64) -> f64 {
    const EXACT: f64 = 9_007_199_254_740_992.0;
    if x.fract() == 0.0 && y.fract() == 0.0 && x.abs() < EXACT && y.abs() < EXACT && y != 0.0 {
        let r = (x as i64 % y as i64) as f64;
        return if r == 0.0 && x.is_sign_negative() {
            -0.0
        } else {
            r
        };
    }
    if y == 0.0 || x.is_infinite() || x.is_nan() || y.is_nan() {
        return f64::NAN;
    }
    if y.is_infinite() {
        return x;
    }
    x % y
}

/// `**` and `Math.pow` as JavaScriptCore computes them: square roots for ±0.5, square-and-multiply for small
/// non-negative integer exponents, and libm otherwise, so results match the reference to the last bit.
pub fn js_pow(x: f64, y: f64) -> f64 {
    if y.is_nan() || ((x == 1.0 || x == -1.0) && y.is_infinite()) {
        return f64::NAN;
    }
    let abs = x.abs();
    if y == 0.5 {
        return if abs == 0.0 {
            0.0
        } else if abs == f64::INFINITY {
            f64::INFINITY
        } else {
            x.sqrt()
        };
    }
    if y == -0.5 {
        return if abs == 0.0 {
            f64::INFINITY
        } else if abs == f64::INFINITY {
            0.0
        } else {
            1.0 / x.sqrt()
        };
    }
    if y.fract() == 0.0 && (0.0..=1000.0).contains(&y) {
        let (mut n, mut result, mut base) = (y as u32, 1.0, x);
        while n != 0 {
            if n & 1 == 1 {
                result *= base;
            }
            base *= base;
            n >>= 1;
        }
        return result;
    }
    x.powf(y)
}
