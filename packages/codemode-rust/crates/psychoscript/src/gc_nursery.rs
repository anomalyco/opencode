//! A moving generational collector (`gc-nursery` builds only).
//!
//! Allocation stays a `Vec::push`. What a run made since its last collection (the objects, strings and closure cells at
//! the end of their tables) is the nursery. A minor collection marks the nursery from the roots and from the old
//! objects and cells written since (the remembered set, kept by `Heap`'s write barrier and `remember_cell`), slides
//! the survivors down in order and rewrites every handle that pointed into the nursery; the survivors are old from then
//! on. Once the old generation has doubled since the last full collection, a collection takes everything above the
//! fresh runtime's objects (`snapshot_base`, which never move) the same way.
//!
//! Collections only happen at safe points, where every live value is in the VM's own structures: a back-edge of the
//! outermost run, and a job boundary of `Vm::drive`.

use std::sync::{Arc, OnceLock};
use std::time::Instant;

use crate::object::*;
use crate::strings::{NO_GROW, NO_WTF, StrBuf, StrId, Strings};
use crate::value::{Id, Slot, Value};
use crate::vm::{
    Frame, FrameKind, Job, MAX_OBJECTS, MAX_STRINGS, Reaction, Resume, SavedFrame, Vm,
};

/// Objects, strings or cells a run makes before its first collection, so short runs never collect.
const FIRST: usize = 64 * 1024;
/// Objects, strings or cells made between minor collections.
const NURSERY: usize = 32 * 1024;
/// A full collection starts once an old generation doubled since the last one and holds at least this many.
const FULL_MIN: usize = 64 * 1024;
/// Marks a nursery slot nothing reached.
const DEAD: u32 = u32::MAX;
/// Dead objects (and as many dead strings) one sweep step drops: freeing them, not finding them, is most of what a
/// collection costs, so it is spread over the allocations after it.
const SWEEP: usize = 1024;
/// Allocations between sweep steps.
const SWEEP_EVERY: usize = 256;

/// `PSYCHOSCRIPT_GC_STRESS=1`: collect at every safe point after any allocation, fully every eighth time.
fn stress() -> bool {
    static ON: OnceLock<bool> = OnceLock::new();
    *ON.get_or_init(|| std::env::var_os("PSYCHOSCRIPT_GC_STRESS").is_some_and(|v| v == "1"))
}

/// The object table with its write barrier: a write to an old object remembers it once, so the next minor collection
/// finds the nursery objects it may now point to.
pub struct Heap {
    objs: Vec<Obj>,
    /// Objects below this survived a collection.
    old: usize,
    remembered: Vec<Id>,
    bits: Vec<u64>,
}

impl Heap {
    pub fn with_capacity(n: usize) -> Heap {
        Heap {
            objs: Vec::with_capacity(n),
            old: 0,
            remembered: Vec::new(),
            bits: Vec::new(),
        }
    }

    #[inline(always)]
    pub fn push(&mut self, o: Obj) {
        self.objs.push(o);
    }

    /// Every object, mutably and past the barrier: only for writes that store no handle.
    pub fn iter_mut(&mut self) -> std::slice::IterMut<'_, Obj> {
        self.objs.iter_mut()
    }

    #[cold]
    #[inline(never)]
    fn remember(&mut self, i: usize) {
        let bit = 1u64 << (i & 63);
        if self.bits[i >> 6] & bit == 0 {
            self.bits[i >> 6] |= bit;
            self.remembered.push(i as Id);
        }
    }
}

impl std::ops::Deref for Heap {
    type Target = [Obj];

    #[inline(always)]
    fn deref(&self) -> &[Obj] {
        &self.objs
    }
}

impl std::ops::Index<usize> for Heap {
    type Output = Obj;

    #[inline(always)]
    fn index(&self, i: usize) -> &Obj {
        &self.objs[i]
    }
}

impl std::ops::IndexMut<usize> for Heap {
    #[inline(always)]
    fn index_mut(&mut self, i: usize) -> &mut Obj {
        if i < self.old {
            self.remember(i);
        }
        &mut self.objs[i]
    }
}

