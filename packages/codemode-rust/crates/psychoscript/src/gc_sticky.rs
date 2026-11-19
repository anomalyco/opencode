//! A non-moving generational collector with sticky mark bits (`gc-sticky` builds), after Demers et al.: an object
//! marked by one collection stays marked, and so old, until the next major one. A minor collection marks from the
//! roots and from the old objects written since the last collection (the remembered set, which `Heap`'s write
//! barrier fills), walks only young objects, and sweeps only those allocated since. A major collection clears every
//! mark and sweeps the whole heap. Nothing moves, so ids stay stable; freed slots go on free lists.
//!
//! Collection happens only where the run stops with every value in VM structures, as a suspend stops it: `alloc` and
//! the step budget ask for a stop (`suspend_wanted`), and `Vm::run_until_stop` collects there and goes on. A run does
//! no collector work at all until it crosses its first threshold, and an idle run none until it allocates again.

use std::borrow::Cow;
use std::sync::OnceLock;
use std::time::Instant;

use crate::object::Obj;
use crate::reach::{Marks, Walk};
use crate::strings::{NO_GROW, NO_WTF, StrBuf, StrId, Strings};
use crate::value::{Id, Slot, Value};
use crate::vm::{MAX_OBJECTS, Vm};

/// Collector states of objects, cells and strings. A young slot is unmarked; a free one is on a free list.
pub const YOUNG: u8 = 0;
pub const OLD: u8 = 1;
/// Old, and in the remembered set.
pub const REMEMBERED: u8 = 2;
const FREE: u8 = 3;

/// Tuning, read once from the environment: the stress mode (`PSYCHOSCRIPT_GC_STRESS=1`) collects as often as it can;
/// `PSYCHOSCRIPT_GC_EVENT=0` turns off the collection at host stops; the other two size the first threshold and the
/// nursery, for measuring.
struct Knobs {
    stress: bool,
    event: bool,
    first: usize,
    nursery: usize,
}

fn knobs() -> &'static Knobs {
    static K: OnceLock<Knobs> = OnceLock::new();
    K.get_or_init(|| {
        let var = |k: &str| std::env::var(k).ok();
        let num = |k: &str, d: usize| var(k).and_then(|v| v.parse().ok()).unwrap_or(d);
        let stress = var("PSYCHOSCRIPT_GC_STRESS").is_some_and(|v| v == "1");
        Knobs {
            stress,
            event: var("PSYCHOSCRIPT_GC_EVENT").is_none_or(|v| v != "0"),
            first: if stress {
                0
            } else {
                num("PSYCHOSCRIPT_GC_FIRST", 32_768)
            },
            nursery: if stress {
                1
            } else {
                num("PSYCHOSCRIPT_GC_NURSERY", 16_384)
            },
        }
    })
}

/// A host stop collects once the run allocated this much since the last collection.
const EVENT_MIN: usize = 4_096;

/// The heap size at which `alloc` first takes its slow path.
pub fn first_limit() -> usize {
    knobs().first.min(MAX_OBJECTS)
}

/// The run's objects by id. Taking one mutably goes through the write barrier.
pub struct Heap {
    objs: Vec<Obj>,
    /// Each object's collector state once the collector started, else empty.
    pub(crate) state: Vec<u8>,
    /// Old objects taken mutably since the last collection, which may now refer to young ones.
    pub(crate) remembered: Vec<Id>,
}

impl Heap {
    pub fn with_capacity(n: usize) -> Heap {
        Heap {
            objs: Vec::with_capacity(n),
            state: Vec::new(),
            remembered: Vec::new(),
        }
    }

    #[inline]
    pub fn push(&mut self, o: Obj) {
        self.objs.push(o);
    }

    /// Every object, mutably, past the write barrier: only for fields that hold no references.
    pub fn iter_mut(&mut self) -> std::slice::IterMut<'_, Obj> {
        self.objs.iter_mut()
    }

    /// An object replaced without the write barrier, for the collector itself.
    pub(crate) fn put(&mut self, id: usize, o: Obj) {
        self.objs[id] = o;
    }

    #[cold]
    #[inline(never)]
    fn remember(&mut self, id: usize) {
        self.state[id] = REMEMBERED;
        self.remembered.push(id as Id);
    }
}

