//! Which heap objects a run can still reach, for a snapshot: the reference saves only what is reachable, so a value
//! the program dropped never stops a resume. Every cell, stack slot and coroutine counts as a root.
//!
//! [`roots`] lists every reference the VM holds outside its heap, and [`children`] every reference one object holds:
//! a walk over the two (as [`reachable`], and the collector's marking) sees everything a run can reach.

use crate::object::*;
use crate::strings::StrId;
use crate::value::{Id, Slot, Value};
use crate::vm::{Frame, FrameKind, Job, Reaction, Resume, SavedFrame, Vm};

/// What a walk finds: an object, a string or a closure cell. A stack slot whose bits could be a cell's raw index (see
/// `Op::NewCell`) is reported as that cell, which may not exist.
#[derive(Clone, Copy)]
pub enum Ref {
    Obj(Id),
    Str(StrId),
    Cell(u32),
}

/// Marks every object reachable from the run's roots; the objects every fresh run makes, and every cell, are roots
/// too.
pub fn reachable(vm: &Vm) -> Vec<bool> {
    let mut m = Marks {
        seen: vec![false; vm.heap.len()],
        todo: Vec::new(),
    };
    for id in 0..vm.snapshot_base.heap.min(vm.heap.len()) {
        m.mark(Ref::Obj(id as Id));
    }
    for c in &vm.cells {
        if let Value::Obj(id) = c.get() {
            m.mark(Ref::Obj(id));
        }
    }
    roots(vm, &mut |r| m.mark(r));
    while let Some(id) = m.todo.pop() {
        children(&vm.heap[id as usize], &mut |r| m.mark(r));
    }
    m.seen
}

struct Marks {
    seen: Vec<bool>,
    todo: Vec<Id>,
}

impl Marks {
    fn mark(&mut self, r: Ref) {
        if let Ref::Obj(id) = r
            && let Some(seen) = self.seen.get_mut(id as usize)
            && !*seen
        {
            *seen = true;
            self.todo.push(id);
        }
    }
}

/// Every reference the VM holds outside its heap objects and cells: stacks, frames, globals, constants, the realm's
/// lazily made prototypes, jobs, coroutines, the host's calls (queued, in flight, settled), and the outcome.
pub fn roots(vm: &Vm, visit: &mut impl FnMut(Ref)) {
    let mut t = Tracer(visit);
    t.slots(&vm.stack);
    for f in &vm.frames {
        t.frame(f);
    }
    t.vals(vm.globals.iter());
    t.vals(vm.global_map.values());
    t.vals(vm.consts.iter());
    let std = &vm.realm.std;
    for id in [
        std.regexp,
        std.date,
        std.uint8,
        std.buffer,
        std.text_encoder,
        std.text_decoder,
        std.weak_map,
        std.weak_set,
        std.iterator_helper,
        std.uri_error,
        std.url,
        std.params,
        std.headers,
    ] {
        t.id(id);
    }
    for id in vm.template_objs_ref().iter().flatten() {
        t.id(*id);
    }
    for j in &vm.jobs {
        match j {
            Job::Reaction(r, o) => {
                t.reaction(r);
                t.outcome(o);
            }
            Job::Thenable {
                promise,
                thenable,
                then,
            } => {
                t.id(*promise);
                t.val(thenable);
                t.val(then);
            }
        }
    }
    for (p, _) in &vm.inbox {
        t.id(*p);
    }
    for c in &vm.coroutines {
        if let Some(s) = &c.saved {
            t.saved(s);
        }
        if let Some(p) = c.promise {
            t.id(p);
        }
    }
    t.vals(vm.replay.iter());
    match &vm.convert_req {
        Some(crate::conversion::Request::One(v, _)) => t.val(v),
        Some(crate::conversion::Request::List(values, ..)) => t.vals(values.iter()),
        None => {}
    }
    let h = &vm.host;
    for q in &h.queued {
        match q {
            crate::host::Queued::Call(p, _, r, _) => {
                t.id(*p);
                t.id(r.promise);
            }
            crate::host::Queued::Work(p, _, f) => {
                t.id(*p);
                t.id(f.promise);
            }
        }
    }
    for tag in h.tasks.tags() {
        t.id(tag);
    }
    for call in &h.calls {
        t.id(call.promise);
    }
    for r in &h.restarts {
        t.id(r.promise);
    }
    for id in h.suggestions.keys() {
        t.id(*id);
    }
    if let Some(p) = h.promise_like {
        t.id(p);
    }
    for (p, v) in &h.unhandled {
        t.id(*p);
        t.val(v);
    }
    t.vals(h.modules_loaded.values());
    t.vals(h.namespaces.values());
    if let Some(o) = &vm.outcome {
        t.outcome(o);
    }
}