/// The collector's state beside the heap.
pub struct Gc {
    /// The object, string and cell counts that ask for the next sweep step or collection.
    pub limit: usize,
    pub str_limit: usize,
    pub cell_limit: usize,
    /// A collection waits for the next safe point.
    pub wanted: bool,
    /// The collector set `suspend_wanted` to reach a safe point; nobody asked for a suspend.
    pub owns_suspend: bool,
    /// Cells below this survived a collection; writes to them are remembered.
    pub cell_old: usize,
    str_old: usize,
    cells_remembered: Vec<u32>,
    cell_bits: Vec<u64>,
    /// How long each text buffer was, and how many carriers there were, after the last collection: text past that
    /// belongs to the nursery's strings.
    grow_marks: Vec<u32>,
    wtf_mark: usize,
    /// The atoms there were after the last collection: older ones name old strings, which a minor collection skips.
    atom_mark: usize,
    /// The old objects, strings and cells right after the last full collection.
    full_live: [usize; 3],
    collections: u64,
    /// The object, string and cell counts that start the next collection.
    next: [usize; 3],
    /// What the last collection found dead, dropped a little at a time.
    dead: Vec<Obj>,
    dead_strs: Vec<StrBuf>,
}

impl Default for Gc {
    fn default() -> Self {
        let first = if stress() { 0 } else { FIRST };
        Gc {
            limit: first,
            str_limit: first,
            cell_limit: first,
            wanted: false,
            owns_suspend: false,
            cell_old: 0,
            str_old: 0,
            cells_remembered: Vec::new(),
            cell_bits: Vec::new(),
            grow_marks: Vec::new(),
            wtf_mark: 0,
            atom_mark: 0,
            full_live: [0; 3],
            collections: 0,
            next: [first; 3],
            dead: Vec::new(),
            dead_strs: Vec::new(),
        }
    }
}

impl Vm {
    /// An allocation crossed a limit: take a sweep step, or collect at the next safe point, which a suspend request
    /// reaches.
    #[cold]
    #[inline(never)]
    pub(crate) fn gc_request(&mut self) {
        let lens = [self.heap.len(), self.atoms.bufs.len(), self.cells.len()];
        if (0..3).all(|k| lens[k] < self.gc.next[k]) {
            return self.sweep_step();
        }
        self.gc.wanted = true;
        self.gc.limit = MAX_OBJECTS;
        self.gc.str_limit = MAX_STRINGS;
        self.gc.cell_limit = usize::MAX;
        if !self.suspend_wanted {
            self.suspend_wanted = true;
            self.gc.owns_suspend = true;
        }
    }

    /// An old cell was written: it may hold a nursery value now.
    #[cold]
    #[inline(never)]
    pub(crate) fn remember_cell(&mut self, c: usize) {
        let g = &mut self.gc;
        let bit = 1u64 << (c & 63);
        if g.cell_bits[c >> 6] & bit == 0 {
            g.cell_bits[c >> 6] |= bit;
            g.cells_remembered.push(c as u32);
        }
    }

    /// A safe point: collects if a collection is due. Returns whether the run should still stop for a suspend.
    #[cold]
    #[inline(never)]
    pub(crate) fn gc_safe_point(&mut self) -> bool {
        if !self.gc.wanted {
            return self.suspend_wanted;
        }
        // A conversion replay holds values outside the VM; a VM no driver set up has roots outside it.
        if self.replay_meter.is_none()
            && self.replay.is_empty()
            && self.convert_req.is_none()
            && self.snapshot_base.heap > 0
        {
            self.collect();
            self.gc.wanted = false;
            if std::mem::take(&mut self.gc.owns_suspend) {
                self.suspend_wanted = false;
            }
        }
        self.suspend_wanted && !self.gc.owns_suspend
    }