impl std::ops::Deref for Heap {
    type Target = [Obj];

    #[inline(always)]
    fn deref(&self) -> &[Obj] {
        &self.objs
    }
}

impl<I: std::slice::SliceIndex<[Obj]>> std::ops::Index<I> for Heap {
    type Output = I::Output;

    #[inline(always)]
    fn index(&self, i: I) -> &I::Output {
        &self.objs[i]
    }
}

impl std::ops::IndexMut<usize> for Heap {
    #[inline(always)]
    fn index_mut(&mut self, i: usize) -> &mut Obj {
        if self.state.get(i) == Some(&OLD) {
            self.remember(i);
        }
        &mut self.objs[i]
    }
}

impl<'a> IntoIterator for &'a Heap {
    type Item = &'a Obj;
    type IntoIter = std::slice::Iter<'a, Obj>;

    fn into_iter(self) -> Self::IntoIter {
        self.objs.iter()
    }
}

#[derive(Default)]
pub struct Gc {
    pub active: bool,
    /// A collection is due at the next stop.
    pub wanted: bool,
    /// The collector alone asked the run to stop, so it goes on once collected.
    pub only: bool,
    need_major: bool,
    young: Vec<Id>,
    free: Vec<Id>,
    cell_state: Vec<u8>,
    cell_young: Vec<u32>,
    cell_free: Vec<u32>,
    cell_remembered: Vec<u32>,
    /// Old slots now, and right after the last major collection.
    old: usize,
    old_at_major: usize,
    /// Atoms are permanent: a minor collection marks only the strings of those made since the last one.
    atoms_seen: usize,
    collections: u64,
}

#[derive(Default)]
pub struct StrGc {
    pub active: bool,
    /// How many strings have their text in each `grow` buffer: one no string uses is dropped.
    refs: Vec<u32>,
    state: Vec<u8>,
    young: Vec<StrId>,
    free: Vec<StrId>,
    grow_free: Vec<u32>,
    /// Below this offset the short strings' buffer holds only old strings' text.
    arena_mark: usize,
}

struct Sticky {
    objs: Vec<u8>,
    cells: Vec<u8>,
    strs: Vec<u8>,
}

impl Marks for Sticky {
    fn obj(&mut self, id: Id) -> bool {
        mark(&mut self.objs, id as usize)
    }

    fn str(&mut self, s: StrId) {
        mark(&mut self.strs, s as usize);
    }

    fn cell(&mut self, c: u32) -> bool {
        mark(&mut self.cells, c as usize)
    }
}

fn mark(state: &mut [u8], i: usize) -> bool {
    match state.get_mut(i) {
        Some(g) if *g == YOUNG => {
            *g = OLD;
            true
        }
        _ => false,
    }
}

impl Vm {
    /// `alloc` past its limit: the first time, the collector starts; then every allocation is tracked.
    #[cold]
    #[inline(never)]
    pub(crate) fn alloc_slow(&mut self, obj: Obj) -> Id {
        if !self.gc.active {
            self.gc_activate();
        }
        let id = match self.gc.free.pop() {
            Some(id) => {
                self.heap.put(id as usize, obj);
                self.heap.state[id as usize] = YOUNG;
                id
            }
            None => {
                if self.heap.len() >= MAX_OBJECTS {
                    self.out_of_memory();
                }
                self.heap.push(obj);
                // A snapshot's restore pushes objects of its own.
                self.heap.state.resize(self.heap.len(), YOUNG);
                (self.heap.len() - 1) as Id
            }
        };
        self.gc.young.push(id);
        if self.young_total() >= knobs().nursery {
            self.gc_request();
        }
        id
    }

    #[inline]
    pub(crate) fn new_cell(&mut self) -> u64 {
        if self.gc.active {
            return self.new_cell_slow();
        }
        self.cells.push(Slot::UNINIT);
        self.cells.len() as u64 - 1
    }