/// Every reference an object holds: its prototype, its properties, and what its kind keeps.
pub fn children(o: &Obj, visit: &mut impl FnMut(Ref)) {
    head(o, visit);
    bulk(o, 0, usize::MAX, visit);
}

/// What `o` holds apart from its [`bulk`]: a bounded number of references, unless its kind keeps a list (a bound
/// function's arguments, a promise's reactions, a generator's saved stack).
pub fn head(o: &Obj, visit: &mut impl FnMut(Ref)) {
    Tracer(visit).head(o);
}

/// The slots of `o` from `from` to `to`, of the [`bulk_len`] there are: its properties' values, then its
/// elements or entries. These are what may be long, which the collector traces a range at a time.
pub fn bulk(o: &Obj, from: usize, to: usize, visit: &mut impl FnMut(Ref)) {
    let mut t = Tracer(visit);
    let props = &o.props.items;
    for p in range(props, from, to) {
        t.val(&p.value);
    }
    let (from, to) = (
        from.saturating_sub(props.len()),
        to.saturating_sub(props.len()),
    );
    match &o.kind {
        Kind::Array(items) | Kind::Arguments(items) => t.vals(range(items, from, to)),
        Kind::ListIter { items, .. } => t.vals(range(items, from, to)),
        Kind::Map(m) | Kind::Set(m) | Kind::WeakMap(m) | Kind::WeakSet(m) => {
            for (k, v) in range(&m.entries, from, to).iter().flatten() {
                t.val(k);
                t.val(v);
            }
        }
        _ => {}
    }
}

/// How many slots [`bulk`] has for `o`.
pub fn bulk_len(o: &Obj) -> usize {
    o.props.items.len()
        + match &o.kind {
            Kind::Array(items) | Kind::Arguments(items) => items.len(),
            Kind::ListIter { items, .. } => items.len(),
            Kind::Map(m) | Kind::Set(m) | Kind::WeakMap(m) | Kind::WeakSet(m) => m.entries.len(),
            _ => 0,
        }
}

/// The part of `s` from `from` to `to`, as far as it goes.
fn range<T>(s: &[T], from: usize, to: usize) -> &[T] {
    &s[from.min(s.len())..to.min(s.len())]
}

struct Tracer<'f, F>(&'f mut F);