    fn collect(&mut self) {
        let started = Instant::now();
        let base = self.snapshot_base;
        self.gc.collections += 1;
        let lens = [self.heap.len(), self.atoms.bufs.len(), self.cells.len()];
        let olds = [
            self.heap.old.saturating_sub(base.heap),
            self.gc.str_old.saturating_sub(base.bufs),
            self.gc.cell_old.saturating_sub(base.cells),
        ];
        let full = self.gc.collections == 1
            || (stress() && self.gc.collections.is_multiple_of(8))
            || (0..3).any(|k| olds[k] >= FULL_MIN.max(2 * self.gc.full_live[k]));
        let starts = if full {
            [base.heap, base.bufs, base.cells]
        } else {
            [self.heap.old, self.gc.str_old, self.gc.cell_old]
        };
        let from = [0, 1, 2].map(|k| starts[k].min(lens[k]));
        let old_objs: Vec<Id> = if full {
            (0..from[0] as Id).collect()
        } else {
            std::mem::take(&mut self.heap.remembered)
        };
        let old_cells: Vec<u32> = if full {
            (0..from[2] as u32).collect()
        } else {
            std::mem::take(&mut self.gc.cells_remembered)
        };

        let mut m = Mark {
            from,
            fwd: [0, 1, 2].map(|k| vec![DEAD; lens[k] - from[k]]),
            objs: Vec::new(),
            cells: Vec::new(),
        };
        let atoms = if full { 0 } else { self.gc.atom_mark };
        roots(self, &mut m, atoms);
        for id in &old_objs {
            object(&mut self.heap.objs[*id as usize], &mut m);
        }
        for c in &old_cells {
            slot(&mut self.cells[*c as usize], &mut m);
        }
        loop {
            if let Some(id) = m.objs.pop() {
                object(&mut self.heap.objs[id as usize], &mut m);
                continue;
            }
            let Some(c) = m.cells.pop() else { break };
            slot(&mut self.cells[c as usize], &mut m);
        }
        #[cfg(feature = "gc-stats")]
        self.publish_stats();

        // Each survivor's new index, then the survivors slid down to it in order.
        let mut ends = from;
        for k in 0..3 {
            for f in m.fwd[k].iter_mut().filter(|f| **f != DEAD) {
                *f = ends[k] as u32;
                ends[k] += 1;
            }
        }
        let dead = slide(&mut self.heap.objs, from[0], &m.fwd[0], || {
            Obj::new(None, Kind::Ordinary)
        });
        let dead_strs = slide(&mut self.atoms.bufs, from[1], &m.fwd[1], StrBuf::hole);
        slide(&mut self.cells, from[2], &m.fwd[2], Slot::default);
        // Stress mode drops them at once, so a failing drop shows where it happens.
        if !stress() {
            bury(&mut self.gc.dead, dead);
            bury(&mut self.gc.dead_strs, dead_strs);
        }
        let marks = if full {
            Vec::new()
        } else {
            std::mem::take(&mut self.gc.grow_marks)
        };
        let wtf_mark = if full { 0 } else { self.gc.wtf_mark };
        let texts = if full { 0 } else { from[1] };
        compact_text(&mut self.atoms, texts..ends[1], &marks, wtf_mark);
        // Survivors are old now and must never change: `+=` copies an old string instead of appending to it.
        for b in &mut self.atoms.bufs[from[1]..] {
            b.builder = false;
        }

        let mut w = Rewrite(&m);
        roots(self, &mut w, atoms);
        for id in old_objs.iter().copied().chain(from[0] as Id..ends[0] as Id) {
            object(&mut self.heap.objs[id as usize], &mut w);
        }
        for c in old_cells
            .iter()
            .copied()
            .chain(from[2] as u32..ends[2] as u32)
        {
            slot(&mut self.cells[c as usize], &mut w);
        }

        let h = &mut self.heap;
        for id in old_objs.iter().filter(|_| !full) {
            h.bits[*id as usize >> 6] = 0;
        }
        if full {
            h.bits.clear();
        }
        h.remembered.clear();
        h.old = ends[0];
        h.bits.resize(ends[0].div_ceil(64), 0);
        let g = &mut self.gc;
        for c in old_cells.iter().filter(|_| !full) {
            g.cell_bits[*c as usize >> 6] = 0;
        }
        if full {
            g.cell_bits.clear();
            g.full_live = [
                ends[0] - base.heap.min(ends[0]),
                ends[1] - base.bufs.min(ends[1]),
                ends[2] - base.cells.min(ends[2]),
            ];
        }
        g.cells_remembered.clear();
        g.cell_old = ends[2];
        g.cell_bits.resize(ends[2].div_ceil(64), 0);
        g.str_old = ends[1];
        g.grow_marks = self.atoms.grow.iter().map(|b| b.len() as u32).collect();
        g.wtf_mark = self.atoms.wtf.len();
        g.atom_mark = self.atoms.atom_str.len();
        let room = if stress() { 1 } else { NURSERY };
        g.next = [
            (ends[0] + room).min(MAX_OBJECTS),
            (ends[1] + room).min(MAX_STRINGS),
            ends[2] + room,
        ];
        self.set_limits();
        #[cfg(feature = "gc-stats")]
        self.record_pause(started.elapsed().as_nanos() as u64);
        let _ = started;
    }

