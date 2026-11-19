//! Which heap objects a run can still reach, for a snapshot: the reference saves only what is reachable, so a value
//! the program dropped never stops a resume. Every cell, stack slot and coroutine counts as a root.
//!
//! [`roots`] lists every value the VM holds outside its heap, and [`children`] every value one object holds: a walk
//! over the two (as [`reachable`], and a collector's mark phase) sees everything a run can reach.

use crate::object::*;
use crate::value::{Id, Slot, Value};
use crate::vm::{Frame, FrameKind, Job, Reaction, Resume, SavedFrame, Vm};

/// Marks every object reachable from the run's roots; the objects every fresh run makes are roots too.
pub fn reachable(vm: &Vm) -> Vec<bool> {
    let mut m = Marks {
        seen: vec![false; vm.heap.len()],
        todo: Vec::new(),
    };
    for id in 0..vm.snapshot_base.heap.min(vm.heap.len()) {
        m.mark(Value::Obj(id as Id));
    }
    roots(vm, &mut |v| m.mark(v));
    while let Some(id) = m.todo.pop() {
        children(&vm.heap[id as usize], &mut |v| m.mark(v));
    }
    m.seen
}

struct Marks {
    seen: Vec<bool>,
    todo: Vec<Id>,
}

impl Marks {
    fn mark(&mut self, v: Value) {
        if let Value::Obj(id) = v
            && let Some(seen) = self.seen.get_mut(id as usize)
            && !*seen
        {
            *seen = true;
            self.todo.push(id);
        }
    }
}

/// Every value the VM holds outside its heap objects: cells, stacks, frames, globals, constants, jobs, coroutines,
/// the host's calls (queued, in flight, settled), and the outcome.
pub fn roots(vm: &Vm, visit: &mut impl FnMut(Value)) {
    let mut t = Tracer(visit);
    t.slots(&vm.cells);
    t.slots(&vm.stack);
    for f in &vm.frames {
        t.frame(f);
    }
    t.vals(vm.globals.iter());
    t.vals(vm.global_map.values());
    t.vals(vm.consts.iter());
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

/// Every value an object holds: its prototype, its properties, and what its kind keeps.
pub fn children(o: &Obj, visit: &mut impl FnMut(Value)) {
    Tracer(visit).object(o);
}

struct Tracer<'f, F>(&'f mut F);

impl<F: FnMut(Value)> Tracer<'_, F> {
    fn id(&mut self, id: Id) {
        (self.0)(Value::Obj(id));
    }

    fn val(&mut self, v: &Value) {
        if let Value::Obj(_) = v {
            (self.0)(*v);
        }
    }

    fn vals<'a>(&mut self, vs: impl IntoIterator<Item = &'a Value>) {
        for v in vs {
            self.val(v);
        }
    }

    fn slots(&mut self, slots: &[Slot]) {
        for s in slots {
            self.val(&s.get());
        }
    }

    fn frame(&mut self, f: &Frame) {
        self.vals(f.extra.iter());
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

    fn map(&mut self, m: &OrderedMap) {
        for (k, v) in m.entries.iter().flatten() {
            self.val(k);
            self.val(v);
        }
    }

    fn object(&mut self, o: &Obj) {
        if let Some(p) = o.proto {
            self.id(p);
        }
        for p in &o.props.items {
            self.val(&p.value);
        }
        match &o.kind {
            Kind::Ordinary
            | Kind::Error(_)
            | Kind::RegExp(_)
            | Kind::Date(_)
            | Kind::Bytes(_)
            | Kind::TextDecoder(_)
            | Kind::Headers(_)
            | Kind::StrIter { .. }
            | Kind::Live(_) => {}
            Kind::Namespace(ns) => {
                if !ns.is_root() {
                    self.id(ns.parent);
                }
            }
            Kind::Array(items) | Kind::Arguments(items) => self.vals(items.iter()),
            Kind::ListIter { items, .. } => self.vals(items.iter()),
            Kind::Closure(c) => self.val(&c.this),
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
            Kind::Map(m) | Kind::Set(m) | Kind::WeakMap(m) | Kind::WeakSet(m) => self.map(m),
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
