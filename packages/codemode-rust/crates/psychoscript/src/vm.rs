//! The stack machine: frames, calls, exceptions, suspension and the run loop.

use std::collections::VecDeque;
use std::sync::Arc;
use std::time::Instant;

use rustc_hash::FxHashMap;

use crate::bytecode::{Arith, Capture, FuncProto, Op, Program, TemplateSite};
use crate::compiler::{DELEGATE_ASYNC, DELEGATE_NO_ARG};
use crate::conversion::code;
use crate::object::*;
use crate::strings::{StrId, Strings};
use crate::value::{Id, Slot, Value};
use crate::{DiagnosticKind, Limits};

pub type Res = Result<Value, Value>;

pub type NativeFn = fn(&mut Vm, Value, &[Value], Id) -> Res;

pub const MAX_DEPTH: usize = 10_000;
const MAX_OBJECTS: usize = 2_000_000;
pub(crate) const MAX_STRINGS: usize = 4_000_000;
const MAX_NATIVE_DEPTH: usize = 400;
pub(crate) const FUEL: i32 = 20_000;
/// The reference's fuel: it starts the host calls a program queued whenever this runs out, so streaming responses
/// count it the same way. A loop back-edge, a function call or a job costs one, a call of a native function fifty.
pub(crate) const HANDOVER_FUEL: i32 = 10_000;
pub(crate) const NATIVE_FUEL: i32 = 50;

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
    /// A built-in that calls back into the program (see `native.rs`), by its step function, and for a family's op
    /// (`NativeOp::Arrays`, ...) which of the family's steps.
    Native(crate::native::NativeOp, u16),
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
    /// To the native frame that resumed it (see `native.rs`): a yielded value as a call's result, the completion as
    /// `Input::Finished`.
    Native,
}

pub struct Frame {
    pub func: Arc<FuncProto>,
    pub pc: usize,
    pub base: usize,
    pub upvals: Arc<[u32]>,
    /// Where this frame's exception handlers start in `Vm::handlers`.
    pub hbase: u32,
    /// Arguments beyond the declared parameters, kept for rest parameters and `arguments`.
    pub extra: Box<[Value]>,
    pub argc: u32,
    pub kind: FrameKind,
    pub is_base: bool,
    /// Where a generator's frame last yielded, or `NO_YIELD` before its first `yield`.
    pub yield_pc: u32,
    /// The frames that count toward the call-stack limit up to this one, itself included: see `program_depth`. Set
    /// when the frame is pushed (`push_frame`).
    pub depth: u32,
}

pub const NO_YIELD: u32 = u32::MAX;

/// A `SavedFrame::splits` entry first: the parked frames start with an async generator's, run on its own stack.
const GENERATOR_FIRST: u32 = u32::MAX;

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
    /// The frames above `frame` that wait with it, a host call's wait parked them (see `Vm::park_frames`): their `base`
    /// and `hbase` are relative to `frame`'s.
    // Boxed as the job stack holds them, so parking and restoring move the boxes instead of copying frames.
    #[allow(clippy::vec_box)]
    pub above: Vec<Box<Frame>>,
    /// For each generator frame among `above` (by its index there), where in `stack` that generator's own stack
    /// starts: a running generator runs on its own stack, so the frames a wait parked across one are kept as one
    /// segment and split again when they are restored (see `park_frames`).
    pub splits: Vec<(u32, u32)>,
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
    /// Resume the crossing to the host (`cross`) that awaited.
    Cross(Id),
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
    pub std: crate::builtins::StdProtos,
}

pub struct Vm {
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
    pub protos: Vec<Arc<FuncProto>>,
    pub jobs: VecDeque<Job>,
    pub inbox: VecDeque<(Id, crate::host::Settlement)>,
    pub coroutines: Vec<Coroutine>,
    pub logs: Vec<String>,
    pub host: crate::host::RunHost,
    pub limits: Limits,
    pub start: Instant,
    /// Steps left before `budget_out`: the nearer of the reference's fuel and this VM's own check of the clock and of
    /// suspend requests, both kept in `host.meter`.
    budget: i32,
    pub fatal: Option<(DiagnosticKind, String)>,
    pub outcome: Option<Result<Value, Value>>,
    /// The program's result once it has crossed to the host.
    pub result_json: Option<crate::Json>,
    /// A host call waiting for promises in its arguments parks its frames (see `park_frames`) with this coroutine.
    pub(crate) park: bool,
    pub(crate) park_coroutine: u32,
    native_depth: usize,
    /// Address near the bottom of the native stack this run started on, and how much of it calls may use.
    pub stack_base: usize,
    pub stack_budget: usize,
    arg_pool: Vec<Vec<Value>>,
    /// The parts of a `Concat` instruction, kept between them so joining allocates no list.
    concat_parts: Vec<StrId>,
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
    /// The native `JSON.stringify` walk running now, which stamps the objects it visits (`Obj::visit`), or 0. One
    /// nested in it keeps a set instead.
    pub(crate) json_walk: u32,
    json_walks: u32,
    /// The code of every native frame (see `native.rs`).
    pub(crate) native_proto: Arc<FuncProto>,
    no_upvals: Arc<[u32]>,
    /// Set by a built-in that pushed a native frame instead of returning its result (`enter_native`).
    pub(crate) entered: bool,
    /// Set while a built-in called from bytecode or a convert frame's rerun runs: a conversion that calls the
    /// program is then restarted instead of made inline (see `conversion.rs`).
    pub(crate) convert_ok: bool,
    /// The conversion a restartable run asked for.
    pub(crate) convert_req: Option<crate::conversion::Request>,
    /// The answers a rerun takes in order, and what the meter was when it started.
    pub(crate) replay: VecDeque<Value>,
    pub(crate) replay_meter: Option<crate::conversion::Meter>,
}