    /// Drops some of what the last collection found dead.
    fn sweep_step(&mut self) {
        let started = Instant::now();
        let g = &mut self.gc;
        g.dead.truncate(g.dead.len().saturating_sub(SWEEP));
        g.dead_strs
            .truncate(g.dead_strs.len().saturating_sub(SWEEP));
        if g.dead.is_empty() && g.dead_strs.is_empty() {
            g.dead = Vec::new();
            g.dead_strs = Vec::new();
        }
        self.set_limits();
        #[cfg(feature = "gc-stats")]
        self.record_pause(started.elapsed().as_nanos() as u64);
        let _ = started;
    }

    /// The next collection's thresholds, or sooner while dead objects wait to be dropped.
    fn set_limits(&mut self) {
        let lens = [self.heap.len(), self.atoms.bufs.len(), self.cells.len()];
        let g = &mut self.gc;
        let sweeping = !g.dead.is_empty() || !g.dead_strs.is_empty();
        let [limit, str_limit, cell_limit] = [0, 1, 2].map(|k| match sweeping {
            true => (lens[k] + SWEEP_EVERY).min(g.next[k]),
            false => g.next[k],
        });
        g.limit = limit;
        g.str_limit = str_limit;
        g.cell_limit = cell_limit;
    }
}

/// Adds what a collection found dead to what waits to be dropped, without copying in the usual case.
fn bury<T>(graveyard: &mut Vec<T>, dead: Vec<T>) {
    if graveyard.is_empty() {
        *graveyard = dead;
        return;
    }
    graveyard.extend(dead);
}

/// Moves the survivors at or above `from` down to their new indexes; returns the rest. When fewer stay than go (a
/// first or full collection), what stays moves to a new table instead and the old one is returned with holes, so the
/// copy is the smaller side.
fn slide<T>(items: &mut Vec<T>, from: usize, fwd: &[u32], hole: fn() -> T) -> Vec<T> {
    let mut next = from;
    for (i, f) in fwd.iter().enumerate() {
        if *f == DEAD {
            continue;
        }
        if next != from + i {
            items.swap(next, from + i);
        }
        next += 1;
    }
    if next >= items.len() - next {
        return items.split_off(next);
    }
    // A power of two, as the table grows, so the allocator can reuse the buffers it frees.
    let mut kept = Vec::with_capacity((next + NURSERY).next_power_of_two());
    kept.extend(
        items[..next]
            .iter_mut()
            .map(|o| std::mem::replace(o, hole())),
    );
    std::mem::replace(items, kept)
}