    #[cold]
    #[inline(never)]
    fn new_cell_slow(&mut self) -> u64 {
        let c = match self.gc.cell_free.pop() {
            Some(c) => {
                self.cells[c as usize] = Slot::UNINIT;
                self.gc.cell_state[c as usize] = YOUNG;
                c
            }
            None => {
                self.cells.push(Slot::UNINIT);
                self.gc.cell_state.resize(self.cells.len(), YOUNG);
                self.cells.len() as u32 - 1
            }
        };
        self.gc.cell_young.push(c);
        if self.young_total() >= knobs().nursery {
            self.gc_request();
        }
        c as u64
    }

    /// The write barrier of a cell about to be set.
    #[inline(always)]
    pub(crate) fn cell_barrier(&mut self, c: usize) {
        if self.gc.cell_state.get(c) == Some(&OLD) {
            self.remember_cell(c);
        }
    }

    #[cold]
    #[inline(never)]
    fn remember_cell(&mut self, c: usize) {
        self.gc.cell_state[c] = REMEMBERED;
        self.gc.cell_remembered.push(c as u32);
    }

    /// From the step budget's slow path: starts the collector for a run that made many strings or cells, and asks
    /// for a collection when the strings made since the last one fill the nursery.
    pub(crate) fn gc_poll(&mut self) {
        if !self.gc.active {
            if self.atoms.bufs.len() >= 2 * knobs().first || self.cells.len() >= knobs().first {
                self.gc_activate();
            }
            return;
        }
        if self.young_total() >= knobs().nursery {
            self.gc_request();
        }
    }

    fn young_total(&self) -> usize {
        self.gc.young.len() + self.gc.cell_young.len() + self.atoms.gc.young.len()
    }

    fn gc_activate(&mut self) {
        self.gc.active = true;
        self.gc.need_major = true;
        self.alloc_limit = 0;
        self.heap.state = vec![YOUNG; self.heap.len()];
        self.gc.cell_state = vec![YOUNG; self.cells.len()];
        self.atoms.gc_activate();
        self.gc_request();
    }

    /// Asks for a stop to collect at. Asked again while one is due, since a host stop's round trip clears the request.
    fn gc_request(&mut self) {
        self.gc.wanted = true;
        if !self.suspend_wanted {
            self.suspend_wanted = true;
            self.gc.only = true;
        }
    }

    /// Where the run stopped (`run_until_stop`): collects if a collection is due, or at a host stop after enough
    /// allocation. Returns whether the run is to go on, having stopped only to collect.
    pub(crate) fn gc_stop(&mut self) -> bool {
        if self.suspended && (self.gc.wanted || self.gc.only) {
            if self.gc.wanted && self.gc_safe() {
                self.collect_auto();
            }
            self.gc.wanted = false;
            if std::mem::take(&mut self.gc.only) && !self.host.shared.requested() {
                self.suspended = false;
                self.suspend_wanted = false;
                return true;
            }
            return false;
        }
        let k = knobs();
        let min = if k.stress { 1 } else { EVENT_MIN };
        if k.event
            && self.gc.active
            && !self.suspended
            && self.outcome.is_none()
            && self.fatal.is_none()
            && self.young_total() >= min
            && self.gc_safe()
        {
            self.collect_auto();
        }
        false
    }

    /// A conversion's replay keeps values in Rust until it ends.
    fn gc_safe(&self) -> bool {
        self.replay_meter.is_none() && self.replay.is_empty() && self.convert_req.is_none()
    }

    fn collect_auto(&mut self) {
        let g = &self.gc;
        let major = g.need_major
            || g.old > 2 * g.old_at_major.max(knobs().nursery)
            || (knobs().stress && g.collections % 4 == 3);
        self.collect(major);
    }