impl<F: FnMut(Ref)> Tracer<'_, F> {
    fn id(&mut self, id: Id) {
        (self.0)(Ref::Obj(id));
    }

    fn val(&mut self, v: &Value) {
        match v {
            Value::Obj(id) => (self.0)(Ref::Obj(*id)),
            Value::Str(s) => (self.0)(Ref::Str(*s)),
            _ => {}
        }
    }

    fn vals<'a>(&mut self, vs: impl IntoIterator<Item = &'a Value>) {
        for v in vs {
            self.val(v);
        }
    }

    fn slots(&mut self, slots: &[Slot]) {
        for s in slots {
            if let Ok(c) = u32::try_from(s.0) {
                (self.0)(Ref::Cell(c));
            }
            self.val(&s.get());
        }
    }

    fn frame(&mut self, f: &Frame) {
        self.vals(f.extra.iter());
        for c in f.upvals.iter() {
            (self.0)(Ref::Cell(*c));
        }
        if let FrameKind::Generator(g, resume) = f.kind {
            self.id(g);
            if let Resume::Collect(a) = resume {
                self.id(a);
            }
        }
    }

    fn saved(&mut self, s: &SavedFrame) {
        if let Some(f) = &s.frame {
            self.frame(f);
        }
        for f in &s.above {
            self.frame(f);
        }
        self.slots(&s.stack);
    }

    fn gen_state(&mut self, g: &GenState) {
        match g {
            GenState::Suspended(s) | GenState::Running(s) => self.saved(s),
            GenState::Done => {}
        }
    }

    fn outcome(&mut self, o: &Result<Value, Value>) {
        match o {
            Ok(v) | Err(v) => self.val(v),
        }
    }

    fn reaction(&mut self, r: &Reaction) {
        match r {
            Reaction::Then {
                on_ful,
                on_rej,
                derived,
            } => {
                self.val(on_ful);
                self.val(on_rej);
                self.id(*derived);
            }
            Reaction::Await(_) | Reaction::Program => {}
            Reaction::Cross(id) => self.id(*id),
            Reaction::Resolve(t) => self.id(*t),
            Reaction::Comb { comb, .. } => self.id(*comb),
            Reaction::Finally { cleanup, derived } => {
                self.val(cleanup);
                self.id(*derived);
            }
            Reaction::Restore { derived, outcome } => {
                self.id(*derived);
                self.outcome(outcome);
            }
            Reaction::AwaitGen(g) | Reaction::GenReturn(g) => self.id(*g),
            Reaction::FromSync { made, close, .. } => {
                self.id(*made);
                if let Some(c) = close {
                    self.id(*c);
                }
            }
        }
    }

    fn head(&mut self, o: &Obj) {
        if let Some(p) = o.proto {
            self.id(p);
        }
        match &o.kind {
            Kind::Ordinary
            | Kind::Array(_)
            | Kind::Arguments(_)
            | Kind::ListIter { .. }
            | Kind::Map(_)
            | Kind::Set(_)
            | Kind::WeakMap(_)
            | Kind::WeakSet(_)
            | Kind::Error(_)
            | Kind::RegExp(_)
            | Kind::Date(_)
            | Kind::Bytes(_)
            | Kind::TextDecoder(_)
            | Kind::Headers(_)
            | Kind::Live(_) => {}
            Kind::StrIter { s, .. } => self.val(&Value::Str(*s)),
            Kind::Namespace(ns) => {
                if !ns.is_root() {
                    self.id(ns.parent);
                }
            }
            Kind::Closure(c) => {
                self.val(&c.this);
                for cell in c.upvals.iter() {
                    (self.0)(Ref::Cell(*cell));
                }
            }
            Kind::Native { data, .. } => self.val(data),
            Kind::Bound(b) => {
                self.val(&b.0);
                self.val(&b.1);
                self.vals(b.2.iter());
            }
            Kind::Promise(p) => {
                match &p.state {
                    PromiseState::Pending => {}
                    PromiseState::Fulfilled(v) | PromiseState::Rejected(v) => self.val(v),
                }
                for r in &p.reactions {
                    self.reaction(r);
                }
            }
            Kind::Generator(g) => self.gen_state(g),
            Kind::ArrayIter { target, .. }
            | Kind::MapIter { target, .. }
            | Kind::ExoticIter { target, .. } => self.id(*target),
            Kind::Resolvers { promise, .. } => self.id(*promise),
            Kind::Cross(c) => {
                let values: Vec<Value> = crate::cross::values(c).collect();
                self.vals(values.iter());
            }
            Kind::Combinator(c) => {
                self.id(c.promise);
                self.vals(c.values.iter());
            }
            Kind::IterHelper(h) => {
                use crate::builtins::iterator::HelperOp;
                self.val(&h.iter);
                self.val(&h.next);
                self.val(&h.site);
                match &h.op {
                    HelperOp::Map(f) | HelperOp::Filter(f) => self.val(f),
                    HelperOp::FlatMap(f, inner) => {
                        self.val(f);
                        if let Some((a, b)) = inner {
                            self.val(a);
                            self.val(b);
                        }
                    }
                    HelperOp::Wrap | HelperOp::Take(_) | HelperOp::Drop(_) => {}
                }
            }
            Kind::Url(u) => self.id(u.params),
            Kind::SearchParams(p) => {
                if let Some(u) = p.url {
                    self.id(u);
                }
            }
            Kind::AsyncGenerator(a) => {
                self.gen_state(&a.state);
                for r in &a.queue {
                    self.val(&r.value);
                    self.id(r.promise);
                }
            }
            Kind::AsyncFromSync { sync, next } => {
                self.id(*sync);
                self.val(next);
            }
        }
    }
}