impl Vm {
    pub fn new(host: crate::host::RunHost, limits: Limits, atoms: Strings) -> Self {
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
            host,
            limits,
            start: Instant::now(),
            budget: HANDOVER_FUEL,
            fatal: None,
            outcome: None,
            result_json: None,
            park: false,
            park_coroutine: 0,
            native_depth: 0,
            json_walk: 0,
            json_walks: 0,
            stack_base: 0,
            stack_budget: usize::MAX,
            arg_pool: Vec::new(),
            concat_parts: Vec::new(),
            char_strs,
            rng: seed | 1,
            suspend_wanted: false,
            suspended: false,
            roundtrip_every: 0,
            run_depth: 0,
            resumable_run: false,
            snapshot_base: crate::snapshot::Base::default(),
            resumed: false,
            native_proto: Arc::new(crate::native::proto()),
            no_upvals: Arc::from([]),
            entered: false,
            convert_ok: false,
            convert_req: None,
            replay: VecDeque::new(),
            replay_meter: None,
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
            self.settle_budget();
            self.host.meter.fuel = 1;
            self.rebudget();
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
            None => self.string_val(crate::strings::from_units(&[c])),
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
                site: Default::default(),
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

    /// The `SyntaxError` that syntax the language does not support throws when it runs, named by its ESTree node type.
    #[cold]
    fn unsupported_syntax(&mut self, kind: &str) -> Value {
        let p = self.realm.syntax_error_proto;
        let help = crate::compiler::SUPPORTED_SYNTAX;
        let msg = format!("Syntax '{kind}' is not supported. {help}");
        let e = self.failure(p, &msg, DiagnosticKind::UnsupportedSyntax);
        if let Value::Obj(id) = e {
            self.host.suggestions.insert(id, vec![help.into()]);
        }
        e
    }

    // ---------- fuel and limits ----------

    /// A back-edge, a function call or a job.
    #[inline]
    fn tick(&mut self) -> Result<(), Value> {
        self.budget -= 1;
        if self.budget <= 0 {
            return self.budget_out(true);
        }
        Ok(())
    }

    /// The reference's fuel alone, spent where the clock is not checked: a native call costs this VM's own count
    /// nothing.
    #[inline]
    fn spend(&mut self, n: i32) {
        self.budget -= n;
        self.host.meter.fuel += n;
        if self.budget <= 0 {
            let _ = self.budget_out(false);
        }
    }

    #[cold]
    fn budget_out(&mut self, check: bool) -> Result<(), Value> {
        self.settle_budget();
        // A replay's fuel is given back when it ends (see `conversion.rs`): it starts nothing meanwhile.
        let replaying = self.replay_meter.is_some();
        if self.host.meter.handover <= 0 {
            self.host.meter.handover = HANDOVER_FUEL;
            if !replaying {
                self.handover();
            }
        }
        let mut r = Ok(());
        if check && !replaying && self.host.meter.fuel <= 0 {
            self.host.meter.fuel = FUEL;
            self.checkpoint();
            r = self.check_time();
        }
        self.rebudget();
        r
    }

    /// The step budget and the meter, as a replay saves them.
    pub(crate) fn meter_state(&self) -> crate::conversion::Meter {
        let m = &self.host.meter;
        [self.budget, m.start, m.handover, m.fuel]
    }

    pub(crate) fn set_meter_state(&mut self, s: crate::conversion::Meter) {
        self.budget = s[0];
        self.host.meter.start = s[1];
        self.host.meter.handover = s[2];
        self.host.meter.fuel = s[3];
    }

    /// Charges what was spent since the budget was set to both counters.
    fn settle_budget(&mut self) {
        let used = self.host.meter.start - self.budget;
        self.host.meter.handover -= used;
        self.host.meter.fuel -= used;
        self.host.meter.start = self.budget;
    }

    fn rebudget(&mut self) {
        let b = self.host.meter.handover.min(self.host.meter.fuel).max(1);
        self.budget = b;
        self.host.meter.start = b;
    }

    /// A native call from bytecode costs fifty, unless the built-in is one the reference writes in its bytecode
    /// prelude, which spent that bytecode's fuel itself (see `builtins/fuel.rs`).
    #[inline]
    fn native_spent(&mut self) {
        if !std::mem::take(&mut self.host.meter.bytecode) {
            self.spend(NATIVE_FUEL);
        }
    }

    /// A back-edge of a built-in's loop, which the reference's bytecode runs: it counts for this VM's own checks
    /// too, as a back-edge of the program's does.
    #[inline]
    pub(crate) fn fuel_step(&mut self) {
        self.budget -= 1;
        if self.budget <= 0 {
            let _ = self.budget_out(false);
        }
    }

    /// Fuel a built-in spends where the reference's bytecode for it would: see `builtins/fuel.rs`.
    #[inline]
    pub(crate) fn fuel(&mut self, n: i32) {
        self.spend(n);
    }

    /// `n` back-edges at once, as one at a time would spend them, where no program code runs between them.
    pub(crate) fn fuel_steps(&mut self, n: usize) {
        if n == 0 {
            return;
        }
        self.settle_budget();
        let left = self.host.meter.handover as u64;
        let n = n as u64;
        if n < left {
            self.host.meter.handover = (left - n) as i32;
        } else {
            let past = ((n - left) % HANDOVER_FUEL as u64) as i32;
            self.host.meter.handover = HANDOVER_FUEL - past;
            self.handover();
        }
        self.rebudget();
    }

    /// Ends a built-in the reference writes in bytecode: its call costs no native call's fifty.
    #[inline]
    pub(crate) fn bytecode_builtin(&mut self) {
        self.host.meter.bytecode = true;
    }

    /// Calls `f` as the reference's bytecode calls a callback: a native costs fifty, unless it is itself written in
    /// bytecode there.
    #[inline(always)]
    pub(crate) fn call_counted(&mut self, f: &Value, this: Value, args: &[Value]) -> Res {
        if let Value::Obj(id) = *f
            && !matches!(self.heap[id as usize].kind, Kind::Closure(_))
        {
            return self.call_counted_other(f, this, args);
        }
        self.call(f, this, args)
    }

    /// `call_counted` of anything but a closure, which costs its frame's unit itself.
    #[inline(never)]
    fn call_counted_other(&mut self, f: &Value, this: Value, args: &[Value]) -> Res {
        if let Value::Obj(id) = *f {
            match &self.heap[id as usize].kind {
                Kind::Native { f, .. } => {
                    let f = *f;
                    if self.native_depth >= MAX_NATIVE_DEPTH {
                        return Err(self.range_error("Maximum call stack size exceeded"));
                    }
                    self.native_depth += 1;
                    self.host.meter.counted = true;
                    let r = f(self, this, args, id);
                    if self.entered {
                        let r = self.drive_entered(true);
                        self.native_depth -= 1;
                        return r;
                    }
                    self.native_depth -= 1;
                    let r = r?;
                    self.native_spent();
                    return Ok(r);
                }
                Kind::Bound(b) => {
                    let (target, bthis, bargs) = (b.0, b.1, b.2.clone());
                    let mut all = bargs;
                    all.extend_from_slice(args);
                    return self.call_counted(&target, bthis, &all);
                }
                _ => {}
            }
        }
        self.call(f, this, args)
    }

    /// What opening `v` costs the reference: nothing for a value it walks itself, else the call of its
    /// `Symbol.iterator` method. `yield*` always calls it.
    pub(crate) fn open_fuel(&mut self, v: &Value, ctx: u8) -> i32 {
        let Value::Obj(id) = v else { return 0 };
        let walked = matches!(
            self.heap[*id as usize].kind,
            Kind::Array(_)
                | Kind::Arguments(_)
                | Kind::Map(_)
                | Kind::Set(_)
                | Kind::SearchParams(_)
                | Kind::Headers(_)
                | Kind::Bytes(_)
                | Kind::ArrayIter { .. }
                | Kind::MapIter { .. }
                | Kind::StrIter { .. }
                | Kind::ListIter { .. }
                | Kind::ExoticIter { .. }
        );
        if walked && ctx != crate::bytecode::ITER_DELEGATE {
            return 0;
        }
        let method = self.get_obj(*id, SYM_ITERATOR);
        if self.is_closure(&method) {
            0
        } else {
            NATIVE_FUEL
        }
    }

    /// GetIterator for an iterator record, at what opening `v` costs: the iterator and the `next` the record keeps.
    #[inline(never)]
    fn open_record(&mut self, v: &Value, ctx: u8) -> Result<(Value, Value), Value> {
        let it = self.get_iterator_in(v, ctx)?;
        let cost = self.open_fuel(v, ctx);
        self.spend(cost);
        let next = self.record_next_of(v, &it)?;
        Ok((it, next))
    }

    /// Starts a native `JSON.stringify` walk that stamps the objects it visits, unless one runs already: its stamp.
    pub(crate) fn start_json_walk(&mut self) -> Option<u32> {
        if self.json_walk != 0 {
            return None;
        }
        if self.json_walks == u32::MAX {
            self.json_walks = 0;
            for o in &mut self.heap {
                o.visit = 0;
            }
        }
        self.json_walks += 1;
        self.json_walk = self.json_walks;
        Some(self.json_walk)
    }

    /// Whether the reference iterates `v` itself, with no call of its `Symbol.iterator` method: a string, a
    /// collection or a built-in iterator.
    pub(crate) fn walks(&self, v: &Value) -> bool {
        match v {
            Value::Str(_) => true,
            Value::Obj(id) => matches!(
                self.heap[*id as usize].kind,
                Kind::Array(_)
                    | Kind::Arguments(_)
                    | Kind::Map(_)
                    | Kind::Set(_)
                    | Kind::SearchParams(_)
                    | Kind::Headers(_)
                    | Kind::Bytes(_)
                    | Kind::ArrayIter { .. }
                    | Kind::MapIter { .. }
                    | Kind::StrIter { .. }
                    | Kind::ListIter { .. }
                    | Kind::ExoticIter { .. }
            ),
            _ => false,
        }
    }

    /// The `next` an iterator record over `it`, opened from `source`, keeps (see `record_next`). The reference
    /// steps a built-in iterator itself only when it opens the iterable directly; one that a `Symbol.iterator` method
    /// returned has its `next` read and called each step, as bytecode calls it.
    pub(crate) fn record_next_of(&mut self, source: &Value, it: &Value) -> Res {
        if let Value::Obj(id) = it
            && matches!(
                self.heap[*id as usize].kind,
                Kind::ArrayIter { .. }
                    | Kind::MapIter { .. }
                    | Kind::StrIter { .. }
                    | Kind::ListIter { .. }
                    | Kind::ExoticIter { .. }
            )
            && !self.walks(source)
        {
            let nk = self.names.next;
            return self.get(it, nk);
        }
        self.record_next(it)
    }

    /// What closing `it` early costs the reference: the call of a generator's or custom iterator's native `return`.
    pub(crate) fn close_fuel(&mut self, it: &Value) -> i32 {
        let Value::Obj(id) = it else { return 0 };
        match self.heap[*id as usize].kind {
            Kind::Generator(_) | Kind::IterHelper(_) => NATIVE_FUEL,
            Kind::Ordinary => {
                let key = self.names.return_;
                let method = self.get_obj(*id, key);
                if matches!(&method, Value::Obj(m) if matches!(self.heap[*m as usize].kind, Kind::Native { .. }))
                {
                    NATIVE_FUEL
                } else {
                    0
                }
            }
            _ => 0,
        }
    }

    pub(crate) fn is_closure(&self, v: &Value) -> bool {
        matches!(v, Value::Obj(id) if matches!(self.heap[*id as usize].kind, Kind::Closure(_)))
    }

    /// Fills the reference's fuel as a program starts; entering the program's own frame costs it nothing there.
    pub fn start_handover_fuel(&mut self) {
        self.settle_budget();
        self.host.meter.handover = HANDOVER_FUEL + 1;
        self.rebudget();
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
            self.host.meter.fuel = self.roundtrip_every as i32;
            self.suspend_wanted = true;
        }
        // A long stretch of compute stops to move to a worker thread: see `offload`.
        if let Some(o) = &mut self.host.offload
            && o.at.is_some_and(|at| std::time::Instant::now() >= at)
        {
            o.at = None;
            o.due = true;
            self.suspend_wanted = true;
        }
        if self.host.shared.requested() {
            self.suspend_wanted = true;
        }
    }