/// Frees the text of dead strings: each text buffer keeps what it held at the last collection (`marks`; nothing after
/// a full one), then the text of each surviving string in `survivors` that reaches past that, copied in order. The
/// buffers made since then that hold no survivor go away. Carriers' code units move the same way past `wtf_mark`.
fn compact_text(
    s: &mut Strings,
    survivors: std::ops::Range<usize>,
    marks: &[u32],
    wtf_mark: usize,
) {
    let kept = marks.len().min(s.grow.len());
    let tails: Vec<String> = s
        .grow
        .iter_mut()
        .enumerate()
        .map(|(g, b)| match marks.get(g).map_or(0, |m| *m as usize) {
            0 => std::mem::take(b),
            m => b.split_off(m.min(b.len())),
        })
        .collect();
    let mut wtf_tail = s.wtf.split_off(wtf_mark.min(s.wtf.len()));
    let mut young: Vec<String> = Vec::new();
    let mut renumber = vec![DEAD; s.grow.len()];
    for i in survivors {
        let b = &mut s.bufs[i];
        if b.grow == NO_GROW {
            if b.aux != NO_WTF && b.aux as usize >= wtf_mark {
                let units = std::mem::take(&mut wtf_tail[b.aux as usize - wtf_mark]);
                b.aux = s.wtf.len() as u32;
                s.wtf.push(units);
            }
            continue;
        }
        let g = b.grow as usize;
        let (aux, end) = (b.aux as usize, (b.aux + b.len) as usize);
        let m = marks.get(g).map_or(0, |m| *m as usize);
        if end <= m {
            continue;
        }
        let tail = tails[g].get(aux.max(m) - m..end - m).unwrap_or_default();
        if g < kept {
            let dest = &mut s.grow[g];
            b.aux = dest.len() as u32;
            if aux < m {
                dest.extend_from_within(aux..m);
            }
            dest.push_str(tail);
            continue;
        }
        if renumber[g] == DEAD {
            renumber[g] = (kept + young.len()) as u32;
            young.push(String::with_capacity(tail.len()));
        }
        b.grow = renumber[g];
        let dest = &mut young[renumber[g] as usize - kept];
        b.aux = dest.len() as u32;
        dest.push_str(tail);
    }
    s.grow.truncate(kept);
    s.grow.extend(young);
    // `DEAD` is `NO_GROW`: a short strings' buffer that held no survivor is made again when next used.
    if s.arena != NO_GROW && s.arena as usize >= kept {
        s.arena = renumber[s.arena as usize];
    }
}

/// What a walk does with each handle it meets: mark it, or move it to its new index.
trait Visit {
    const MOVES: bool;
    fn obj(&mut self, id: &mut Id);
    fn str(&mut self, s: &mut StrId);
    fn cell(&mut self, c: &mut u32);
}

/// Marks what the nursery spaces (`from` on) hold that a walk reaches; objects and cells wait in `objs` and `cells`
/// to be walked in turn.
struct Mark {
    from: [usize; 3],
    /// For each nursery slot, `DEAD` until something reaches it, then (once marking is over) its new index.
    fwd: [Vec<u32>; 3],
    objs: Vec<Id>,
    cells: Vec<u32>,
}

impl Mark {
    fn reach(&mut self, k: usize, i: u32) -> bool {
        let Some(f) = (i as usize)
            .checked_sub(self.from[k])
            .and_then(|at| self.fwd[k].get_mut(at))
        else {
            return false;
        };
        let fresh = *f == DEAD;
        *f = 0;
        fresh
    }
}

impl Visit for Mark {
    const MOVES: bool = false;

    fn obj(&mut self, id: &mut Id) {
        if self.reach(0, *id) {
            self.objs.push(*id);
        }
    }

    fn str(&mut self, s: &mut StrId) {
        self.reach(1, *s);
    }

    fn cell(&mut self, c: &mut u32) {
        if self.reach(2, *c) {
            self.cells.push(*c);
        }
    }
}

/// Moves each handle into the nursery to where its target slid.
struct Rewrite<'m>(&'m Mark);

impl Rewrite<'_> {
    fn to(&self, k: usize, i: &mut u32) {
        let m = self.0;
        if let Some(at) = (*i as usize).checked_sub(m.from[k])
            && let Some(f) = m.fwd[k].get(at)
        {
            debug_assert!(*f != DEAD, "a live handle ({k}, {i}) was not marked");
            if *f != DEAD {
                *i = *f;
            }
        }
    }
}