    pub(crate) fn collect(&mut self, major: bool) {
        let start = Instant::now();
        #[cfg(feature = "gc-stats")]
        self.publish_stats();
        let base = self.snapshot_base;
        self.heap.state.resize(self.heap.len(), YOUNG);
        self.gc.cell_state.resize(self.cells.len(), YOUNG);
        self.atoms.gc.state.resize(self.atoms.bufs.len(), YOUNG);
        let mut marks = Sticky {
            objs: std::mem::take(&mut self.heap.state),
            cells: std::mem::take(&mut self.gc.cell_state),
            strs: std::mem::take(&mut self.atoms.gc.state),
        };
        let remembered = std::mem::take(&mut self.heap.remembered);
        let cell_remembered = std::mem::take(&mut self.gc.cell_remembered);
        if major {
            for g in marks
                .objs
                .iter_mut()
                .chain(marks.cells.iter_mut())
                .chain(marks.strs.iter_mut())
            {
                if *g != FREE {
                    *g = YOUNG;
                }
            }
        }
        let mut w = Walk {
            heap: &self.heap,
            cells: &self.cells,
            marks,
            todo: Vec::new(),
        };
        if major {
            // What every fresh run makes is permanent.
            for id in 0..base.heap.min(self.heap.len()) {
                w.id(id as Id);
            }
        } else {
            w.todo.extend_from_slice(&remembered);
            for c in &cell_remembered {
                w.val(&self.cells[*c as usize].get());
            }
        }
        crate::reach::roots(&mut w, self);
        let atoms_from = if major { 0 } else { self.gc.atoms_seen };
        self.extra_roots(&mut w, atoms_from);
        w.drain();
        let mut marks = w.marks;
        if !major {
            for id in remembered {
                marks.objs[id as usize] = OLD;
            }
            for c in cell_remembered {
                marks.cells[c as usize] = OLD;
            }
        }
        self.heap.state = marks.objs;
        self.gc.cell_state = marks.cells;
        self.atoms.gc.state = marks.strs;
        self.gc.atoms_seen = self.atoms.atom_str.len();
        let marked = start.elapsed().as_nanos() as u64;
        let survivors = if major {
            self.sweep_all(base.heap, base.cells, base.bufs)
        } else {
            self.sweep_young()
        };
        let g = &mut self.gc;
        if major {
            g.old = survivors;
            g.old_at_major = survivors;
        } else {
            g.old += survivors;
        }
        g.need_major = false;
        g.wanted = false;
        g.collections += 1;
        let ns = start.elapsed().as_nanos() as u64;
        if log() {
            let (objects, cells, strings) = (
                self.heap.len() - self.gc.free.len(),
                self.cells.len() - self.gc.cell_free.len(),
                self.atoms.bufs.len() - self.atoms.gc.free.len(),
            );
            eprintln!(
                "gc {} {ns} ns (mark {marked}), {survivors} survivors, live {objects} objects {cells} cells {strings} strings, {} atoms",
                if major { "major" } else { "minor" },
                self.atoms.atom_str.len()
            );
        }
        #[cfg(feature = "gc-stats")]
        self.record_pause(ns);
    }

    /// Roots `reach::roots` leaves out because a snapshot is taken where they are empty or permanent.
    fn extra_roots(&self, w: &mut Walk<'_, Sticky>, atoms_from: usize) {
        for q in &self.host.queued {
            match q {
                crate::host::Queued::Call(p, ..) | crate::host::Queued::Work(p, ..) => w.id(*p),
            }
        }
        let r = &self.realm;
        let s = &r.std;
        for id in [
            r.object_proto,
            r.function_proto,
            r.array_proto,
            r.string_proto,
            r.number_proto,
            r.boolean_proto,
            r.symbol_proto,
            r.error_proto,
            r.type_error_proto,
            r.range_error_proto,
            r.syntax_error_proto,
            r.reference_error_proto,
            r.aggregate_error_proto,
            r.promise_proto,
            r.promise_then,
            r.map_proto,
            r.set_proto,
            r.generator_proto,
            r.async_generator_proto,
            r.generator_function_proto,
            r.async_function_proto,
            r.async_generator_function_proto,
            r.async_from_sync_proto,
            r.generator_next,
            r.iter_proto,
            s.regexp,
            s.date,
            s.uint8,
            s.buffer,
            s.text_encoder,
            s.text_decoder,
            s.weak_map,
            s.weak_set,
            s.iterator_helper,
            s.uri_error,
            s.url,
            s.params,
            s.headers,
        ] {
            w.id(id);
        }
        for a in &self.atoms.atom_str[atoms_from.min(self.atoms.atom_str.len())..] {
            w.val(&Value::Str(*a));
        }
    }