    /// Starts counting steps for the round-trip test mode.
    pub fn start_roundtrip(&mut self, every: u32) {
        self.roundtrip_every = every;
        self.settle_budget();
        self.host.meter.fuel = every as i32;
        self.rebudget();
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
            let r = self.run_callback();
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
            return Err(self.type_error("The called value is not a function."));
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
                let r = self.run_callback();
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
                self.host.meter.counted = false;
                let r = f(self, this, args, id);
                if self.entered {
                    let r = self.drive_entered(false);
                    self.native_depth -= 1;
                    return r;
                }
                self.native_depth -= 1;
                // Only a call from bytecode stands for the reference's own call of the built-in.
                self.host.meter.bytecode = false;
                r
            }
            Kind::Bound(b) => {
                let (target, bthis, bargs) = (b.0, b.1, b.2.clone());
                let mut all = bargs;
                all.extend_from_slice(args);
                self.call(&target, bthis, &all)
            }
            Kind::Namespace(ns) if ns.is_root() => {
                let message = format!("{} is not a function.", self.atoms.text(ns.name));
                Err(self.type_error(&message))
            }
            Kind::Namespace(_) => {
                let r = crate::host::call_namespace(self, id, args, *f);
                if self.entered {
                    return self.drive_entered(false);
                }
                r
            }
            _ => Err(self.type_error("The called value is not a function.")),
        }
    }

    /// The frames that count toward the call-stack limit: the reference runs its built-ins as internal code, which
    /// does not count, so native frames do not either.
    /// Only asked once more than `MAX_DEPTH` frames run, where `push_frame` keeps the count.
    #[inline]
    fn program_depth(&self) -> usize {
        self.frames.last().map_or(0, |f| f.depth as usize)
    }

    /// Pushes a frame. Above `MAX_DEPTH` frames, where the call-stack limit is checked, the frame also records how
    /// many frames count toward it (all but native ones): counted once on crossing, then kept from the frame below.
    #[inline]
    pub(crate) fn push_frame(&mut self, mut f: Box<Frame>) {
        let len = self.frames.len();
        if len >= MAX_DEPTH {
            let below = match len {
                MAX_DEPTH => self.counted_frames(),
                _ => self.frames[len - 1].depth,
            };
            f.depth = below + u32::from(!matches!(f.kind, FrameKind::Native(..)));
        }
        self.frames.push(f);
    }

    #[cold]
    #[inline(never)]
    fn counted_frames(&self) -> u32 {
        self.frames
            .iter()
            .filter(|f| !matches!(f.kind, FrameKind::Native(..)))
            .count() as u32
    }

    /// Counts every frame toward the call-stack limit again, after the frames were replaced at once.
    pub(crate) fn recount_frames(&mut self) {
        let mut depth = 0;
        for f in &mut self.frames {
            depth += u32::from(!matches!(f.kind, FrameKind::Native(..)));
            f.depth = depth;
        }
    }

    /// Pushes a native frame for the built-in `callee` called on `this`, with `locals` as its first slots, and has
    /// its caller run it: the frame starts at its step function's start (see `native.rs`). The built-in returns what
    /// this returns.
    pub(crate) fn enter_native(
        &mut self,
        op: crate::native::NativeOp,
        callee: Id,
        this: Value,
        locals: &[Value],
    ) -> Res {
        self.enter_native_with(op, 0, Value::Obj(callee), this, locals)
    }

    /// `enter_native` for one of a family's steps (see `native::NativeOp::Arrays`).
    pub(crate) fn enter_native_sub(
        &mut self,
        op: crate::native::NativeOp,
        sub: u16,
        callee: Id,
        this: Value,
        locals: &[Value],
    ) -> Res {
        self.enter_native_with(op, sub, Value::Obj(callee), this, locals)
    }

    /// `enter_native` for a frame no built-in's call made (a job's), or whose callee is not at hand.
    pub(crate) fn enter_native_with(
        &mut self,
        op: crate::native::NativeOp,
        sub: u16,
        callee: Value,
        this: Value,
        locals: &[Value],
    ) -> Res {
        if self.frames.len() >= 3 * MAX_DEPTH {
            return Err(self.range_error("Maximum call stack size exceeded"));
        }
        let base = self.stack.len() + 2;
        self.stack.reserve(2 + locals.len());
        self.stack.push(Slot::pack(callee));
        self.stack.push(Slot::pack(this));
        self.stack.extend(locals.iter().map(|v| Slot::pack(*v)));
        self.push_native_frame(op, sub, base);
        Ok(Value::Undef)
    }

    /// `enter_native_with` with the callee, the receiver and the slots already packed.
    pub(crate) fn enter_native_slots(
        &mut self,
        op: crate::native::NativeOp,
        sub: u16,
        callee: Slot,
        this: Slot,
        locals: &[Slot],
    ) -> Res {
        if self.frames.len() >= 3 * MAX_DEPTH {
            return Err(self.range_error("Maximum call stack size exceeded"));
        }
        let base = self.stack.len() + 2;
        self.stack.reserve(2 + locals.len());
        self.stack.push(callee);
        self.stack.push(this);
        self.stack.extend_from_slice(locals);
        self.push_native_frame(op, sub, base);
        Ok(Value::Undef)
    }

    /// Pushes the frame of a native frame whose slots start at `base`, and flags it entered.
    #[inline(always)]
    fn push_native_frame(&mut self, op: crate::native::NativeOp, sub: u16, base: usize) {
        let hbase = self.handlers.len() as u32;
        match self.spare_frames.pop() {
            // Reuse a retired frame in place; one that ran a native frame keeps the shared code and no upvalues.
            Some(mut f) => {
                if !Arc::ptr_eq(&f.func, &self.native_proto) {
                    f.func = self.native_proto.clone();
                }
                if !f.upvals.is_empty() {
                    f.upvals = self.no_upvals.clone();
                }
                if !f.extra.is_empty() {
                    f.extra = Box::default();
                }
                f.pc = crate::native::START;
                f.base = base;
                f.hbase = hbase;
                f.argc = 0;
                f.kind = FrameKind::Native(op, sub);
                f.is_base = false;
                f.yield_pc = NO_YIELD;
                self.push_frame(f);
            }
            None => self.push_frame(Box::new(Frame {
                func: self.native_proto.clone(),
                pc: crate::native::START,
                base,
                upvals: self.no_upvals.clone(),
                hbase,
                extra: Box::default(),
                argc: 0,
                kind: FrameKind::Native(op, sub),
                is_base: false,
                yield_pc: NO_YIELD,
                depth: 0,
            })),
        }
        self.entered = true;
    }

    /// Makes the native frame a job pushed the base of the run that runs it.
    pub(crate) fn take_entered(&mut self) {
        self.entered = false;
        if let Some(f) = self.frames.last_mut() {
            f.is_base = true;
        }
    }

    /// Runs the native frame a built-in called from native code pushed, to its result.
    fn drive_entered(&mut self, counted: bool) -> Res {
        self.entered = false;
        self.host.meter.bytecode = false;
        if let Some(f) = self.frames.last_mut() {
            f.is_base = true;
            f.argc = counted as u32;
        }
        match self.run_callback() {
            Ok(Exit::Return(v)) | Ok(Exit::Yield(v)) => Ok(v.get()),
            Ok(Exit::Suspend) => Ok(Value::Undef),
            Err(e) => Err(e),
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
        // The reference counts the program's own frame and refuses a call once more than `MAX_DEPTH` are running:
        // `MAX_DEPTH` frames may run above the program.
        if self.frames.len() > MAX_DEPTH && self.program_depth() > MAX_DEPTH {
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
                self.push_frame(spare);
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
            None => self.push_frame(Box::new(Frame {
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
                depth: 0,
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
            return Err(self.not_a_function());
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
                    self.spend(NATIVE_FUEL);
                    if self.enter_generator(g, Resume::Result, false) {
                        self.stack.push(sent);
                    }
                    return Ok(true);
                }
                let mut args = self.arg_pool.pop().unwrap_or_default();
                args.extend(self.stack.drain(fpos + 2..).map(Slot::get));
                let this = self.pop();
                self.stack.pop();
                self.host.meter.counted = true;
                self.convert_ok = true;
                let r = f(self, this, &args, id);
                self.convert_ok = false;
                if self.convert_req.is_some() {
                    let c = self.convert_native(id, this, &args, true, false);
                    args.clear();
                    self.arg_pool.push(args);
                    c?;
                    return Ok(true);
                }
                args.clear();
                self.arg_pool.push(args);
                if self.entered {
                    // The frame says how its call ends when it finishes; nothing set before that counts.
                    self.entered = false;
                    self.host.meter.bytecode = false;
                    if let Some(f) = self.frames.last_mut() {
                        f.argc = 1;
                    }
                    return Ok(true);
                }
                self.push(r?);
                self.native_spent();
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
            // The namespace itself is not a function.
            Kind::Namespace(ns) if ns.is_root() => {
                self.stack.truncate(fpos);
                let message = format!("{} is not a function.", self.atoms.text(ns.name));
                let e = self.type_error(&message);
                Err(self.at_site(e, crate::bytecode::Site::Object))
            }
            Kind::Namespace(_) => {
                let callee = self.stack[fpos].get();
                let args: Vec<Value> = self.stack.drain(fpos + 2..).map(Slot::get).collect();
                self.stack.truncate(fpos);
                let r = crate::host::call_namespace(self, id, &args, callee)?;
                // A call that waits for promises in its arguments runs in a native frame (see `cross.rs`).
                if std::mem::take(&mut self.entered) {
                    self.host.meter.bytecode = false;
                    if let Some(f) = self.frames.last_mut() {
                        f.argc = 1;
                    }
                    return Ok(true);
                }
                self.push(r);
                Ok(false)
            }
            _ => {
                self.stack.truncate(fpos);
                Err(self.not_a_function())
            }
        }
    }

    /// How the running call or `new` instruction names its callee, as the reference does: `o.f`, or "The called
    /// value" when it cannot be named.
    fn callee_name(&self) -> String {
        self.call_site().unwrap_or("The called value").to_owned()
    }

    /// The name of the callee of the call or `new` the running code is in, natives included, when it has one. A
    /// native frame makes its calls for the bytecode below it, as a built-in that called from Rust did.
    pub(crate) fn call_site(&self) -> Option<&str> {
        self.frames
            .iter()
            .rev()
            .find(|f| !matches!(f.kind, FrameKind::Native(..)))
            .and_then(|f| f.func.callee(f.pc.wrapping_sub(1)))
    }

    /// The source offset of that call, where an error about what it returns points.
    pub(crate) fn call_offset(&self) -> Option<u32> {
        self.frames
            .iter()
            .rev()
            .find(|f| !matches!(f.kind, FrameKind::Native(..)))
            .and_then(|f| f.func.pos.get(f.pc.wrapping_sub(1)).copied())
    }

    #[cold]
    #[inline(never)]
    fn not_a_function(&mut self) -> Value {
        let name = self.callee_name();
        let e = self.type_error(&format!("{name} is not a function."));
        self.at_site(e, crate::bytecode::Site::Object)
    }

    #[inline(never)]
    fn construct_op(&mut self, argc: usize) -> Result<bool, Value> {
        let fpos = self.stack.len() - argc - 2;
        let callee = self.stack[fpos].get();
        let args: Vec<Value> = self.stack.drain(fpos + 2..).map(Slot::get).collect();
        self.stack.truncate(fpos);
        if let Value::Obj(id) = callee
            && let Kind::Native { f, ctor: true, .. } = &self.heap[id as usize].kind
        {
            let f = *f;
            self.host.meter.counted = false;
            self.convert_ok = true;
            let r = f(self, Value::Uninit, &args, id);
            self.convert_ok = false;
            if self.convert_req.is_some() {
                self.convert_native(id, Value::Uninit, &args, false, true)?;
                return Ok(true);
            }
            if std::mem::take(&mut self.entered) {
                return Ok(true);
            }
            self.host.meter.bytecode = false;
            self.push(r?);
            return Ok(false);
        }
        Err(self.not_a_constructor(callee))
    }

    #[cold]
    #[inline(never)]
    fn not_a_constructor(&mut self, callee: Value) -> Value {
        let name = self.callee_name();
        let kind = callee.as_obj().map(|id| &self.heap[id as usize].kind);
        let message = match kind {
            Some(Kind::Closure(_)) => format!(
                "{name} cannot be constructed: user-defined constructors and classes are not supported. Call it as a function that returns a plain object instead."
            ),
            Some(Kind::Native { .. }) => {
                format!("new {name}(...) is not supported; call {name}(...) without new instead.")
            }
            _ => format!("{name} is not a constructor."),
        };
        self.type_error(&message)
    }

    /// A point where the reference's driver takes over: it starts the host calls queued so far.
    #[inline]
    pub(crate) fn handover(&mut self) {
        self.host.next_epoch();
        if !self.host.queued.is_empty() {
            self.launch_queued();
        }
    }

    #[cold]
    #[inline(never)]
    fn launch_queued(&mut self) {
        crate::host::launch(self);
    }

    /// The names a `for...in` loop visits: a namespace's own, or the enumerable keys up the prototype chain.
    #[inline(never)]
    fn for_in_list(&mut self, v: &Value) -> Result<Vec<Value>, Value> {
        match *v {
            Value::Obj(id) if self.is_namespace(id) => {
                let names = self.namespace_names(id)?;
                Ok(names
                    .into_iter()
                    .map(|k| Value::Str(self.atoms.atom_str(k)))
                    .collect())
            }
            _ => Ok(self.for_in_keys(v)),
        }
    }

    /// A namespace path as a value: a new reference each time the run reads one, as in the reference.
    pub fn ns_ref(&mut self, path: crate::object::NsPath) -> Value {
        let proto = self.realm.function_proto;
        Value::Obj(self.alloc(Obj::new(Some(proto), Kind::Namespace(path))))
    }

    /// The namespace path the reference `id` names, spelled out from its global down.
    pub(crate) fn ns_path(&self, id: Id) -> crate::object::NsRef {
        let mut keys = Vec::new();
        let mut at = id;
        let root = loop {
            match &self.heap[at as usize].kind {
                Kind::Namespace(ns) if ns.is_root() => break ns.name,
                Kind::Namespace(ns) => {
                    keys.push(crate::HostString::from_run_text(self.atoms.text(ns.name)));
                    at = ns.parent;
                }
                _ => break 0,
            }
        };
        keys.reverse();
        crate::object::NsRef { root, keys }
    }

    /// How the program names a namespace path in errors, as the reference's `member` writes it: `api.issues.list`,
    /// `api["x-y"]`.
    pub(crate) fn ns_label(&self, ns: &crate::object::NsRef) -> String {
        let root = self.atoms.text(ns.root);
        let mut out = String::with_capacity(root.len() + 8 * ns.keys.len());
        out.push_str(root);
        for key in &ns.keys {
            crate::object::push_member(&mut out, key);
        }
        out
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
                DiagnosticKind::ExecutionFailure
                    | DiagnosticKind::InvalidDataValue
                    | DiagnosticKind::UnsupportedSyntax
            )
        {
            let at = pc.saturating_sub(1);
            f.offset = func.site(at, f.site).or_else(|| func.pos.get(at).copied());
        }
    }

    /// Marks a failure as pointing at the part `site` of the member expression whose instruction raises it.
    pub(crate) fn at_site(&mut self, e: Value, site: crate::bytecode::Site) -> Value {
        if let Value::Obj(id) = e
            && let Kind::Error(Some(f)) = &mut self.heap[id as usize].kind
        {
            f.site = site;
        }
        e
    }

    /// Runs a step of the native frame `fi` (see `native.rs`): `Some` with the frame's result when it was this run's
    /// base, else `None` once the loop can go on with the top frame.
    #[inline(never)]
    fn native_op(
        &mut self,
        fi: usize,
        op: crate::native::NativeOp,
        sub: u16,
        base: usize,
        mode: usize,
    ) -> Result<Option<Slot>, Value> {
        let input = match mode {
            crate::native::RETURNED => {
                let hbase = self.frames[fi].hbase as usize;
                self.handlers.truncate(hbase);
                crate::native::Input::Returned(self.stack.pop().unwrap_or_default())
            }
            crate::native::THREW => {
                // Handlers the frame pushed for the call that failed go with it.
                let e = self.pop();
                let hbase = self.frames[fi].hbase as usize;
                self.handlers.truncate(hbase);
                crate::native::Input::Threw(e)
            }
            crate::native::FINISHED => {
                let hbase = self.frames[fi].hbase as usize;
                self.handlers.truncate(hbase);
                crate::native::Input::Finished(self.stack.pop().unwrap_or_default())
            }
            _ => crate::native::Input::Start,
        };
        self.frames[fi].pc = crate::native::RETURNED;
        match crate::native::step(self, op, sub, base, input)? {
            crate::native::Step::Call(argc) => {
                self.call_op(argc)?;
                if self.park
                    && let Some(result) = self.parked()
                {
                    return Ok(Some(Slot::pack(result)));
                }
                Ok(None)
            }
            crate::native::Step::Pushed => Ok(None),
            crate::native::Step::DoneEmpty => {
                let frame = self.frames.pop().expect("frame");
                self.stack.truncate(frame.base - 2);
                self.handlers.truncate(frame.hbase as usize);
                self.host.meter.bytecode = false;
                let is_base = frame.is_base;
                self.spare_frames.push(frame);
                Ok(is_base.then_some(Slot::UNDEF))
            }
            crate::native::Step::CallUncounted(argc) => {
                self.call_op_uncounted(argc)?;
                Ok(None)
            }
            crate::native::Step::CallSettling(argc) => {
                self.call_op_settling(argc)?;
                Ok(None)
            }
            crate::native::Step::Done(v) => {
                let frame = self.frames.pop().expect("frame");
                self.stack.truncate(frame.base - 2);
                self.handlers.truncate(frame.hbase as usize);
                if frame.argc & 1 != 0 {
                    self.native_spent();
                } else {
                    self.host.meter.bytecode = false;
                }
                let is_base = frame.is_base;
                self.spare_frames.push(frame);
                if is_base {
                    return Ok(Some(Slot::pack(v)));
                }
                self.push(v);
                Ok(None)
            }
        }
    }

    /// Calls `f` from a native frame's step: a closure's frame is pushed here, anything else is called as a call
    /// instruction calls it (`call_op`).
    #[inline(always)]
    pub(crate) fn native_call(&mut self, argc: usize) -> Result<crate::native::Step, Value> {
        let fpos = self.stack.len() - argc - 2;
        if let Some(id) = self.stack[fpos].obj()
            && matches!(self.heap[id as usize].kind, Kind::Closure(_))
        {
            self.push_closure_frame(id, fpos, argc, false)?;
            return Ok(crate::native::Step::Pushed);
        }
        Ok(crate::native::Step::Call(argc))
    }

    /// The call a native frame asks for with `Step::CallUncounted`: as `call` makes it from native code, so a native
    /// costs no fifty.
    #[cold]
    #[inline(never)]
    fn call_op_uncounted(&mut self, argc: usize) -> Result<bool, Value> {
        let fpos = self.stack.len() - argc - 2;
        let Some(id) = self.stack[fpos].obj() else {
            return self.call_op(argc);
        };
        match &self.heap[id as usize].kind {
            Kind::Native { f, .. } => {
                let f = *f;
                let mut args = self.arg_pool.pop().unwrap_or_default();
                args.extend(self.stack.drain(fpos + 2..).map(Slot::get));
                let this = self.pop();
                self.stack.pop();
                self.host.meter.counted = false;
                self.convert_ok = true;
                let r = f(self, this, &args, id);
                self.convert_ok = false;
                if self.convert_req.is_some() {
                    let c = self.convert_native(id, this, &args, false, false);
                    args.clear();
                    self.arg_pool.push(args);
                    c?;
                    return Ok(true);
                }
                args.clear();
                self.arg_pool.push(args);
                if std::mem::take(&mut self.entered) {
                    return Ok(true);
                }
                self.host.meter.bytecode = false;
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
                self.call_op_uncounted(argc + n)
            }
            _ => self.call_op(argc),
        }
    }

    /// The call a native frame asks for with `Step::CallSettling`, as the reference enters a promise handler
    /// (`enterSettlingCall`): a plain function's frame and a promise's resolve function for nothing, an async or
    /// generator function one unit, a native fifty.
    #[cold]
    #[inline(never)]
    fn call_op_settling(&mut self, argc: usize) -> Result<bool, Value> {
        let fpos = self.stack.len() - argc - 2;
        let Some(id) = self.stack[fpos].obj() else {
            return self.call_op(argc);
        };
        match &self.heap[id as usize].kind {
            Kind::Bound(b) => {
                let (target, bthis, bargs) = (b.0, b.1, b.2.clone());
                let n = bargs.len();
                self.stack[fpos] = Slot::pack(target);
                self.stack[fpos + 1] = Slot::pack(bthis);
                let tail = self.stack.split_off(fpos + 2);
                self.stack.extend(bargs.into_iter().map(Slot::pack));
                self.stack.extend(tail);
                self.call_op_settling(argc + n)
            }
            Kind::Closure(c) if !c.proto.is_async && !c.proto.is_generator => {
                // Its frame's unit is not spent: credit the budget the call takes it from.
                self.budget += 1;
                self.call_op(argc)
            }
            Kind::Native {
                data: Value::Obj(state),
                ..
            } if matches!(self.heap[*state as usize].kind, Kind::Resolvers { .. }) => {
                self.call_op_uncounted(argc)
            }
            _ => self.call_op(argc),
        }
    }

    /// Fills in the location of a failure a native frame raised: the call of the built-in in the nearest bytecode
    /// frame below, as a built-in that returned the failure would have it.
    #[cold]
    #[inline(never)]
    fn locate_native(&mut self, e: &Value, fi: usize) {
        let Some(caller) = self.frames[..fi]
            .iter()
            .rev()
            .find(|f| !matches!(f.kind, FrameKind::Native(..)))
        else {
            return;
        };
        let (func, pc) = (caller.func.clone(), caller.pc);
        self.locate(e, &func, pc);
    }

    /// Unwinds to the nearest handler. `Err` carries what `run` must return when the base frame is left.
    #[inline(never)]
    fn handle_throw(&mut self, e: Value) -> Result<(), Result<Exit, Value>> {
        // The reference unwinds a throw in its driver loop, which starts the host calls queued so far.
        self.handover();
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
                above: Vec::new(),
                splits: Vec::new(),
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
        if !saved.splits.is_empty() {
            return self.restore_split(saved);
        }
        let Some(mut frame) = saved.frame.take() else {
            return false;
        };
        let (base, hbase) = (self.stack.len() + 2, self.handlers.len() as u32);
        frame.base = base;
        frame.is_base = true;
        frame.hbase = hbase;
        self.stack.append(&mut saved.stack);
        self.handlers.append(&mut saved.handlers);
        self.push_frame(frame);
        if !saved.above.is_empty() {
            self.restore_above(saved, base, hbase);
        }
        true
    }

    /// `restore_frame` for frames a wait parked across running generators: the segment is split again, each
    /// generator getting its resumer's stack back and the VM switching to the generator's own, as `enter_generator`
    /// does.
    #[cold]
    #[inline(never)]
    fn restore_split(&mut self, saved: &mut SavedFrame) -> bool {
        let Some(mut first) = saved.frame.take() else {
            return false;
        };
        let flat = std::mem::take(&mut saved.stack);
        let mut splits = std::mem::take(&mut saved.splits);
        if splits.first().is_some_and(|s| s.0 == GENERATOR_FIRST) {
            splits.remove(0);
            // The generator gets the stack it is resumed from as its resumer's, and runs on its own.
            let resumer = std::mem::take(&mut self.stack);
            if let FrameKind::Generator(g, _) = first.kind
                && let Some(s) = self.running_saved(g)
            {
                s.stack = resumer;
            }
        }
        let below = self.stack.len();
        let hbase = self.handlers.len() as u32;
        first.base = below + 2;
        first.is_base = true;
        first.hbase = hbase;
        self.handlers.append(&mut saved.handlers);
        let end = |r: usize| splits.get(r).map_or(flat.len(), |s| s.1 as usize);
        self.stack.extend_from_slice(&flat[..end(0)]);
        self.push_frame(first);
        // The region of the segment the frames being restored are in: 0 below the first generator.
        let mut region = 0;
        for (j, mut f) in saved.above.drain(..).enumerate() {
            if region < splits.len() && splits[region].0 as usize == j {
                let start = splits[region].1 as usize;
                let own = flat[start..end(region + 1)].to_vec();
                let resumer = std::mem::replace(&mut self.stack, own);
                if let FrameKind::Generator(g, _) = f.kind
                    && let Kind::Generator(GenState::Running(s)) = &mut self.heap[g as usize].kind
                {
                    s.stack = resumer;
                }
                region += 1;
            }
            // A base kept relative to the first frame's: its index in the segment, less two.
            f.base = match region {
                0 => f.base + below + 2,
                r => f.base + 2 - splits[r - 1].1 as usize,
            };
            f.hbase += hbase;
            self.push_frame(f);
        }
        true
    }

    /// The frames a host call's wait parked above a restored frame, at its `base` and `hbase`.
    #[cold]
    #[inline(never)]
    fn restore_above(&mut self, saved: &mut SavedFrame, base: usize, hbase: u32) {
        for mut f in saved.above.drain(..) {
            f.base += base;
            f.hbase += hbase;
            self.push_frame(f);
        }
    }

    /// The coroutine a host call made now from bytecode would park its frames with while it waits for promises in its
    /// arguments, as the reference parks every frame above its nearest async one, or the frames of a promise job or of
    /// the program result's crossing when there is none: `None` when a native call or a generator stands in between, which cannot wait.
    pub(crate) fn parkable(&mut self) -> Option<u32> {
        for (i, f) in self.frames.iter().enumerate().rev() {
            match f.kind {
                FrameKind::Async(c) => return Some(c),
                // A generator resumed from bytecode parks with the frames that resumed it.
                FrameKind::Generator(g, _) if !f.is_base && !self.is_async_generator(g) => {}
                // An async generator, which runs from native code, parks as its `await` does.
                FrameKind::Generator(g, _) if f.is_base && self.is_async_generator(g) => {
                    self.coroutines.push(Coroutine {
                        saved: None,
                        promise: None,
                    });
                    return Some(self.coroutines.len() as u32 - 1);
                }
                FrameKind::Generator(..) => return None,
                // A promise job's, or the program result's crossing, run as the base of a resumable run.
                FrameKind::Native(..) if f.is_base && i == 0 => {
                    self.coroutines.push(Coroutine {
                        saved: None,
                        promise: None,
                    });
                    return Some(self.coroutines.len() as u32 - 1);
                }
                FrameKind::Normal | FrameKind::Native(..) if f.is_base => return None,
                FrameKind::Normal | FrameKind::Native(..) => {}
            }
        }
        None
    }

    /// Parks the frames from the nearest async function (or the promise job's) up to the waiting host call with the
    /// coroutine `c`, as an `await` there would; returns that function's promise and whether its frame was this run's
    /// base.
    fn park_frames(&mut self, c: u32) -> (Value, bool) {
        let k = self
            .frames
            .iter()
            .rposition(|f| matches!(f.kind, FrameKind::Async(a) if a == c))
            .or_else(|| {
                self.frames.iter().rposition(|f| {
                    f.is_base && matches!(f.kind, FrameKind::Generator(g, _) if self.is_async_generator(g))
                })
            })
            .unwrap_or(0);
        if self.frames[k..]
            .iter()
            .any(|f| matches!(f.kind, FrameKind::Generator(..)))
        {
            return self.park_split(c, k);
        }
        let mut parked: Vec<Box<Frame>> = self.frames.drain(k..).collect();
        let first = parked.remove(0);
        let (base, hbase) = (first.base, first.hbase);
        let mut saved = self.coroutines[c as usize].saved.take().unwrap_or_else(|| {
            Box::new(SavedFrame {
                frame: None,
                stack: Vec::new(),
                handlers: Vec::new(),
                started: true,
                above: Vec::new(),
                splits: Vec::new(),
            })
        });
        saved.stack.clear();
        saved.stack.extend(self.stack.drain(base - 2..));
        saved.handlers.clear();
        saved.handlers.extend(self.handlers.drain(hbase as usize..));
        saved.started = true;
        saved.above = parked
            .into_iter()
            .map(|mut f| {
                f.base -= base;
                f.hbase -= hbase;
                f
            })
            .collect();
        let is_base = first.is_base;
        saved.frame = Some(first);
        self.coroutines[c as usize].saved = Some(saved);
        let result = match self.coroutines[c as usize].promise {
            Some(p) => Value::Obj(p),
            None => Value::Undef,
        };
        (result, is_base)
    }

    /// What a running generator keeps while its frame runs: its resumer's stack.
    fn running_saved(&mut self, g: Id) -> Option<&mut SavedFrame> {
        match &mut self.heap[g as usize].kind {
            Kind::Generator(GenState::Running(s)) => Some(s),
            Kind::AsyncGenerator(a) => match &mut a.state {
                GenState::Running(s) => Some(s),
                _ => None,
            },
            _ => None,
        }
    }

    /// `park_frames` across running generators, whose frames run on stacks of their own: the parked frames' slots
    /// are kept as one segment, the regions below each generator (each in that generator's keeping as its resumer's
    /// stack) followed by the generators' own, with where each generator's starts (`SavedFrame::splits`). A parked
    /// frame's base is kept as its index in the segment less two.
    #[cold]
    #[inline(never)]
    fn park_split(&mut self, c: u32, k: usize) -> (Value, bool) {
        let mut parked: Vec<Box<Frame>> = self.frames.drain(k..).collect();
        let first = parked.remove(0);
        let (base, hbase) = (first.base, first.hbase);
        // The stacks of the regions, bottom up: each generator keeps the one below it, the VM the topmost.
        let gens: Vec<(usize, Id)> = parked
            .iter()
            .enumerate()
            .filter_map(|(j, f)| match f.kind {
                FrameKind::Generator(g, _) => Some((j, g)),
                _ => None,
            })
            .collect();
        let mut regions: Vec<Vec<Slot>> = gens
            .iter()
            .map(|(_, g)| match &mut self.heap[*g as usize].kind {
                Kind::Generator(GenState::Running(s)) => std::mem::take(&mut s.stack),
                _ => Vec::new(),
            })
            .collect();
        regions.push(std::mem::take(&mut self.stack));
        let mut flat: Vec<Slot> = regions[0].drain(base - 2..).collect();
        self.stack = std::mem::take(&mut regions[0]);
        let mut splits = Vec::with_capacity(gens.len() + 1);
        // An async generator parked from its own frame: the VM goes back to its resumer's stack, as its `await` does,
        // and `GENERATOR_FIRST` marks it, ahead of the splits once they are made.
        let generator_first = match first.kind {
            FrameKind::Generator(g, _) => match self.running_saved(g) {
                Some(s) => {
                    self.stack = std::mem::take(&mut s.stack);
                    true
                }
                None => false,
            },
            _ => false,
        };
        let mut region = 0;
        for (j, f) in parked.iter_mut().enumerate() {
            if region < gens.len() && gens[region].0 == j {
                splits.push((j as u32, flat.len() as u32));
                flat.append(&mut regions[region + 1]);
                region += 1;
            }
            f.base = match region {
                0 => f.base - base,
                r => splits[r - 1].1 as usize + f.base - 2,
            };
            f.hbase -= hbase;
        }
        if generator_first {
            splits.insert(0, (GENERATOR_FIRST, 0));
        }
        let mut saved = self.coroutines[c as usize].saved.take().unwrap_or_else(|| {
            Box::new(SavedFrame {
                frame: None,
                stack: Vec::new(),
                handlers: Vec::new(),
                started: true,
                above: Vec::new(),
                splits: Vec::new(),
            })
        });
        saved.stack = flat;
        saved.handlers.clear();
        saved.handlers.extend(self.handlers.drain(hbase as usize..));
        saved.started = true;
        saved.above = parked;
        saved.splits = splits;
        let is_base = first.is_base;
        saved.frame = Some(first);
        self.coroutines[c as usize].saved = Some(saved);
        let result = match self.coroutines[c as usize].promise {
            Some(p) => Value::Obj(p),
            None => Value::Undef,
        };
        (result, is_base)
    }

    /// After a call that parked its frames (a host call's wait): the promise the call answers, pushed for the frame below, or
    /// returned when the parked function was this run's base.
    #[cold]
    #[inline(never)]
    fn parked(&mut self) -> Option<Value> {
        self.park = false;
        let c = std::mem::replace(&mut self.park_coroutine, 0);
        let (result, is_base) = self.park_frames(c);
        if is_base {
            return Some(result);
        }
        self.push(result);
        None
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
        self.enter_generator_at(g, resume, is_base, true)
    }

    /// `enter_generator`, resuming the generator at its last `yield` (`from_yield`) or after an `await`.
    fn enter_generator_at(
        &mut self,
        g: Id,
        resume: Resume,
        is_base: bool,
        from_yield: bool,
    ) -> bool {
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
        self.push_frame(frame);
        let f = self.frames.last_mut().expect("frame");
        f.kind = FrameKind::Generator(g, resume);
        f.is_base = is_base;
        f.hbase = hbase;
        let at = f.func.code.get(f.yield_pc as usize);
        let pushes = f.yield_pc != NO_YIELD && !matches!(at, Some(Op::YieldDrop(_)));
        // The reference's `yield*` loops back through a back-edge each time it is resumed there.
        if from_yield && matches!(at, Some(Op::YieldStar(_))) {
            self.spend(1);
        }
        pushes
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
            Resume::Native => {
                if let Some(f) = self.frames.last_mut() {
                    f.pc = crate::native::FINISHED;
                }
                self.push(v);
            }
            Resume::Result => {
                let r = self.iter_result(v, true);
                self.push(r);
            }
            Resume::Delegate => {
                let Some(f) = self.frames.last_mut() else {
                    return;
                };
                if let Some(Op::DelegateResult(exit, _)) = f.func.code.get(f.pc) {
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

    /// Resumes a generator for the native frame on top, as `resume_generator` does (`mode` 0 for `next`, 1 for
    /// `return`, 2 for `throw`; for these two the frame must have pushed a handler, as a throw delivered now unwinds at once
    /// and must come back to it as `Input::Threw` rather than pass it while its step runs): `Some` with its value and whether it is done when it does not run, `None` once its frame
    /// is pushed, which hands the frame below its next yield as
    /// a call's result or its completion as `Input::Finished`.
    pub(crate) fn native_resume(
        &mut self,
        g: Id,
        mode: u8,
        v: Value,
    ) -> Result<Option<(Value, bool)>, Value> {
        let started = match &self.heap[g as usize].kind {
            Kind::Generator(GenState::Suspended(s)) => {
                s.frame.as_ref().is_some_and(|f| f.yield_pc != NO_YIELD)
            }
            Kind::Generator(GenState::Running(_)) => {
                return Err(self.type_error("Generator is already running"));
            }
            _ => {
                return match mode {
                    0 => Ok(Some((Value::Undef, true))),
                    1 => Ok(Some((v, true))),
                    _ => Err(v),
                };
            }
        };
        if !started && mode != 0 {
            self.heap[g as usize].kind = Kind::Generator(GenState::Done);
            return if mode == 1 {
                Ok(Some((v, true)))
            } else {
                Err(v)
            };
        }
        // A generator method called as bytecode calls it costs the reference its fifty once the generator is to run,
        // before its body does, even when the body then throws: not when the method's frame finishes.
        if let Some(f) = self.frames.last_mut()
            && f.argc & 1 != 0
            && f.kind
                == FrameKind::Native(
                    crate::native::NativeOp::Collections,
                    crate::builtins::sets::GEN_RESUME,
                )
        {
            f.argc &= !1;
            self.spend(NATIVE_FUEL);
        }
        let wants = self.enter_generator(g, Resume::Native, false);
        if mode == 0 {
            if wants {
                self.push(v);
            }
            return Ok(None);
        }
        // A throw the generator does not catch unwinds from its frame into the frames below, as a throw there does.
        let kind = if mode == 1 { REQ_RETURN } else { REQ_THROW };
        match self.deliver_abrupt(kind, v) {
            Ok(()) => Ok(None),
            Err(Err(e)) => Err(e),
            Err(Ok(_)) => Ok(None),
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
        let wants = self.enter_generator_at(g, Resume::Iter, true, !awaited);
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
            self.heap[id as usize].props.push_new(rk, raw, FIXED);
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
        let upvals: Arc<[u32]> = proto
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

    /// `run` for a function a built-in calls back: only a driver's run, flagged `resumable_run`, can stop for a
    /// suspend, so every other call skips that bookkeeping, which callbacks pay on each call.
    #[inline(always)]
    fn run_callback(&mut self) -> Result<Exit, Value> {
        if self.resumable_run {
            return self.run();
        }
        self.run_depth += 1;
        let r = self.run_frames(false);
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
            if let FrameKind::Native(op, sub) = self.frames[fi].kind {
                // A native frame runs its step function, not code: where it is to continue is its `pc`.
                let (base, mode) = (self.frames[fi].base, self.frames[fi].pc);
                match self.native_op(fi, op, sub, base, mode) {
                    Ok(None) => continue 'outer,
                    Ok(Some(v)) => return Ok(Exit::Return(v)),
                    Err(e) => {
                        self.locate_native(&e, fi);
                        match self.handle_throw(e) {
                            Ok(()) => continue 'outer,
                            Err(r) => return r,
                        }
                    }
                }
            }
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
            // An operation whose operand converts by calling the program runs in a convert frame (see
            // `conversion.rs`), which hands its result back as the instruction would.
            macro_rules! conv_op {
                ($code:expr, $a:expr, $b:expr, $c:expr, $x:expr, $y:expr) => {{
                    self.frames[fi].pc = pc;
                    tri!(self.convert_op($code, $a, $b, $c, $x, $y));
                    continue 'outer;
                }};
            }
            // An operation's slow path, out of line (`Vm::slow_op`): its result, or the convert frame it pushed.
            macro_rules! slow {
                ($code:expr, $a:expr, $b:expr, $x:expr, $y:expr) => {{
                    self.frames[fi].pc = pc;
                    match self.slow_op($code, $a, $b, $x, $y) {
                        Ok(Some(v)) => v,
                        Ok(None) => continue 'outer,
                        Err(e) => throw!(e),
                    }
                }};
            }
            macro_rules! num_op {
                ($code:expr, $f:expr) => {{
                    let f: fn(f64, f64) -> f64 = $f;
                    let n = self.stack.len();
                    let (a, b) = (self.stack[n - 2], self.stack[n - 1]);
                    if a.is_num() && b.is_num() {
                        self.stack[n - 2] = Slot::num(f(a.f(), b.f()));
                        self.stack.pop();
                    } else {
                        let b = self.pop();
                        let a = self.pop();
                        let r = slow!($code, a, b, 0, 0);
                        self.push(r);
                    }
                }};
            }
            macro_rules! int_op {
                ($code:expr) => {{
                    let b = self.pop();
                    let a = self.pop();
                    let r = slow!($code, a, b, 0, 0);
                    self.push(r);
                }};
            }
            macro_rules! cmp_op {
                ($code:expr, $op:tt) => {{
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
                    let r = slow!($code, a, b, 0, 0);
                    self.push(r);
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
                            self.stack.pop();
                            let ac = crate::conversion::arith_code(op);
                            let r = slow!(code::ARITH, a.get(), Value::Num(y), ac, 0);
                            self.push(r);
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
                    Op::ThrowUnsupported(kind) => {
                        let kind = match self.consts[kind as usize] {
                            Value::Str(s) => self.text(s).to_owned(),
                            _ => String::new(),
                        };
                        throw!(self.unsupported_syntax(&kind));
                    }
                    Op::ThrowSyntax(msg) => {
                        let m = match self.consts[msg as usize] {
                            Value::Str(s) => self.text(s).to_owned(),
                            _ => String::new(),
                        };
                        throw!(self.syntax_error(&m));
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
                        let len = Value::Num(items.len() as f64);
                        let id = self.alloc(Obj::new(Some(proto), Kind::Arguments(items)));
                        let lk = self.names.length;
                        self.define_hidden(id, lk, len);
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
                    Op::GetPropW(a) => {
                        let o = self.pop();
                        if self.write_checked(&o) {
                            tri!(self.check_writable(&o, a));
                        }
                        let v = tri!(self.get(&o, a));
                        self.push(v);
                    }
                    Op::WriteKey => {
                        let n = self.stack.len();
                        let (o, k) = (self.stack[n - 2].get(), self.stack[n - 1].get());
                        if self.write_checked(&o)
                            || !matches!(k, Value::Num(_) | Value::Str(_) | Value::Sym(_))
                        {
                            self.frames[fi].pc = pc;
                            if !o.is_nullish()
                                && matches!(k, Value::Obj(_))
                                && self.operand_calls(&k)
                            {
                                self.stack.pop();
                                conv_op!(code::WRITE_KEY, k, o, Value::Undef, 0, 0);
                            }
                            let key = tri!(self.write_key(&o, &k));
                            self.stack.pop();
                            self.push(key);
                        }
                    }
                    Op::DestructProp(a) => {
                        let o = self.pop();
                        let v = tri!(self.get_destructured(&o, a));
                        self.push(v);
                    }
                    Op::DestructElem => {
                        let k = self.pop();
                        let o = self.pop();
                        let v = tri!(self.get_elem_destructured(&o, &k));
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
                        if matches!(k, Value::Obj(_)) && self.operand_calls(&k) {
                            conv_op!(code::GET_ELEM, o, k, Value::Undef, 0, 0);
                        }
                        let v = tri!(self.get_elem(&o, &k));
                        self.push(v);
                    }
                    Op::SetElem => {
                        let v = self.pop();
                        let k = self.pop();
                        let o = self.pop();
                        if matches!(k, Value::Obj(_)) && self.operand_calls(&k) {
                            conv_op!(code::SET_ELEM, o, k, v, 0, 0);
                        }
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
                        if matches!(k, Value::Obj(_)) && self.operand_calls(&k) {
                            conv_op!(code::DEL_ELEM, o, k, Value::Undef, 0, 0);
                        }
                        // A namespace path takes only string names, as when it is read.
                        if !matches!(k, Value::Str(_))
                            && matches!(o, Value::Obj(id) if matches!(self.heap[id as usize].kind, Kind::Namespace(_)))
                        {
                            throw!(self.namespace_key_error(o.as_obj().unwrap_or(0)));
                        }
                        let a = tri!(self.key_of(&k));
                        let r = tri!(self.delete(&o, a));
                        self.push(Value::Bool(r));
                    }
                    Op::In => {
                        let o = self.pop();
                        let k = self.pop();
                        if matches!(k, Value::Obj(_)) && self.in_key_calls(&o, &k) {
                            conv_op!(code::IN, o, k, Value::Undef, 0, 0);
                        }
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
                        if matches!(k, Value::Obj(_)) && self.operand_calls(&k) {
                            conv_op!(code::DEFINE_ELEM, k, v, Value::Undef, 0, 0);
                        }
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
                            // The reference opens a generator with a call of its `Symbol.iterator`.
                            self.spend(NATIVE_FUEL);
                            if self.enter_generator(g, Resume::Collect(arr), false) {
                                self.stack.push(Slot::UNDEF);
                            }
                            continue 'outer;
                        }
                        let src = self.pop();
                        if !self.is_iterable(&src) {
                            throw!(self.not_iterable(&src, crate::bytecode::ITER_SPREAD));
                        }
                        let open = self.open_fuel(&src, crate::bytecode::ITER_SPREAD);
                        self.spend(open);
                        if let Some(r) = self.spread_by_call(src) {
                            self.frames[fi].pc = pc;
                            tri!(r);
                            self.entered = false;
                            continue 'outer;
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
                            tri!(self.spread_props(id, &src));
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
                        tri!(self.rest_props(id, &src, &excluded));
                        self.push(Value::Obj(id));
                    }
                    Op::ToKey => {
                        let k = self.top();
                        if !matches!(k, Value::Num(_) | Value::Str(_) | Value::Sym(_)) {
                            self.frames[fi].pc = pc;
                            if self.operand_calls(&k) {
                                self.stack.pop();
                                conv_op!(code::TO_KEY, k, Value::Undef, Value::Undef, 0, 0);
                            }
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
                                self.type_error(&format!("Cannot destructure {t} as it is {t}."))
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
                            (Value::Obj(_), _) | (_, Value::Obj(_)) => slow!(code::ADD, a, b, 0, 0),
                            _ => tri!(self.add(a, b)),
                        };
                        self.push(r);
                    }
                    Op::Sub => num_op!(code::SUB, |x, y| x - y),
                    Op::Mul => num_op!(code::MUL, |x, y| x * y),
                    Op::Div => num_op!(code::DIV, |x, y| x / y),
                    Op::Mod => num_op!(code::MOD, js_rem),
                    Op::Pow => num_op!(code::POW, js_pow),
                    Op::BitAnd => int_op!(code::BIT_AND),
                    Op::BitOr => int_op!(code::BIT_OR),
                    Op::BitXor => int_op!(code::BIT_XOR),
                    Op::Shl => int_op!(code::SHL),
                    Op::Shr => int_op!(code::SHR),
                    Op::UShr => int_op!(code::USHR),
                    Op::Eq => {
                        let b = self.pop();
                        let a = self.pop();
                        let r = slow!(code::EQ, a, b, 0, 0);
                        self.push(r);
                    }
                    Op::Ne => {
                        let b = self.pop();
                        let a = self.pop();
                        let r = slow!(code::NE, a, b, 0, 0);
                        self.push(r);
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
                    Op::Lt => cmp_op!(code::LT, <),
                    Op::Gt => cmp_op!(code::GT, >),
                    Op::Le => cmp_op!(code::LE, <=),
                    Op::Ge => cmp_op!(code::GE, >=),
                    Op::Neg => {
                        let a = self.pop();
                        if self.operand_calls(&a) {
                            conv_op!(code::NEG, a, Value::Undef, Value::Undef, 0, 0);
                        }
                        tri!(self.data_operand(&a, "Unary operators require data values."));
                        let x = match a {
                            Value::Num(x) => x,
                            _ => tri!(self.number_of(&a)),
                        };
                        self.push(Value::Num(-x));
                    }
                    Op::ToNumber | Op::ToNumeric => {
                        let a = self.pop();
                        if self.operand_calls(&a) {
                            let which = match (op, code.get(pc..pc + 3)) {
                                (Op::ToNumeric, Some(next)) if next.contains(&Op::Dec) => 1,
                                (Op::ToNumeric, _) => 0,
                                _ => 2,
                            };
                            conv_op!(code::TO_NUMBER, a, Value::Undef, Value::Undef, which, 0);
                        }
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
                        if self.operand_calls(&a) {
                            conv_op!(code::BIT_NOT, a, Value::Undef, Value::Undef, 0, 0);
                        }
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
                        if self.operand_calls(&a) {
                            let c = if matches!(op, Op::Inc) {
                                code::INC
                            } else {
                                code::DEC
                            };
                            conv_op!(c, a, Value::Undef, Value::Undef, 0, 0);
                        }
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
                        if self.operand_calls(&a) {
                            conv_op!(code::TO_STR, a, Value::Undef, Value::Undef, 0, 0);
                        }
                        let s = match a {
                            Value::Str(_) => a,
                            _ => Value::Str(tri!(self.string_of(&a))),
                        };
                        self.push(s);
                    }
                    Op::Concat(n) => {
                        let start = self.stack.len() - n as usize;
                        let mut parts = std::mem::take(&mut self.concat_parts);
                        parts.extend(
                            self.stack[start..]
                                .iter()
                                .filter(|p| p.is_str())
                                .map(|p| p.payload()),
                        );
                        self.stack.truncate(start);
                        let len: usize = parts.iter().map(|p| self.atoms.get(*p).len()).sum();
                        let v =
                            (len <= crate::ops::MAX_STRING_LEN).then(|| self.concat_strs(&parts));
                        parts.clear();
                        self.concat_parts = parts;
                        let Some(v) = v else {
                            throw!(self.range_error("Invalid string length"));
                        };
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
                                let r = slow!(code::ADD_LOCAL, a, b, i, 0);
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
                            let r = slow!(code::INC_LOCAL, v.get(), Value::Undef, i, 0);
                            self.stack[slot] = Slot::pack(r);
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
                            let ac = crate::conversion::arith_code(cmp);
                            let r = slow!(code::JUMP_UNLESS, a.get(), b.get(), ac, t);
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
                            let ac = crate::conversion::arith_code(cmp);
                            let r = slow!(code::JUMP_UNLESS, a.get(), Value::Num(k as f64), ac, t);
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
                            if self.park
                                && let Some(result) = self.parked()
                            {
                                return Ok(Exit::Return(Slot::pack(result)));
                            }
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
                            if self.park
                                && let Some(result) = self.parked()
                            {
                                return Ok(Exit::Return(Slot::pack(result)));
                            }
                            continue 'outer;
                        }
                    }
                    Op::New(argc) => {
                        self.frames[fi].pc = pc;
                        if tri!(self.construct_op(argc as usize)) {
                            continue 'outer;
                        }
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
                        if tri!(self.construct_op(argc)) {
                            continue 'outer;
                        }
                    }
                    Op::Return => {
                        let v = self.pop();
                        let frame = self.frames.pop().expect("frame");
                        self.stack.truncate(frame.base - 2);
                        self.handlers.truncate(frame.hbase as usize);
                        let result = match frame.kind {
                            FrameKind::Normal | FrameKind::Native(..) => v,
                            FrameKind::Async(c) => match self.coroutines[c as usize].promise {
                                Some(p) => {
                                    self.resolve_promise(p, v);
                                    Value::Obj(p)
                                }
                                None => {
                                    crate::cross::program_result(self, v)?;
                                    if std::mem::take(&mut self.entered) {
                                        // The result's crossing runs in a native frame, as the run's base in
                                        // place of the program's frame.
                                        self.host.meter.bytecode = false;
                                        let is_base = frame.is_base;
                                        self.spare_frames.push(frame);
                                        if let Some(f) = self.frames.last_mut() {
                                            f.is_base = is_base;
                                        }
                                        continue 'outer;
                                    }
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
                            above: Vec::new(),
                            splits: Vec::new(),
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
                        if let Some(r) = self.open_by_call(&v, slot, ctx) {
                            tri!(r);
                            self.entered = false;
                            continue 'outer;
                        }
                        let (it, next) = tri!(self.open_record(&v, ctx));
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
                        let next = self.stack[base + slot as usize + 1];
                        if self.steps_by_call(it, next) {
                            tri!(self.step_by_call(it, next, slot, Some(exit), false));
                            self.entered = false;
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
                        // The reference calls the delegated iterator's method each step, a native one for fifty: the
                        // record's `next` here, a `throw` or `return` where it is found (`sync_delegate_step`,
                        // `delegate_call`), and nothing when it is missing.
                        if kind == REQ_NEXT
                            && !self.calls_closure(&self.stack[base + slot as usize + 1].get())
                        {
                            self.spend(NATIVE_FUEL);
                        }
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
                                // A generator resumed in a frame hands its answer over itself.
                                if std::mem::take(&mut self.entered) {
                                    continue 'outer;
                                }
                                match step {
                                    Some((v, done)) => {
                                        self.push(v);
                                        pc = match code.get(pc) {
                                            Some(Op::DelegateResult(exit, _)) if done => {
                                                *exit as usize
                                            }
                                            _ => delegate_continue(code, pc + 1),
                                        };
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
                        let r = tri!(self.delegate_call(it.get(), kind, arg, next));
                        // A method of the program's runs in a frame, which pushes its result itself.
                        if std::mem::take(&mut self.entered) {
                            continue 'outer;
                        }
                        match r {
                            Some(r) => self.push(r),
                            None => {
                                self.stack.push(received);
                                pc = missing as usize;
                            }
                        }
                    }
                    Op::DelegateResult(exit, kind) => {
                        let r = self.pop();
                        let (v, done) = tri!(self.iter_result_parts(&r, kind));
                        self.push(v);
                        pc = if done {
                            exit as usize
                        } else {
                            delegate_continue(code, pc)
                        };
                    }
                    Op::GetAsyncIter(slot, ctx) => {
                        self.frames[fi].pc = pc;
                        let v = self.pop();
                        let it = tri!(self.get_async_iterator(&v, ctx, slot));
                        // A method of the program's runs in a frame, which writes the record itself.
                        if std::mem::take(&mut self.entered) {
                            continue 'outer;
                        }
                        let next = tri!(self.record_next(&it));
                        self.stack[base + slot as usize] = Slot::pack(it);
                        self.stack[base + slot as usize + 1] = Slot::pack(next);
                    }
                    Op::AsyncClose(slot, skip) => {
                        self.frames[fi].pc = pc;
                        let it = std::mem::take(&mut self.stack[base + slot as usize]).get();
                        let r = tri!(self.async_close(it));
                        if std::mem::take(&mut self.entered) {
                            continue 'outer;
                        }
                        match r {
                            Some(r) => self.push(r),
                            None => pc = skip as usize,
                        }
                    }
                    Op::CheckObject => {
                        let v = self.top();
                        if !matches!(v, Value::Obj(_)) {
                            throw!(self.type_error("Iterator return() result must be an object."));
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
                        let next = self.stack[base + slot as usize + 1];
                        if self.steps_by_call(it, next) {
                            tri!(self.step_by_call(it, next, slot, None, false));
                            self.entered = false;
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
                        let next = self.stack[base + slot as usize + 1];
                        if self.steps_by_call(it, next) {
                            tri!(self.step_by_call(it, next, slot, None, true));
                            self.entered = false;
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
                        if let Some(r) =
                            self.close_by_call(&it, matches!(op, Op::IterCloseQuiet(_)))
                        {
                            tri!(r);
                            self.entered = false;
                            continue 'outer;
                        }
                        let cost = self.close_fuel(&it);
                        let r = self.iter_close(&it);
                        self.spend(cost);
                        if matches!(op, Op::IterClose(_)) || self.fatal.is_some() {
                            tri!(r);
                        }
                    }
                    Op::ForIn(slot) => {
                        let v = self.pop();
                        tri!(self.for_in_source(&v));
                        let keys = tri!(self.for_in_list(&v));
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
        self.reference_error(&format!("Cannot access '{n}' before initialization."))
    }

    // ---------- driver ----------

    /// Runs queued jobs and delivers host results until the program has an outcome.
    pub fn drive(&mut self) -> Result<(), Value> {
        loop {
            if self.outcome.is_some() {
                return Ok(());
            }
            if self.suspended {
                return Ok(());
            }
            if self.suspend_wanted || self.host.shared.requested() {
                self.suspended = true;
                return Ok(());
            }
            if self.fatal.is_some() {
                return Err(Value::Undef);
            }
            if let Some(job) = self.jobs.pop_front() {
                self.tick()?;
                self.handover();
                self.run_job(job)?;
                continue;
            }
            if let Some((p, outcome)) = self.inbox.pop_front() {
                self.check_time()?;
                crate::host::settle(self, p, outcome);
                continue;
            }
            // Nothing left to run: the reference's driver stops, starting the host calls queued so far.
            if !self.host.queued.is_empty() {
                self.handover();
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

pub fn js_rem(x: f64, y: f64) -> f64 {
    const EXACT: u64 = 1 << 53;
    // Integers below 2^53 convert exactly both ways (NaN converts to 0 and fails the check), and their remainder is
    // the integer one.
    let (a, b) = (x as i64, y as i64);
    if a as f64 == x
        && b as f64 == y
        && b != 0
        && a.unsigned_abs() < EXACT
        && b.unsigned_abs() < EXACT
    {
        let r = (a % b) as f64;
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

/// Where a `yield*` goes on once its iterator answered a `throw` or `return` request without finishing: the jump at
/// `at` back to the `YieldStar`, taken here without the back-edge a backward jump costs, as the reference's `yield*`
/// yields the answer straight away. Any other instruction is where it goes on.
#[inline]
pub(crate) fn delegate_continue(code: &[Op], at: usize) -> usize {
    match code.get(at) {
        Some(Op::Jump(t)) if matches!(code.get(*t as usize), Some(Op::YieldStar(_))) => *t as usize,
        _ => at,
    }
}
