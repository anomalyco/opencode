//! The stack machine: frames, calls, exceptions, suspension and the run loop.

use std::collections::{BTreeMap, VecDeque};
use std::rc::Rc;
use std::time::Instant;

use rustc_hash::FxHashMap;

use crate::bytecode::{Arith, Capture, FuncProto, Op, Program};
use crate::object::*;
use crate::strings::{StrId, Strings};
use crate::value::{Id, Slot, Value};
use crate::{DiagnosticKind, Json, Limits, ToolCall, ToolFn};

pub type Res = Result<Value, Value>;
/// A tool call's result as it waits to settle its promise.
pub type ToolOutcome = Result<Json, (DiagnosticKind, String)>;
pub type NativeFn = fn(&mut Vm, Value, &[Value], Id) -> Res;

pub const MAX_DEPTH: usize = 10_000;
const MAX_OBJECTS: usize = 2_000_000;
const MAX_STRINGS: usize = 4_000_000;
const MAX_NATIVE_DEPTH: usize = 400;
const FUEL: u32 = 20_000;

#[derive(Clone, Copy)]
pub struct Handler {
    pc: u32,
    sp: u32,
    finally: bool,
}

#[derive(Clone, Copy, PartialEq)]
pub enum FrameKind {
    Normal,
    Async(u32),
    Generator(Id),
}

pub struct Frame {
    pub func: Rc<FuncProto>,
    pub pc: usize,
    pub base: usize,
    pub cells: Vec<u32>,
    pub upvals: Rc<[u32]>,
    pub handlers: Vec<Handler>,
    pub extra: Vec<Value>,
    pub argc: u32,
    pub kind: FrameKind,
    pub is_base: bool,
}

/// A suspended frame and its stack segment. The box is kept while the frame runs, so suspending again allocates
/// nothing.
pub struct SavedFrame {
    pub frame: Option<Frame>,
    pub stack: Vec<Slot>,
    pub started: bool,
}

pub enum Exit {
    Return(Value),
    Yield(Value),
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
    pub iter_proto: Id,
    pub tools: Id,
}

pub struct Vm<'rt> {
    pub heap: Vec<Obj>,
    pub cells: Vec<Slot>,
    pub atoms: Strings,
    pub stack: Vec<Slot>,
    pub frames: Vec<Frame>,
    spare_frames: Vec<Frame>,
    pub realm: Realm,
    pub names: Names,
    pub globals: Vec<Value>,
    pub global_names: Vec<Atom>,
    pub global_map: FxHashMap<Atom, Value>,
    pub consts: Vec<Value>,
    pub protos: Vec<Rc<FuncProto>>,
    pub jobs: VecDeque<Job>,
    pub inbox: VecDeque<(Id, ToolOutcome)>,
    pub coroutines: Vec<Coroutine>,
    pub logs: Vec<String>,
    pub tool_calls: Vec<ToolCall>,
    pub tools: &'rt BTreeMap<String, ToolFn>,
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
}