impl Visit for Rewrite<'_> {
    const MOVES: bool = true;

    fn obj(&mut self, id: &mut Id) {
        self.to(0, id);
    }

    fn str(&mut self, s: &mut StrId) {
        self.to(1, s);
    }

    fn cell(&mut self, c: &mut u32) {
        self.to(2, c);
    }
}

fn val(v: &mut Value, x: &mut impl Visit) {
    match v {
        Value::Obj(id) => x.obj(id),
        Value::Str(s) => x.str(s),
        _ => {}
    }
}

fn vals<'a>(vs: impl IntoIterator<Item = &'a mut Value>, x: &mut impl Visit) {
    for v in vs {
        val(v, x);
    }
}

fn opt_id(id: &mut Option<Id>, x: &mut impl Visit) {
    if let Some(id) = id {
        x.obj(id);
    }
}

fn slot(s: &mut Slot, x: &mut impl Visit) {
    if s.is_cell() {
        let mut c = s.payload();
        x.cell(&mut c);
        *s = Slot::cell(c as usize);
        return;
    }
    let mut v = s.get();
    if matches!(v, Value::Obj(_) | Value::Str(_)) {
        val(&mut v, x);
        *s = Slot::pack(v);
    }
}

fn slots<'a>(ss: impl IntoIterator<Item = &'a mut Slot>, x: &mut impl Visit) {
    for s in ss {
        slot(s, x);
    }
}

/// A shared list of handles: visited in place while marking, replaced by a moved copy when anything in it moves.
fn shared<T: Copy, V: Visit>(
    list: &mut Arc<[T]>,
    x: &mut V,
    each: fn(&mut T, &mut V),
    bits: fn(&T) -> u64,
) {
    if !V::MOVES {
        for item in list.iter() {
            let mut item = *item;
            each(&mut item, x);
        }
        return;
    }
    let moved: Vec<T> = list
        .iter()
        .map(|item| {
            let mut item = *item;
            each(&mut item, x);
            item
        })
        .collect();
    if moved
        .iter()
        .zip(list.iter())
        .any(|(a, b)| bits(a) != bits(b))
    {
        *list = moved.into();
    }
}

fn frame(f: &mut Frame, x: &mut impl Visit) {
    vals(f.extra.iter_mut(), x);
    if let FrameKind::Generator(g, resume) = &mut f.kind {
        x.obj(g);
        if let Resume::Collect(a) = resume {
            x.obj(a);
        }
    }
    shared(&mut f.upvals, x, |c, x| x.cell(c), |c| *c as u64);
}

fn saved(s: &mut SavedFrame, x: &mut impl Visit) {
    if let Some(f) = &mut s.frame {
        frame(f, x);
    }
    for f in &mut s.above {
        frame(f, x);
    }
    slots(s.stack.iter_mut(), x);
}

fn gen_state(g: &mut GenState, x: &mut impl Visit) {
    match g {
        GenState::Suspended(s) | GenState::Running(s) => saved(s, x),
        GenState::Done => {}
    }
}

fn outcome(o: &mut Result<Value, Value>, x: &mut impl Visit) {
    match o {
        Ok(v) | Err(v) => val(v, x),
    }
}

fn reaction(r: &mut Reaction, x: &mut impl Visit) {
    match r {
        Reaction::Then {
            on_ful,
            on_rej,
            derived,
        } => {
            val(on_ful, x);
            val(on_rej, x);
            x.obj(derived);
        }
        Reaction::Await(_) | Reaction::Program => {}
        Reaction::Resolve(id)
        | Reaction::Cross(id)
        | Reaction::AwaitGen(id)
        | Reaction::GenReturn(id)
        | Reaction::Comb { comb: id, .. } => x.obj(id),
        Reaction::Finally { cleanup, derived } => {
            val(cleanup, x);
            x.obj(derived);
        }
        Reaction::Restore {
            derived,
            outcome: o,
        } => {
            x.obj(derived);
            outcome(o, x);
        }
        Reaction::FromSync { made, close, .. } => {
            x.obj(made);
            opt_id(close, x);
        }
    }
}