    /// Frees the young slots no mark reached; the rest are old now. Returns how many survived.
    fn sweep_young(&mut self) -> usize {
        let mut survivors = 0;
        let young = std::mem::take(&mut self.gc.young);
        for id in &young {
            if self.heap.state[*id as usize] == YOUNG {
                self.free_obj(*id);
                continue;
            }
            survivors += 1;
        }
        self.gc.young = reuse(young);
        let young = std::mem::take(&mut self.gc.cell_young);
        for c in &young {
            if self.gc.cell_state[*c as usize] == YOUNG {
                self.free_cell(*c);
                continue;
            }
            survivors += 1;
        }
        self.gc.cell_young = reuse(young);
        survivors + self.atoms.sweep_young()
    }

    /// Frees every unmarked slot above what a fresh run makes. Returns how many are live.
    fn sweep_all(&mut self, heap: usize, cells: usize, bufs: usize) -> usize {
        let mut live = 0;
        for id in heap..self.heap.len() {
            match self.heap.state[id] {
                YOUNG => self.free_obj(id as Id),
                FREE => {}
                _ => live += 1,
            }
        }
        for c in cells..self.cells.len() {
            match self.gc.cell_state[c] {
                YOUNG => self.free_cell(c as u32),
                FREE => {}
                _ => live += 1,
            }
        }
        self.gc.young.clear();
        self.gc.cell_young.clear();
        live + self.atoms.sweep_all(bufs)
    }

    fn free_obj(&mut self, id: Id) {
        self.heap
            .put(id as usize, Obj::new(None, crate::object::Kind::Ordinary));
        self.heap.state[id as usize] = FREE;
        self.gc.free.push(id);
    }

    fn free_cell(&mut self, c: u32) {
        self.cells[c as usize] = Slot::UNDEF;
        self.gc.cell_state[c as usize] = FREE;
        self.gc.cell_free.push(c);
    }

    /// Free slots of each kind, which `heap_counts` leaves out.
    #[cfg(feature = "gc-stats")]
    pub(crate) fn free_counts(&self) -> (usize, usize, usize) {
        (
            self.gc.free.len(),
            self.gc.cell_free.len(),
            self.atoms.gc.free.len(),
        )
    }
}

/// An emptied list's allocation back, unless it grew large.
fn reuse<T>(mut v: Vec<T>) -> Vec<T> {
    v.clear();
    if v.capacity() > 4 * knobs().nursery.max(1024) {
        v.shrink_to(knobs().nursery);
    }
    v
}

/// `PSYCHOSCRIPT_GC_LOG=1` prints each collection, for measuring.
fn log() -> bool {
    static ON: OnceLock<bool> = OnceLock::new();
    *ON.get_or_init(|| std::env::var_os("PSYCHOSCRIPT_GC_LOG").is_some_and(|v| v == "1"))
}

fn empty() -> StrBuf {
    StrBuf {
        s: Cow::Borrowed(""),
        ascii: true,
        builder: false,
        grow: NO_GROW,
        len: 0,
        aux: NO_WTF,
    }
}

impl Strings {
    fn gc_activate(&mut self) {
        self.gc.state = vec![YOUNG; self.bufs.len()];
        self.gc.refs = vec![0; self.grow.len()];
        for b in &self.bufs {
            if b.grow != NO_GROW {
                self.gc.refs[b.grow as usize] += 1;
            }
        }
        self.gc.active = true;
    }

    pub(crate) fn push_tracked(&mut self, b: StrBuf) -> StrId {
        let id = match self.gc.free.pop() {
            Some(id) => {
                self.bufs[id as usize] = b;
                self.gc.state[id as usize] = YOUNG;
                id
            }
            None => {
                self.bufs.push(b);
                self.gc.state.resize(self.bufs.len(), YOUNG);
                (self.bufs.len() - 1) as StrId
            }
        };
        self.gc.young.push(id);
        id
    }