impl<'rt> Vm<'rt> {
    pub fn new(tools: &'rt BTreeMap<String, ToolFn>, limits: Limits, atoms: Strings) -> Self {
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
            realm: Realm::default(),
            names,
            globals: Vec::new(),
            global_names: Vec::new(),
            global_map: FxHashMap::default(),
            consts: Vec::new(),
            protos: Vec::new(),
            jobs: VecDeque::new(),
            inbox: VecDeque::new(),
            coroutines: Vec::new(),
            logs: Vec::new(),
            tool_calls: Vec::new(),
            tools,
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
        }
    }

    pub fn load(&mut self, program: Program) {
        self.consts = program.consts;
        self.protos = program.protos;
        self.globals = program
            .globals
            .iter()
            .map(|a| self.global_map.get(a).cloned().unwrap_or(Value::Uninit))
            .collect();
        self.global_names = program.globals;
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
            return self.check_time();
        }
        Ok(())
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
                format!("Execution exceeded its timeout of {ms} ms."),
            ));
            return Err(Value::Undef);
        }
        Ok(())
    }

    // ---------- calls ----------

    /// Calls any callable value from native code and runs it to completion (or its first suspension).
    pub fn call(&mut self, f: &Value, this: Value, args: &[Value]) -> Res {
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
                    Ok(Exit::Return(v)) | Ok(Exit::Yield(v)) => Ok(v),
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
        let mut extra = Vec::new();
        if argc > np {
            if proto.needs_extra {
                extra = self.stack.drain(base + np..).map(Slot::get).collect();
            } else {
                self.stack.truncate(base + np);
            }
        }
        self.stack
            .resize(base + proto.nlocals as usize, Slot::UNDEF);
        let kind = if proto.is_async {
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
        let ncells = proto.ncells as usize;
        // Reuse a retired frame and write its fields in place: building a fresh one on the stack and copying it in
        // stalls on store forwarding.
        match self.spare_frames.pop() {
            Some(spare) => {
                self.frames.push(spare);
                let f = self.frames.last_mut().expect("frame");
                f.func = proto;
                f.pc = 0;
                f.base = base;
                f.cells.clear();
                f.cells.resize(ncells, 0);
                f.upvals = upvals;
                f.handlers.clear();
                f.extra = extra;
                f.argc = argc as u32;
                f.kind = kind;
                f.is_base = is_base;
            }
            None => self.frames.push(Frame {
                func: proto,
                pc: 0,
                base,
                cells: vec![0; ncells],
                upvals,
                handlers: Vec::new(),
                extra,
                argc: argc as u32,
                kind,
                is_base,
            }),
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
        let p = self.new_promise();
        let outcome = self.invoke_tool(path, args);
        self.inbox.push_back((p, outcome));
        Ok(Value::Obj(p))
    }

    fn invoke_tool(
        &mut self,
        path: &str,
        args: &[Value],
    ) -> Result<Json, (DiagnosticKind, String)> {
        if args.len() > 1 {
            return Err((
                DiagnosticKind::InvalidDataValue,
                format!("Tool '{path}' expects at most one input object."),
            ));
        }
        let tools = self.tools;
        let Some(tool) = tools.get(path) else {
            let under = format!("{path}.");
            let message = if tools.keys().any(|k| k.starts_with(&under)) {
                format!("Tool '{path}' is not callable, it is a namespace.")
            } else {
                format!("Unknown tool '{path}'.")
            };
            return Err((DiagnosticKind::UnknownTool, message));
        };
        let input = match args.first() {
            None => Json::Object(serde_json::Map::new()),
            Some(v) => match crate::convert::to_json(self, v) {
                Ok(j) => j,
                Err(e) => {
                    let msg = self.error_text(&e);
                    return Err((
                        DiagnosticKind::InvalidDataValue,
                        format!("Invalid input for tool '{path}': {msg}"),
                    ));
                }
            },
        };
        if let Some(max) = self.limits.max_tool_calls
            && self.tool_calls.len() as u64 >= max
        {
            return Err((
                DiagnosticKind::ToolCallLimitExceeded,
                format!("Execution exceeded its tool-call limit of {max}."),
            ));
        }
        self.tool_calls.push(ToolCall {
            path: path.to_owned(),
            input: input.clone(),
        });
        tool(&input).map_err(|m| (DiagnosticKind::ToolFailure, m))
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

    fn is_return_signal(&self, e: &Value) -> bool {
        matches!(e, Value::Obj(id) if matches!(self.heap[*id as usize].kind, Kind::ReturnSignal(_)))
    }

    /// Unwinds to the nearest handler. `Err` carries what `run` must return when the base frame is left.
    #[inline(never)]
    fn handle_throw(&mut self, e: Value) -> Result<(), Result<Exit, Value>> {
        let fatal = self.fatal.is_some();
        let returning = self.is_return_signal(&e);
        loop {
            let Some(f) = self.frames.last_mut() else {
                return Err(Err(e));
            };
            if !fatal {
                while let Some(h) = f.handlers.pop() {
                    if returning && !h.finally {
                        continue;
                    }
                    let sp = f.base + h.sp as usize;
                    f.pc = h.pc as usize;
                    self.stack.truncate(sp);
                    self.push(e);
                    return Ok(());
                }
            }
            let frame = self.frames.pop().expect("frame");
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
                        return Err(Ok(Exit::Return(result)));
                    }
                    self.push(result);
                    return Ok(());
                }
                FrameKind::Generator(g) => {
                    self.heap[g as usize].kind = Kind::Generator(GenState::Done);
                    if returning && !fatal {
                        let v = match &self.heap[e.as_obj().unwrap_or(0) as usize].kind {
                            Kind::ReturnSignal(v) => *v,
                            _ => Value::Undef,
                        };
                        return Err(Ok(Exit::Return(v)));
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
                started,
            })
        });
        saved.stack.clear();
        saved.stack.extend(self.stack.drain(frame.base - 2..));
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
        self.stack.append(&mut saved.stack);
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

    pub fn resume_generator(&mut self, g: Id, mode: u8, v: Value) -> Result<(Value, bool), Value> {
        let state = std::mem::replace(
            &mut self.heap[g as usize].kind,
            Kind::Generator(GenState::Done),
        );
        let mut saved = match state {
            Kind::Generator(GenState::Suspended(s)) => s,
            Kind::Generator(GenState::Running(b)) => {
                self.heap[g as usize].kind = Kind::Generator(GenState::Running(b));
                return Err(self.type_error("Generator is already running"));
            }
            other => {
                self.heap[g as usize].kind = other;
                return match mode {
                    0 => Ok((Value::Undef, true)),
                    1 => Ok((v, true)),
                    _ => Err(v),
                };
            }
        };
        if !saved.started && mode != 0 {
            self.heap[g as usize].kind = Kind::Generator(GenState::Done);
            return if mode == 1 { Ok((v, true)) } else { Err(v) };
        }
        let started = saved.started;
        self.restore_frame(&mut saved);
        self.heap[g as usize].kind = Kind::Generator(GenState::Running(Some(saved)));
        let r = match mode {
            0 => {
                if started {
                    self.push(v);
                }
                self.run()
            }
            _ => {
                let e = if mode == 1 {
                    let proto = self.realm.object_proto;
                    Value::Obj(self.alloc(Obj::new(Some(proto), Kind::ReturnSignal(v))))
                } else {
                    v
                };
                match self.handle_throw(e) {
                    Ok(()) => self.run(),
                    Err(r) => r,
                }
            }
        };
        match r {
            Ok(Exit::Yield(y)) => Ok((y, false)),
            Ok(Exit::Return(v)) => {
                self.heap[g as usize].kind = Kind::Generator(GenState::Done);
                Ok((v, true))
            }
            Err(e) => {
                self.heap[g as usize].kind = Kind::Generator(GenState::Done);
                Err(e)
            }
        }
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

    #[inline(never)]
    fn make_closure(&mut self, idx: u32) -> Value {
        let proto = self.protos[idx as usize].clone();
        let f = self.frames.last().expect("frame");
        let upvals: Rc<[u32]> = proto
            .captures
            .iter()
            .map(|c| match c {
                Capture::Cell(i) => f.cells[*i as usize],
                Capture::Upval(i) => f.upvals[*i as usize],
            })
            .collect();
        let this = if proto.is_arrow {
            self.stack[f.base - 1].get()
        } else {
            Value::Undef
        };
        let fp = self.realm.function_proto;
        Value::Obj(self.alloc(Obj::new(
            Some(fp),
            Kind::Closure(Box::new(Closure {
                proto,
                upvals,
                this,
            })),
        )))
    }

    pub fn run(&mut self) -> Result<Exit, Value> {
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
                    let r = match (&a, &b) {
                        (Value::Num(x), Value::Num(y)) => *x $op *y,
                        (Value::Str(x), Value::Str(y)) => self.atoms.get(*x) $op self.atoms.get(*y),
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
                        let c = self.cells.len() as u32 - 1;
                        self.frames[fi].cells[i as usize] = c;
                    }
                    Op::GetCell(i) => {
                        let c = self.frames[fi].cells[i as usize];
                        let v = self.cells[c as usize];
                        self.stack.push(v);
                    }
                    Op::GetCellChk(i, name) => {
                        let c = self.frames[fi].cells[i as usize];
                        let v = self.cells[c as usize];
                        if v == Slot::UNINIT {
                            throw!(self.tdz_error(name));
                        }
                        self.stack.push(v);
                    }
                    Op::SetCell(i) => {
                        let v = self.stack.pop().unwrap_or_default();
                        let c = self.frames[fi].cells[i as usize];
                        self.cells[c as usize] = v;
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
                        let extra = self.frames[fi].extra.clone();
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
                        let src = self.pop();
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
                        let r = tri!(self.loose_eq(&a, &b));
                        self.push(Value::Bool(r));
                    }
                    Op::Ne => {
                        let b = self.pop();
                        let a = self.pop();
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
                        let x = match a {
                            Value::Num(x) => x,
                            _ => tri!(self.number_of(&a)),
                        };
                        self.push(Value::Num(-x));
                    }
                    Op::ToNumber | Op::ToNumeric => {
                        let a = self.pop();
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
                        let x = tri!(self.number_of(&a));
                        self.push(Value::Num(!to_i32(x) as f64));
                    }
                    Op::Typeof => {
                        let a = self.pop();
                        let t = self.type_of(&a);
                        let t = self.static_str(t);
                        self.push(t);
                    }
                    Op::Inc | Op::Dec => {
                        let a = self.pop();
                        let x = match a {
                            Value::Num(x) => x,
                            _ => tri!(self.number_of(&a)),
                        };
                        self.push(Value::Num(if op == Op::Inc { x + 1.0 } else { x - 1.0 }));
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
                        let parts: Vec<Value> = self
                            .stack
                            .drain(self.stack.len() - n as usize..)
                            .map(Slot::get)
                            .collect();
                        let mut len = 0;
                        for p in &parts {
                            if let Value::Str(s) = p {
                                len += self.atoms.get(*s).len();
                            }
                        }
                        let mut out = String::with_capacity(len);
                        for p in &parts {
                            if let Value::Str(s) = p {
                                out.push_str(self.atoms.get(*s));
                            }
                        }
                        let v = self.string_val(out);
                        self.push(v);
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
                                let mut buf = std::mem::take(&mut self.atoms.bufs[sa as usize].s);
                                buf.to_mut().push_str(self.atoms.get(sb));
                                let ascii = self.atoms.bufs[sb as usize].ascii;
                                let entry = &mut self.atoms.bufs[sa as usize];
                                entry.s = buf;
                                entry.ascii &= ascii;
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
                            let x = tri!(self.number_of(&v.get()));
                            self.stack[slot] = Slot::num(x + 1.0);
                        }
                    }

                    Op::Jump(t) => {
                        if (t as usize) < pc {
                            tri!(self.tick());
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
                    Op::JumpIfTrue(t) => {
                        let v = self.pop();
                        if self.truthy(&v) {
                            if (t as usize) < pc {
                                tri!(self.tick());
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
                                Kind::Array(items) => items.clone(),
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
                                Kind::Array(items) => items.clone(),
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
                            FrameKind::Generator(g) => {
                                self.heap[g as usize].kind = Kind::Generator(GenState::Done);
                                v
                            }
                        };
                        let is_base = frame.is_base;
                        self.spare_frames.push(frame);
                        if is_base {
                            return Ok(Exit::Return(result));
                        }
                        self.push(result);
                        continue 'outer;
                    }
                    Op::GeneratorStart => {
                        let proto = self.realm.generator_proto;
                        let g = self.alloc(Obj::new(Some(proto), Kind::Generator(GenState::Done)));
                        self.frames[fi].kind = FrameKind::Generator(g);
                        let (saved, is_base) = self.save_top_frame(pc, false, None);
                        self.heap[g as usize].kind = Kind::Generator(GenState::Suspended(saved));
                        if is_base {
                            return Ok(Exit::Return(Value::Obj(g)));
                        }
                        self.push(Value::Obj(g));
                        continue 'outer;
                    }
                    Op::Await => {
                        let v = self.pop();
                        let FrameKind::Async(c) = self.frames[fi].kind else {
                            throw!(self.syntax_error("await is only valid in async functions"));
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
                            return Ok(Exit::Return(result));
                        }
                        self.push(result);
                        continue 'outer;
                    }
                    Op::Yield => {
                        let v = self.pop();
                        let FrameKind::Generator(g) = self.frames[fi].kind else {
                            throw!(self.syntax_error("yield is only valid in generators"));
                        };
                        let reuse = match std::mem::replace(
                            &mut self.heap[g as usize].kind,
                            Kind::Generator(GenState::Done),
                        ) {
                            Kind::Generator(GenState::Running(b)) => b,
                            _ => None,
                        };
                        let (saved, _) = self.save_top_frame(pc, true, reuse);
                        self.heap[g as usize].kind = Kind::Generator(GenState::Suspended(saved));
                        return Ok(Exit::Yield(v));
                    }

                    Op::Throw => {
                        let v = self.pop();
                        throw!(v);
                    }
                    Op::PushCatch(t) | Op::PushFinally(t) => {
                        let sp = (self.stack.len() - base) as u32;
                        self.frames[fi].handlers.push(Handler {
                            pc: t,
                            sp,
                            finally: matches!(op, Op::PushFinally(_)),
                        });
                    }
                    Op::PopTry => {
                        self.frames[fi].handlers.pop();
                    }

                    Op::GetIter(slot) => {
                        self.frames[fi].pc = pc;
                        let v = self.pop();
                        let it = tri!(self.get_iterator(&v));
                        self.stack[base + slot as usize] = Slot::pack(it);
                    }
                    Op::IterNext(slot, exit) => {
                        self.frames[fi].pc = pc;
                        let it = self.stack[base + slot as usize].get();
                        match tri!(self.iter_step(&it)) {
                            Some(v) => self.push(v),
                            None => {
                                self.stack[base + slot as usize] = Slot::UNDEF;
                                pc = exit as usize;
                            }
                        }
                    }
                    Op::DelegateNext(slot, exit) => {
                        self.frames[fi].pc = pc;
                        let it = self.stack[base + slot as usize].get();
                        let (v, done) = tri!(self.delegate_step(&it));
                        self.push(v);
                        if done {
                            self.stack[base + slot as usize] = Slot::UNDEF;
                            pc = exit as usize;
                        }
                    }
                    Op::IterStep(slot) => {
                        self.frames[fi].pc = pc;
                        let it = self.stack[base + slot as usize].get();
                        match tri!(self.iter_step(&it)) {
                            Some(v) => self.push(v),
                            None => {
                                self.stack[base + slot as usize] = Slot::UNDEF;
                                self.push(Value::Undef);
                            }
                        }
                    }
                    Op::IterRest(slot) => {
                        self.frames[fi].pc = pc;
                        let it = self.stack[base + slot as usize].get();
                        let mut items = Vec::new();
                        while let Some(v) = tri!(self.iter_step(&it)) {
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
                match outcome {
                    Ok(json) => {
                        let v = crate::convert::from_json(self, &json);
                        self.fulfill(p, v);
                    }
                    Err((kind, message)) => {
                        let proto = self.realm.error_proto;
                        let e = self.make_error(proto, &message);
                        if let Value::Obj(id) = e {
                            self.heap[id as usize].kind = Kind::Error(Some(Box::new(Failure {
                                kind,
                                message,
                                offset: None,
                            })));
                        }
                        self.reject(p, e);
                    }
                }
                continue;
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

pub fn js_pow(x: f64, y: f64) -> f64 {
    if y.is_nan() || ((x == 1.0 || x == -1.0) && y.is_infinite()) {
        return f64::NAN;
    }
    x.powf(y)
}