fn map<V: Visit>(m: &mut OrderedMap, x: &mut V) {
    for (k, v) in m.entries.iter_mut().flatten() {
        val(k, x);
        val(v, x);
    }
    if V::MOVES {
        m.remap_objects(|mut id| {
            x.obj(&mut id);
            id
        });
    }
}

fn object(o: &mut Obj, x: &mut impl Visit) {
    opt_id(&mut o.proto, x);
    for p in &mut o.props.items {
        val(&mut p.value, x);
    }
    match &mut o.kind {
        Kind::Ordinary
        | Kind::Error(_)
        | Kind::RegExp(_)
        | Kind::Date(_)
        | Kind::Bytes(_)
        | Kind::TextDecoder(_)
        | Kind::Headers(_)
        | Kind::Live(_) => {}
        Kind::StrIter { s, .. } => x.str(s),
        Kind::Namespace(ns) => {
            if !ns.is_root() {
                x.obj(&mut ns.parent);
            }
        }
        Kind::Array(items) | Kind::Arguments(items) => vals(items.iter_mut(), x),
        Kind::ListIter { items, .. } => shared(items, x, val, |v| Slot::pack(*v).0),
        Kind::Closure(c) => {
            shared(&mut c.upvals, x, |c, x| x.cell(c), |c| *c as u64);
            val(&mut c.this, x);
        }
        Kind::Native { data, .. } => val(data, x),
        Kind::Bound(b) => {
            val(&mut b.0, x);
            val(&mut b.1, x);
            vals(b.2.iter_mut(), x);
        }
        Kind::Promise(p) => {
            match &mut p.state {
                PromiseState::Pending => {}
                PromiseState::Fulfilled(v) | PromiseState::Rejected(v) => val(v, x),
            }
            for r in &mut p.reactions {
                reaction(r, x);
            }
        }
        Kind::Map(m) | Kind::Set(m) | Kind::WeakMap(m) | Kind::WeakSet(m) => map(m, x),
        Kind::Generator(g) => gen_state(g, x),
        Kind::ArrayIter { target, .. }
        | Kind::MapIter { target, .. }
        | Kind::ExoticIter { target, .. } => x.obj(target),
        Kind::Resolvers { promise, .. } => x.obj(promise),
        Kind::Cross(c) => {
            vals(c.roots.iter_mut(), x);
            vals(c.crossed.iter_mut(), x);
            vals(c.ancestors.iter_mut(), x);
            for v in &mut c.stack {
                val(&mut v.holder, x);
                val(&mut v.key, x);
                match &mut v.step {
                    crate::cross::Step::Start => {}
                    crate::cross::Step::Array { target, out, .. } => {
                        val(target, x);
                        x.obj(out);
                    }
                    crate::cross::Step::Object {
                        target, out, names, ..
                    } => {
                        val(target, x);
                        x.obj(out);
                        vals(names.iter_mut(), x);
                    }
                }
            }
        }
        Kind::Combinator(c) => {
            x.obj(&mut c.promise);
            vals(c.values.iter_mut(), x);
        }
        Kind::IterHelper(h) => {
            use crate::builtins::iterator::HelperOp;
            val(&mut h.iter, x);
            val(&mut h.next, x);
            val(&mut h.site, x);
            match &mut h.op {
                HelperOp::Map(f) | HelperOp::Filter(f) => val(f, x),
                HelperOp::FlatMap(f, inner) => {
                    val(f, x);
                    if let Some((a, b)) = inner {
                        val(a, x);
                        val(b, x);
                    }
                }
                HelperOp::Wrap | HelperOp::Take(_) | HelperOp::Drop(_) => {}
            }
        }
        Kind::Url(u) => x.obj(&mut u.params),
        Kind::SearchParams(p) => opt_id(&mut p.url, x),
        Kind::AsyncGenerator(a) => {
            gen_state(&mut a.state, x);
            for r in &mut a.queue {
                val(&mut r.value, x);
                x.obj(&mut r.promise);
            }
        }
        Kind::AsyncFromSync { sync, next } => {
            x.obj(sync);
            val(next, x);
        }
    }
}

