//! Which heap objects a run can still reach, for a snapshot: the reference saves only what is reachable, so a value
//! the program dropped never stops a resume. Every cell, stack slot and coroutine counts as a root. A collector walks
//! the same roots with marks of its own (`Marks`).

use crate::object::*;
use crate::strings::StrId;
use crate::value::{Id, Slot, Value};
use crate::vm::{Frame, Job, Reaction, SavedFrame, Vm};

/// What a walk records as it meets things.
pub(crate) trait Marks {
    /// Marks an object: whether its fields are still to be walked.
    fn obj(&mut self, id: Id) -> bool;
    fn str(&mut self, _s: StrId) {}
    /// Marks a closure cell: whether its value is still to be walked.
    fn cell(&mut self, _c: u32) -> bool {
        false
    }
}

struct Seen(Vec<bool>);

impl Marks for Seen {
    fn obj(&mut self, id: Id) -> bool {
        match self.0.get_mut(id as usize) {
            Some(seen) if !*seen => {
                *seen = true;
                true
            }
            _ => false,
        }
    }
}

pub(crate) struct Walk<'v, M> {
    pub heap: &'v [Obj],
    pub cells: &'v [Slot],
    pub marks: M,
    pub todo: Vec<Id>,
}

impl<M: Marks> Walk<'_, M> {
    pub fn id(&mut self, id: Id) {
        if self.marks.obj(id) {
            self.todo.push(id);
        }
    }

    pub fn val(&mut self, v: &Value) {
        match v {
            Value::Obj(id) => self.id(*id),
            Value::Str(s) => self.marks.str(*s),
            _ => {}
        }
    }

    pub fn cell(&mut self, c: u32) {
        if self.marks.cell(c)
            && let Some(s) = self.cells.get(c as usize)
        {
            self.val(&s.get());
        }
    }

    /// Walks the objects met so far and everything they reach.
    pub fn drain(&mut self) {
        let heap = self.heap;
        while let Some(id) = self.todo.pop() {
            self.object(&heap[id as usize]);
        }
    }

    fn vals<'a>(&mut self, vs: impl IntoIterator<Item = &'a Value>) {
        for v in vs {
            self.val(v);
        }
    }

    /// A local captured by a closure holds its cell's raw index, which reads as a tiny number: any slot that could be
    /// one counts as one, which at worst keeps a cell longer.
    fn slots(&mut self, slots: &[Slot]) {
        for s in slots {
            if s.0 < self.cells.len() as u64 {
                self.cell(s.0 as u32);
                continue;
            }
            self.val(&s.get());
        }
    }

    fn frame(&mut self, f: &Frame) {
        self.vals(f.extra.iter());
        for c in f.upvals.iter() {
            self.cell(*c);
        }
        if let crate::vm::FrameKind::Generator(g, _) = f.kind {
            self.id(g);
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
            | Kind::Live(_) => {}
            Kind::StrIter { s, .. } => self.marks.str(*s),
            Kind::Namespace(ns) => {
                if !ns.is_root() {
                    self.id(ns.parent);
                }
            }
            Kind::Array(items) | Kind::Arguments(items) => self.vals(items.iter()),
            Kind::ListIter { items, .. } => self.vals(items.iter()),
            Kind::Closure(c) => {
                self.val(&c.this);
                for u in c.upvals.iter() {
                    self.cell(*u);
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

/// Marks every object reachable from the run's roots; the objects every fresh run makes are roots too.
pub fn reachable(vm: &Vm) -> Vec<bool> {
    let mut w = Walk {
        heap: &vm.heap,
        cells: &vm.cells,
        marks: Seen(vec![false; vm.heap.len()]),
        todo: Vec::new(),
    };
    for id in 0..vm.snapshot_base.heap.min(vm.heap.len()) {
        w.id(id as Id);
    }
    w.slots(&vm.cells);
    roots(&mut w, vm);
    w.drain();
    w.marks.0
}

/// Meets what the run holds outside its heap, but for its cells and the objects every fresh run makes.
pub(crate) fn roots<M: Marks>(w: &mut Walk<'_, M>, vm: &Vm) {
    w.slots(&vm.stack);
    for f in &vm.frames {
        w.frame(f);
    }
    w.vals(vm.globals.iter());
    w.vals(vm.global_map.values());
    w.vals(vm.consts.iter());
    for t in vm.template_objs_ref().iter().flatten() {
        w.id(*t);
    }
    for j in &vm.jobs {
        match j {
            Job::Reaction(r, o) => {
                w.reaction(r);
                w.outcome(o);
            }
            Job::Thenable {
                promise,
                thenable,
                then,
            } => {
                w.id(*promise);
                w.val(thenable);
                w.val(then);
            }
        }
    }
    for (p, _) in &vm.inbox {
        w.id(*p);
    }
    for c in &vm.coroutines {
        if let Some(s) = &c.saved {
            w.saved(s);
        }
        if let Some(p) = c.promise {
            w.id(p);
        }
    }
    let h = &vm.host;
    for call in &h.calls {
        w.id(call.promise);
    }
    for r in &h.restarts {
        w.id(r.promise);
    }
    for id in h.suggestions.keys() {
        w.id(*id);
    }
    if let Some(p) = h.promise_like {
        w.id(p);
    }
    for (p, v) in &h.unhandled {
        w.id(*p);
        w.val(v);
    }
    w.vals(h.modules_loaded.values());
    w.vals(h.namespaces.values());
    if let Some(o) = &vm.outcome {
        w.outcome(o);
    }
}