    pub(crate) fn ref_grow(&mut self, g: usize) {
        if g >= self.gc.refs.len() {
            self.gc.refs.resize(self.grow.len(), 0);
        }
        self.gc.refs[g] += 1;
    }

    /// A string stopped using `grow[g]`: the buffer is dropped once none does, unless it is the short strings'.
    pub(crate) fn unref_grow(&mut self, g: usize) {
        if !self.gc.active {
            return;
        }
        let r = &mut self.gc.refs[g];
        *r = r.saturating_sub(1);
        if *r == 0 && g as u32 != self.arena {
            self.grow[g] = String::new();
            self.gc.grow_free.push(g as u32);
        }
    }

    pub(crate) fn move_grow_ref(&mut self, from: usize, to: usize) {
        if self.gc.active {
            self.ref_grow(to);
            self.unref_grow(from);
        }
    }

    pub(crate) fn new_grow_tracked(&mut self, s: String) -> usize {
        if let Some(g) = self.gc.grow_free.pop() {
            self.grow[g as usize] = s;
            return g as usize;
        }
        self.grow.push(s);
        self.grow.len() - 1
    }

    /// `a` takes over the string `made` just got, which is left empty for the collector to free.
    pub(crate) fn adopt(&mut self, a: StrId, made: StrId, builder: bool) {
        let entry = std::mem::replace(&mut self.bufs[made as usize], empty());
        let old = std::mem::replace(&mut self.bufs[a as usize], entry);
        self.bufs[a as usize].builder = builder;
        if old.grow != NO_GROW {
            self.unref_grow(old.grow as usize);
        }
    }

    fn free_str(&mut self, id: StrId) {
        let b = std::mem::replace(&mut self.bufs[id as usize], empty());
        if b.grow != NO_GROW {
            self.unref_grow(b.grow as usize);
        } else if b.aux != NO_WTF {
            self.wtf[b.aux as usize] = Box::default();
        }
        self.gc.state[id as usize] = FREE;
        self.gc.free.push(id);
    }

    fn sweep_young(&mut self) -> usize {
        let young = std::mem::take(&mut self.gc.young);
        let mut survivors = 0;
        for id in &young {
            if self.gc.state[*id as usize] == YOUNG {
                self.free_str(*id);
                continue;
            }
            survivors += 1;
        }
        // The short strings' buffer past the mark holds young strings' text only: the survivors' is copied down.
        if self.arena != NO_GROW {
            let (g, mark) = (self.arena as usize, self.gc.arena_mark);
            let mut tail = String::new();
            for id in &young {
                let b = &self.bufs[*id as usize];
                if self.gc.state[*id as usize] == FREE
                    || b.grow as usize != g
                    || (b.aux + b.len) as usize <= mark
                {
                    continue;
                }
                let (from, len) = (b.aux as usize, b.len as usize);
                let at = mark + tail.len();
                tail.push_str(&self.grow[g][from..from + len]);
                self.bufs[*id as usize].aux = at as u32;
            }
            let arena = &mut self.grow[g];
            arena.truncate(mark);
            arena.push_str(&tail);
            self.gc.arena_mark = arena.len();
        }
        self.gc.young = reuse(young);
        survivors
    }

    fn sweep_all(&mut self, base: usize) -> usize {
        let mut live = 0;
        for id in base..self.bufs.len() {
            match self.gc.state[id] {
                YOUNG => self.free_str(id as StrId),
                FREE => {}
                _ => live += 1,
            }
        }
        self.gc.young.clear();
        // The short strings' buffer is rebuilt from the text of the strings still in it.
        if self.arena != NO_GROW {
            let g = self.arena as usize;
            let old = std::mem::take(&mut self.grow[g]);
            let mut text = String::with_capacity(1024.max(old.len() / 2));
            for b in self.bufs.iter_mut().filter(|b| b.grow as usize == g) {
                let from = b.aux as usize;
                b.aux = text.len() as u32;
                text.push_str(&old[from..from + b.len as usize]);
            }
            self.gc.arena_mark = text.len();
            self.grow[g] = text;
        }
        live
    }
}