/// Every handle the VM holds outside its objects and cells: `reach::reachable`'s roots, and what a run in progress
/// also holds (the host's queued calls and tasks, the realm, the strings it keeps). Atoms before `atoms` are skipped.
fn roots(vm: &mut Vm, x: &mut impl Visit, atoms: usize) {
    slots(vm.stack.iter_mut(), x);
    for f in &mut vm.frames {
        frame(f, x);
    }
    vals(vm.globals.iter_mut(), x);
    vals(vm.global_map.values_mut(), x);
    vals(vm.consts.iter_mut(), x);
    for t in &mut vm.templates {
        vals(t.cooked.iter_mut().flatten(), x);
        vals(t.raw.iter_mut(), x);
    }
    for t in vm.template_objs_mut().iter_mut() {
        opt_id(t, x);
    }
    for j in &mut vm.jobs {
        match j {
            Job::Reaction(r, o) => {
                reaction(r, x);
                outcome(o, x);
            }
            Job::Thenable {
                promise,
                thenable,
                then,
            } => {
                x.obj(promise);
                val(thenable, x);
                val(then, x);
            }
        }
    }
    for (p, _) in &mut vm.inbox {
        x.obj(p);
    }
    for c in &mut vm.coroutines {
        if let Some(s) = &mut c.saved {
            saved(s, x);
        }
        opt_id(&mut c.promise, x);
    }
    if let Some(o) = &mut vm.outcome {
        outcome(o, x);
    }
    let new_atoms = vm.atoms.atom_str.iter_mut().skip(atoms);
    for s in vm.char_strs.iter_mut().chain(new_atoms) {
        x.str(s);
    }
    realm(&mut vm.realm, x);
    let h = &mut vm.host;
    for call in &mut h.calls {
        x.obj(&mut call.promise);
    }
    for r in &mut h.restarts {
        x.obj(&mut r.promise);
    }
    for q in &mut h.queued {
        match q {
            crate::host::Queued::Call(p, _, r, _) => {
                x.obj(p);
                x.obj(&mut r.promise);
            }
            crate::host::Queued::Work(p, _, call) => {
                x.obj(p);
                x.obj(&mut call.promise);
            }
        }
    }
    for tag in h.tasks.tags_mut() {
        x.obj(tag);
    }
    if !h.suggestions.is_empty() {
        h.suggestions = std::mem::take(&mut h.suggestions)
            .into_iter()
            .map(|(mut id, s)| {
                x.obj(&mut id);
                (id, s)
            })
            .collect();
    }
    opt_id(&mut h.promise_like, x);
    for (p, v) in &mut h.unhandled {
        x.obj(p);
        val(v, x);
    }
    vals(h.modules_loaded.values_mut(), x);
    vals(h.namespaces.values_mut(), x);
}

fn realm(r: &mut crate::vm::Realm, x: &mut impl Visit) {
    let s = &mut r.std;
    for id in [
        &mut r.object_proto,
        &mut r.function_proto,
        &mut r.array_proto,
        &mut r.string_proto,
        &mut r.number_proto,
        &mut r.boolean_proto,
        &mut r.symbol_proto,
        &mut r.error_proto,
        &mut r.type_error_proto,
        &mut r.range_error_proto,
        &mut r.syntax_error_proto,
        &mut r.reference_error_proto,
        &mut r.aggregate_error_proto,
        &mut r.promise_proto,
        &mut r.promise_then,
        &mut r.map_proto,
        &mut r.set_proto,
        &mut r.generator_proto,
        &mut r.async_generator_proto,
        &mut r.generator_function_proto,
        &mut r.async_function_proto,
        &mut r.async_generator_function_proto,
        &mut r.async_from_sync_proto,
        &mut r.generator_next,
        &mut r.iter_proto,
        &mut s.regexp,
        &mut s.date,
        &mut s.uint8,
        &mut s.buffer,
        &mut s.text_encoder,
        &mut s.text_decoder,
        &mut s.weak_map,
        &mut s.weak_set,
        &mut s.iterator_helper,
        &mut s.uri_error,
        &mut s.url,
        &mut s.params,
        &mut s.headers,
    ] {
        x.obj(id);
    }
}
