//! Incremental mark-sweep for long-lived runs (`gc-incremental` builds only), in the style of Lua 5.1.
//!
//! Objects, closure cells and strings keep their ids: a freed slot goes on a free list and a later allocation reuses
//! it. A cycle runs Idle → Mark → Sweep → Idle, a bounded step at a time, and only at safe points (`Vm::gc_point`),
//! where every live value is in the VM's structures. Steps are paid for by allocation: a run that allocates nothing
//! does no collector work, and a run that never reaches the first threshold never collects at all.
//!
//! - Allocation stays a compare and a push. Each arena compares its length with a limit, which is the room left
//!   before the next cycle; at the limit, or whenever a free list holds slots or a cycle runs, the limit is 0 and the
//!   cold path (`gc_alloc` and friends) reuses slots, colours them and counts the debt that schedules steps.
//! - Colours: white (unreached), grey (reached, references not traced yet), black, and free. What a cycle allocates
//!   survives it: a new object is black while marking, and black or white during the sweep depending on whether the
//!   sweep has passed its slot. Cells and strings made after the cycle started are beyond the sweep's end, so they
//!   survive without a colour.
//! - Marking keeps a snapshot of the heap as the cycle started (Yuasa): the roots are scanned once, at the start, and
//!   everything they reached then survives. The first write to an object while marking traces it before the write
//!   (`Heap`'s `IndexMut`), and overwriting a cell shades its old value (`Vm::gc_cell_write`), so no reference the
//!   snapshot held is lost. Values only move between the roots and the heap, and the roots need no barrier: what the
//!   program can reach later was in the snapshot or is new, hence black. Marking ends when nothing is grey, with no
//!   atomic rescan.
//! - Work is counted in slots traced, and an object's long part (properties, elements, entries) is traced
//!   `CHUNK` slots at a time, so a step stays short whatever the objects' sizes. Only the barrier traces a whole object
//!   at once.
//! - Stack slots hold a cell as its raw index, which reads as a tiny number, so the stack is scanned conservatively for
//!   cells: a slot whose bits are a valid cell index keeps that cell. Zero keeps cell 0.
//! - What a fresh runtime makes (objects, strings and cells below `snapshot_base`) and every atom are permanent.
//! - Short strings share an arena buffer. Once it is large a cycle retires it: the sweep copies its surviving strings
//!   out, and the cycle after drops it. Any other shared buffer is dropped once no live string points into it.
//! - Snapshots need nothing of their own: a freed object saves as an empty object, a freed string as "" and a freed
//!   cell as undefined, which a resumed run collects again.

use std::ops::{Deref, DerefMut, Index, IndexMut};
use std::slice::SliceIndex;

use crate::object::{Kind, Obj};
use crate::reach::Visit;
use crate::strings::{NO_GROW, StrBuf, StrId, Strings};
use crate::value::{Id, Slot, Value};
use crate::vm::{MAX_OBJECTS, Vm};

const WHITE: u8 = 0;
const GREY: u8 = 1;
const BLACK: u8 = 2;
const FREE: u8 = 3;
/// An atom's string: never freed, so no cycle marks it again.
const PERM: u8 = 4;

/// Slots in use (objects, cells and strings) at which the first cycle starts. A reducer event stays far below it, and
/// of the benchmark programs only the JSON round trip reaches it.
const FIRST: usize = 64 * 1024;
/// The least room a cycle leaves before the next one starts, so a small heap does not collect all the time.
const FLOOR: usize = 64 * 1024;
/// Allocations between steps.
const STEP: usize = 256;
/// Work units per allocation: enough to finish a cycle before the heap grows by about half. A unit is about what
/// tracing one slot costs, a nanosecond or so.
const MUL: usize = 128;
/// The most work units in one step, which bounds its pause.
const MAX_WORK: usize = 64 * 1024;
/// What freeing a slot's contents, or giving a string text of its own, costs on top: a call to the allocator.
const FREE_WORK: usize = 16;
/// The short strings' buffer is retired at a cycle's start once it holds this many bytes.
const ARENA_RETIRE: usize = 64 * 1024;
/// Slots of one object traced at a time; a few in the stress mode, so objects are often traced in part.
const CHUNK: usize = 4096;
const STRESS_CHUNK: usize = 3;
/// The least work units per step in the stress mode, where steps are as small as the debt allows, so cycles
/// interleave with the program as much as possible.
const STRESS_WORK: usize = 64;

#[derive(Clone, Copy, PartialEq, Eq, Default)]
pub(crate) enum Phase {
    #[default]
    Idle,
    Mark,
    Sweep,
}

/// Whether the stress mode is on: a cycle runs all the time, in tiny steps at every safe point the run reaches while
/// it allocates. Internal; tests turn it on with `PSYCHOSCRIPT_GC_STRESS=1` to find missing roots and barriers.
fn stress() -> bool {
    static ON: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
    *ON.get_or_init(|| std::env::var_os("PSYCHOSCRIPT_GC_STRESS").is_some_and(|v| v == "1"))
}

pub(crate) fn first_limit() -> usize {
    if stress() { 0 } else { FIRST }
}

/// The run's objects. The first write to an object while marking traces it first: every `heap[id]` that may write
/// goes through `IndexMut`.
pub struct Heap {
    objs: Vec<Obj>,
    pub(crate) marking: bool,
    marks: Marks,
}

#[derive(Default)]
struct Marks {
    color: Vec<u8>,
    grey: Vec<Id>,
    /// A long object traced in part: its id and the first slot of its bulk (`Visit::bulk`) not traced yet.
    resume: Option<(Id, usize)>,
    /// Strings and cells the barrier reached, which the next step marks: their colours are not the heap's.
    strs: Vec<StrId>,
    cells: Vec<u32>,
}

impl Heap {
    pub fn with_capacity(n: usize) -> Heap {
        Heap {
            objs: Vec::with_capacity(n),
            marking: false,
            marks: Marks::default(),
        }
    }

    #[inline(always)]
    pub fn push(&mut self, o: Obj) {
        self.objs.push(o);
    }

    /// Fills freed slot `i`, past the barrier: a reused slot is black or white already. The sweep left an empty
    /// object there, which owns no memory, so it is forgotten rather than dropped: that keeps drop code out of every
    /// `alloc`.
    #[inline(always)]
    pub(crate) fn put(&mut self, i: usize, o: Obj) {
        std::mem::forget(std::mem::replace(&mut self.objs[i], o));
    }

    /// Traces object `i` as it is, before a write, unless it is black already.
    #[cold]
    #[inline(never)]
    fn barrier(&mut self, i: usize) {
        let m = &mut self.marks;
        if !matches!(m.color.get(i), Some(&WHITE | &GREY)) {
            return;
        }
        m.color[i] = BLACK;
        Shade(m).object(&self.objs[i]);
    }
}

/// The barrier's trace: greys objects, and leaves strings and cells to the next step.
struct Shade<'m>(&'m mut Marks);

impl Visit for Shade<'_> {
    fn id(&mut self, id: Id) {
        let m = &mut *self.0;
        if m.color.get(id as usize) == Some(&WHITE) {
            m.color[id as usize] = GREY;
            m.grey.push(id);
        }
    }

    fn str(&mut self, s: StrId) {
        self.0.strs.push(s);
    }

    fn cell(&mut self, c: u32) {
        self.0.cells.push(c);
    }

    fn slots(&mut self, slots: &[Slot]) {
        for s in slots {
            // A saved frame's stack holds cells as raw indices: see `Marker::slots`.
            if let Ok(c) = u32::try_from(s.0) {
                self.cell(c);
            }
            self.val(&s.get());
        }
    }
}

impl Deref for Heap {
    type Target = Vec<Obj>;

    #[inline(always)]
    fn deref(&self) -> &Vec<Obj> {
        &self.objs
    }
}

impl<I: SliceIndex<[Obj]>> Index<I> for Heap {
    type Output = I::Output;

    #[inline(always)]
    fn index(&self, i: I) -> &I::Output {
        &self.objs[i]
    }
}

impl IndexMut<usize> for Heap {
    #[inline(always)]
    fn index_mut(&mut self, i: usize) -> &mut Obj {
        if self.marking {
            self.barrier(i);
        }
        &mut self.objs[i]
    }
}

/// The collector's state for objects and cells; strings keep theirs in `Strings::gc`.
pub struct Gc {
    phase: Phase,
    /// An allocation at this length takes the cold path.
    pub(crate) obj_limit: usize,
    pub(crate) cell_limit: usize,
    free: Vec<Id>,
    cell_free: Vec<u32>,
    cell_color: Vec<u8>,
    /// Slots in use at which the next cycle starts.
    trigger: usize,
    /// Slots in use when marking ended, less what the sweep freed since: the live data the next threshold is set from.
    /// What the program allocates during the sweep is left out, so this cycle's floating garbage does not raise it.
    live: usize,
    /// Allocations not yet paid for with collector work.
    debt: usize,
    /// A step is due at the next safe point.
    requested: bool,
    /// The collector set `suspend_wanted` to reach a safe point; nobody else wants the run to stop.
    owns_suspend: bool,
    obj_sweep: (usize, usize),
    cell_sweep: (usize, usize),
}

impl Gc {
    pub fn new() -> Gc {
        Gc {
            phase: Phase::Idle,
            obj_limit: first_limit(),
            cell_limit: first_limit(),
            free: Vec::new(),
            cell_free: Vec::new(),
            cell_color: Vec::new(),
            trigger: first_limit(),
            live: 0,
            debt: 0,
            requested: false,
            owns_suspend: false,
            obj_sweep: (0, 0),
            cell_sweep: (0, 0),
        }
    }

    #[cfg(feature = "gc-stats")]
    pub(crate) fn free_counts(&self) -> (usize, usize) {
        (self.free.len(), self.cell_free.len())
    }

    /// Someone other than the collector asks the run to stop.
    pub(crate) fn disown_suspend(&mut self) {
        self.owns_suspend = false;
    }
}

/// The collector's state for strings, made on the first write to it, which comes once a run passes its first
/// threshold: a short run allocates none. Until then it reads as an idle collector's.
#[derive(Default)]
pub struct LazyStrGc(Option<Box<StrGc>>);

static IDLE: StrGc = StrGc::new();

impl Deref for LazyStrGc {
    type Target = StrGc;

    fn deref(&self) -> &StrGc {
        self.0.as_deref().unwrap_or(&IDLE)
    }
}

impl DerefMut for LazyStrGc {
    fn deref_mut(&mut self) -> &mut StrGc {
        self.0.get_or_insert_with(|| Box::new(StrGc::new()))
    }
}

/// The collector's state for strings, kept in `Strings` so its allocation paths can reach it.
pub struct StrGc {
    phase: Phase,
    pub(crate) free: Vec<StrId>,
    color: Vec<u8>,
    /// Allocations not yet paid for; the VM reads it, as strings cannot ask for a safe point themselves.
    debt: usize,
    /// The VM should look at the debt or the threshold.
    pub(crate) wanted: bool,
    sweep: (usize, usize),
    /// Atoms before this one have permanent strings; `atom_at` is how far this cycle got, and `atom_skip` the first
    /// atom whose string is too new to colour yet.
    atoms_done: usize,
    atom_at: usize,
    atom_skip: Option<usize>,
    /// Per shared buffer as of the cycle's start: whether a live string points into it.
    grow_live: Vec<bool>,
    /// Retired short-string buffers: their surviving strings are copied out at the sweep.
    retired: Vec<bool>,
    pub(crate) grow_free: Vec<usize>,
}

impl StrGc {
    const fn new() -> StrGc {
        StrGc {
            phase: Phase::Idle,
            free: Vec::new(),
            color: Vec::new(),
            debt: 0,
            wanted: false,
            sweep: (0, 0),
            atoms_done: 0,
            atom_at: 0,
            atom_skip: None,
            grow_live: Vec::new(),
            retired: Vec::new(),
            grow_free: Vec::new(),
        }
    }

    /// A shared buffer is made, possibly at a freed index: the current cycle must keep it.
    pub(crate) fn grow_made(&mut self, g: usize) {
        if let Some(l) = self.grow_live.get_mut(g) {
            *l = true;
        }
        if let Some(r) = self.retired.get_mut(g) {
            *r = false;
        }
    }
}

impl Strings {
    /// `push` past the limit: counts the debt, and gives a freed slot for a string whose text is in shared buffer
    /// `grow`, coloured for the cycle in progress, or `None` to push it at the end.
    #[cold]
    #[inline(never)]
    pub(crate) fn push_slow(&mut self, grow: u32) -> Option<StrId> {
        let gc = &mut self.gc;
        gc.debt += 1;
        gc.wanted = true;
        if gc.phase != Phase::Idle
            && let Some(l) = gc.grow_live.get_mut(grow as usize)
        {
            *l = true;
        }
        let id = gc.free.pop()?;
        gc.color[id as usize] = reused_color(gc.phase, id as usize, gc.sweep.0, BLACK);
        Some(id)
    }

    /// Frees string `i`, or keeps it for the next cycle, copying it out of a retired buffer. Returns the work done.
    fn sweep_str(&mut self, i: usize) -> usize {
        match self.gc.color[i] {
            WHITE => {
                self.gc.color[i] = FREE;
                // Text in a shared buffer frees nothing.
                let work = if self.bufs[i].grow == NO_GROW {
                    FREE_WORK
                } else {
                    1
                };
                self.release(i);
                self.gc.free.push(i as StrId);
                1 + work
            }
            BLACK => {
                self.gc.color[i] = WHITE;
                let g = self.bufs[i].grow as usize;
                if self.gc.retired.get(g) != Some(&true) {
                    return 1;
                }
                self.own_text(i);
                1 + FREE_WORK
            }
            _ => 1,
        }
    }

    /// Starts a cycle: colours for what was made since the last one, and a fresh short-string buffer once it is large.
    /// The fresh runtime's strings, below `base`, are never swept, so their buffers stay.
    fn start_cycle(&mut self, base: usize) {
        let gc = &mut self.gc;
        gc.phase = Phase::Mark;
        self.gc_limit = 0;
        gc.color.resize(self.bufs.len(), WHITE);
        gc.atom_at = gc.atoms_done;
        gc.atom_skip = None;
        gc.grow_live.clear();
        gc.grow_live.resize(self.grow.len(), false);
        gc.retired.resize(self.grow.len(), false);
        for b in &self.bufs[..base.min(self.bufs.len())] {
            if let Some(l) = self.gc.grow_live.get_mut(b.grow as usize) {
                *l = true;
            }
        }
        let g = self.arena;
        if g != NO_GROW && self.grow[g as usize].len() >= ARENA_RETIRE {
            self.arena = NO_GROW;
            self.gc.retired[g as usize] = true;
        }
    }

    /// Makes the strings of atoms made since the last cycle permanent, with text of their own so they need no shared
    /// buffer, up to `max` work units; returns the work done. Each atom costs this once rather than once per cycle.
    fn perm_atoms(&mut self, max: usize) -> usize {
        let end = self.counts().1;
        let mut work = 0;
        while self.gc.atom_at < end && work < max {
            let a = self.gc.atom_at;
            self.gc.atom_at += 1;
            work += 1;
            let id = self.atom_str(a as u32) as usize;
            match self.gc.color.get(id) {
                // Made during this cycle, so it survives it; the next cycle colours it.
                None => {
                    self.gc.atom_skip.get_or_insert(a);
                }
                Some(&PERM) => {}
                Some(_) => {
                    self.gc.color[id] = PERM;
                    if self.bufs[id].grow != NO_GROW {
                        self.own_text(id);
                        work += FREE_WORK;
                    }
                }
            }
        }
        work
    }

    /// Drops every shared buffer no live string points into, except the short strings' current one.
    fn end_cycle(&mut self) {
        for g in 0..self.gc.grow_live.len() {
            if self.gc.grow_live[g] || g == self.arena as usize || self.grow[g].capacity() == 0 {
                continue;
            }
            self.grow[g] = String::new();
            self.gc.retired[g] = false;
            self.gc.grow_free.push(g);
        }
        self.gc.phase = Phase::Idle;
    }

    /// Gives string `i` text of its own, out of its shared buffer.
    fn own_text(&mut self, i: usize) {
        let text = self.get(i as StrId).to_owned();
        let b = &mut self.bufs[i];
        b.s = std::borrow::Cow::Owned(text);
        b.set_own();
    }

    /// Drops a freed string's text.
    fn release(&mut self, i: usize) {
        if let Some(w) = self.bufs[i].wtf_index() {
            self.wtf[w] = Box::default();
        }
        self.bufs[i] = StrBuf::empty();
    }
}

/// The colour of a reused slot: what the cycle in progress makes survives it. While sweeping, a slot the sweep
/// already passed stays white for the next cycle.
fn reused_color(phase: Phase, id: usize, swept_to: usize, marked: u8) -> u8 {
    match phase {
        Phase::Idle => WHITE,
        Phase::Mark => marked,
        Phase::Sweep if id < swept_to => WHITE,
        Phase::Sweep => BLACK,
    }
}

/// Traces from roots and grey objects, with the colours taken out of the VM so the VM can be read meanwhile.
struct Marker<'v> {
    vm: &'v Vm,
    marks: Marks,
    cells: Vec<u8>,
    strs: Vec<u8>,
    grow_live: Vec<bool>,
    work: usize,
}

impl Visit for Marker<'_> {
    fn id(&mut self, id: Id) {
        self.work += 1;
        let m = &mut self.marks;
        if let Some(c) = m.color.get_mut(id as usize)
            && *c == WHITE
        {
            *c = GREY;
            m.grey.push(id);
        }
    }

    fn str(&mut self, s: StrId) {
        self.work += 1;
        if let Some(c) = self.strs.get_mut(s as usize)
            && *c == WHITE
        {
            *c = BLACK;
            let g = self.vm.atoms.bufs[s as usize].grow as usize;
            // A retired buffer's strings are copied out at the sweep, so they do not keep it.
            if self.vm.atoms.gc.retired.get(g) != Some(&true)
                && let Some(l) = self.grow_live.get_mut(g)
            {
                *l = true;
            }
        }
    }

    fn cell(&mut self, c: u32) {
        self.work += 1;
        if let Some(k) = self.cells.get_mut(c as usize)
            && *k == WHITE
        {
            *k = BLACK;
            let v = self.vm.cells[c as usize].get();
            self.val(&v);
        }
    }

    fn slots(&mut self, slots: &[Slot]) {
        let cells = self.vm.cells.len() as u64;
        for s in slots {
            if s.0 < cells {
                self.cell(s.0 as u32);
            }
            self.val(&s.get());
        }
    }
}

impl Marker<'_> {
    /// Marks what the barrier reached, then traces grey objects until the work reaches `budget` or none is left;
    /// returns whether none is left.
    fn propagate(&mut self, budget: usize) -> bool {
        let vm = self.vm;
        for s in std::mem::take(&mut self.marks.strs) {
            self.str(s);
        }
        for c in std::mem::take(&mut self.marks.cells) {
            self.cell(c);
        }
        while self.work < budget {
            let next = self
                .marks
                .resume
                .take()
                .or_else(|| self.marks.grey.pop().map(|id| (id, 0)));
            let Some((id, from)) = next else {
                return true;
            };
            // Black already when the barrier traced it.
            if self.marks.color[id as usize] != GREY {
                continue;
            }
            let o = &vm.heap[id as usize];
            if from == 0 {
                self.work += 1;
                self.head(o);
            }
            let len = bulk_len(o);
            let to = from + if stress() { STRESS_CHUNK } else { CHUNK };
            self.work += to.min(len).saturating_sub(from);
            self.bulk(o, from, to);
            if to < len {
                self.marks.resume = Some((id, to));
                continue;
            }
            self.marks.color[id as usize] = BLACK;
        }
        self.marks.grey.is_empty() && self.marks.resume.is_none()
    }

    /// Every root: what `reach::roots` visits, plus what only a run in progress holds.
    fn roots(&mut self) {
        let vm = self.vm;
        crate::reach::roots(self, vm);
        for q in &vm.host.queued {
            match q {
                crate::host::Queued::Call(p, ..) | crate::host::Queued::Work(p, ..) => self.id(*p),
            }
        }
        for args in &vm.arg_pool {
            self.vals(args.iter());
        }
        for s in &vm.concat_parts {
            self.str(*s);
        }
        self.vals(vm.replay.iter());
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
            self.id(id);
        }
    }
}

/// How many slots `Visit::bulk` traces for `o`.
fn bulk_len(o: &Obj) -> usize {
    o.props.items.len()
        + match &o.kind {
            Kind::Array(items) | Kind::Arguments(items) => items.len(),
            Kind::ListIter { items, .. } => items.len(),
            Kind::Map(m) | Kind::Set(m) | Kind::WeakMap(m) | Kind::WeakSet(m) => m.entries.len(),
            _ => 0,
        }
}

impl Vm {
    /// `alloc` at its limit: a freed slot for the object, coloured for the cycle in progress, or `None` to push it
    /// at the end. The object stays with `alloc`: passing it to this out-of-line function made every allocation build
    /// it in memory first.
    #[cold]
    #[inline(never)]
    pub(crate) fn gc_alloc(&mut self) -> Option<Id> {
        self.gc.debt += 1;
        let phase = self.gc.phase;
        let id = self.gc.free.pop();
        match id {
            Some(id) => {
                self.heap.marks.color[id as usize] =
                    reused_color(phase, id as usize, self.gc.obj_sweep.0, BLACK);
            }
            None => {
                if self.heap.len() >= MAX_OBJECTS {
                    self.out_of_memory();
                }
                // Past the sweep's end, so the sweep never sees it.
                match phase {
                    Phase::Mark => self.heap.marks.color.push(BLACK),
                    Phase::Sweep => self.heap.marks.color.push(WHITE),
                    Phase::Idle => {}
                }
            }
        }
        self.gc_poll();
        id
    }

    /// A new closure cell at its limit, as `gc_alloc` does for objects.
    #[cold]
    #[inline(never)]
    pub(crate) fn gc_new_cell(&mut self) -> u64 {
        self.gc.debt += 1;
        let c = match self.gc.cell_free.pop() {
            Some(c) => {
                self.cells[c as usize] = Slot::UNINIT;
                let color = reused_color(self.gc.phase, c as usize, self.gc.cell_sweep.0, BLACK);
                self.gc.cell_color[c as usize] = color;
                c as u64
            }
            None => {
                self.cells.push(Slot::UNINIT);
                self.cells.len() as u64 - 1
            }
        };
        self.gc_poll();
        c
    }

    /// The barrier of cells: the value a write to cell `c` overwrites while marking survives the cycle.
    #[cold]
    #[inline(never)]
    pub(crate) fn gc_cell_write(&mut self, c: usize) {
        let Some(v) = self.cells.get(c) else {
            return;
        };
        match v.get() {
            Value::Obj(id) => {
                if self.heap.marks.color.get(id as usize) == Some(&WHITE) {
                    self.heap.marks.color[id as usize] = GREY;
                    self.heap.marks.grey.push(id);
                }
            }
            Value::Str(s) => {
                let gc = &mut self.atoms.gc;
                if gc.color.get(s as usize) == Some(&WHITE) {
                    gc.color[s as usize] = BLACK;
                    let g = self.atoms.bufs[s as usize].grow as usize;
                    if let Some(l) = self.atoms.gc.grow_live.get_mut(g) {
                        *l = true;
                    }
                }
            }
            _ => {}
        }
    }

    /// Decides whether a step is due, from the allocation paths and the fuel check; otherwise sets the room left
    /// before the next cycle as the arenas' limits.
    #[cold]
    #[inline(never)]
    pub(crate) fn gc_poll(&mut self) {
        self.atoms.gc.wanted = false;
        if self.gc.phase != Phase::Idle {
            if stress() || self.gc.debt + self.atoms.gc.debt >= STEP {
                self.gc_request();
            }
            return;
        }
        let used = self.gc_used();
        if used >= self.gc.trigger {
            self.gc.obj_limit = 0;
            self.gc.cell_limit = 0;
            self.atoms.gc_limit = 0;
            self.gc_request();
            return;
        }
        // Each arena may take a third of the room before the next look, so together they never overshoot it.
        let room = (self.gc.trigger - used) / 3;
        let limit = |len: usize, free: bool| if free { 0 } else { len + room };
        self.gc.obj_limit = limit(self.heap.len(), !self.gc.free.is_empty()).min(MAX_OBJECTS);
        self.gc.cell_limit = limit(self.cells.len(), !self.gc.cell_free.is_empty());
        self.atoms.gc_limit = limit(self.atoms.bufs.len(), !self.atoms.gc.free.is_empty());
    }

    fn gc_request(&mut self) {
        self.gc.requested = true;
        if !self.suspend_wanted {
            self.suspend_wanted = true;
            self.gc.owns_suspend = true;
        }
    }

    /// Slots in use: every object, cell and string not on a free list.
    fn gc_used(&self) -> usize {
        self.heap.len() - self.gc.free.len() + self.cells.len() - self.gc.cell_free.len()
            + self.atoms.bufs.len()
            - self.atoms.gc.free.len()
    }

    /// A safe point the run reached with `suspend_wanted` set: takes a collection step if one is due. Returns whether
    /// the collector alone wanted the stop, so the run goes on.
    pub(crate) fn gc_point(&mut self) -> bool {
        // A conversion's replay or a native JSON walk holds values in Rust locals.
        let busy = self.replay_meter.is_some()
            || !self.replay.is_empty()
            || self.convert_req.is_some()
            || self.json_walk != 0;
        if self.gc.requested && !busy {
            self.gc.requested = false;
            self.gc_step();
        }
        if !self.gc.owns_suspend {
            return false;
        }
        if !self.gc.requested {
            self.gc.owns_suspend = false;
            self.suspend_wanted = false;
        }
        true
    }

    /// Whether a step is due, for the host stop.
    pub(crate) fn gc_pending(&self) -> bool {
        self.gc.requested
    }

    fn gc_step(&mut self) {
        #[cfg(feature = "gc-stats")]
        let started = std::time::Instant::now();
        let debt = self.gc.debt + self.atoms.gc.debt;
        let budget = if stress() {
            (debt * MUL).max(STRESS_WORK)
        } else {
            (debt * MUL).clamp(STEP * MUL, MAX_WORK)
        };
        let left = debt.saturating_sub(budget / MUL);
        self.gc.debt = left;
        self.atoms.gc.debt = 0;
        match self.gc.phase {
            Phase::Idle => self.gc_start(),
            Phase::Mark => self.gc_mark(budget),
            Phase::Sweep => self.gc_sweep(budget),
        }
        if self.gc.phase != Phase::Idle && (stress() || self.gc.debt >= STEP) {
            self.gc_request();
        }
        #[cfg(feature = "gc-stats")]
        self.record_pause(started.elapsed().as_nanos() as u64);
    }

    /// Idle → Mark: colours for what was made since the last cycle, then the roots and the fresh runtime's objects.
    fn gc_start(&mut self) {
        // What was allocated while idle reused freed slots; this cycle pays for none of it.
        self.gc.debt = 0;
        self.gc.phase = Phase::Mark;
        self.gc.obj_limit = 0;
        self.gc.cell_limit = 0;
        self.heap.marks.color.resize(self.heap.len(), WHITE);
        self.gc.cell_color.resize(self.cells.len(), WHITE);
        self.atoms.start_cycle(self.snapshot_base.bufs);
        self.heap.marking = true;
        let base = self.snapshot_base.heap.min(self.heap.len());
        for id in 0..base {
            self.heap.marks.color[id] = GREY;
            self.heap.marks.grey.push(id as Id);
        }
        self.with_marker(|m| m.roots());
    }

    fn gc_mark(&mut self, budget: usize) {
        let spent = self.atoms.perm_atoms(budget / 2);
        // The atoms made since the last cycle go first, so few are left for the atomic end.
        let atoms_left = self.atoms.gc.atom_at < self.atoms.counts().1;
        let done = self.with_marker(|m| {
            m.work = spent;
            m.propagate(budget)
        });
        if !done || atoms_left {
            return;
        }
        // Atoms made since the last step, which nothing may reach but the interner.
        self.atoms.perm_atoms(usize::MAX);
        let gc = &mut self.atoms.gc;
        gc.atoms_done = gc.atom_skip.unwrap_or(gc.atom_at);
        self.heap.marking = false;
        self.gc.live = self.gc_used();
        self.gc.phase = Phase::Sweep;
        self.atoms.gc.phase = Phase::Sweep;
        let base = self.snapshot_base;
        self.gc.obj_sweep = (base.heap, self.heap.len());
        self.gc.cell_sweep = (base.cells, self.gc.cell_color.len());
        self.atoms.gc.sweep = (base.bufs, self.atoms.gc.color.len());
    }

    /// Runs `f` with the colours taken out of the VM, then puts them back.
    fn with_marker<R>(&mut self, f: impl FnOnce(&mut Marker) -> R) -> R {
        let marks = std::mem::take(&mut self.heap.marks);
        let cells = std::mem::take(&mut self.gc.cell_color);
        let strs = std::mem::take(&mut self.atoms.gc.color);
        let grow_live = std::mem::take(&mut self.atoms.gc.grow_live);
        let mut m = Marker {
            vm: self,
            marks,
            cells,
            strs,
            grow_live,
            work: 0,
        };
        let r = f(&mut m);
        let Marker {
            marks,
            cells,
            strs,
            grow_live,
            ..
        } = m;
        self.heap.marks = marks;
        self.gc.cell_color = cells;
        self.atoms.gc.color = strs;
        self.atoms.gc.grow_live = grow_live;
        r
    }

    /// Frees white slots from where the sweep stopped, objects first, then cells, then strings.
    fn gc_sweep(&mut self, budget: usize) {
        #[cfg(feature = "gc-stats")]
        self.publish_stats();
        let mut work = 0;
        let free = self.gc.free.len() + self.gc.cell_free.len() + self.atoms.gc.free.len();
        let (mut at, end) = self.gc.obj_sweep;
        while at < end && work < budget {
            work += 1;
            match self.heap.marks.color[at] {
                WHITE => {
                    self.heap.marks.color[at] = FREE;
                    self.heap.objs[at] = Obj::new(None, Kind::Ordinary);
                    self.gc.free.push(at as Id);
                    work += FREE_WORK;
                }
                BLACK => self.heap.marks.color[at] = WHITE,
                _ => {}
            }
            at += 1;
        }
        self.gc.obj_sweep.0 = at;
        let (mut at, end) = self.gc.cell_sweep;
        while at < end && work < budget {
            work += 1;
            match self.gc.cell_color[at] {
                WHITE => {
                    self.gc.cell_color[at] = FREE;
                    self.cells[at] = Slot::UNDEF;
                    self.gc.cell_free.push(at as u32);
                }
                BLACK => self.gc.cell_color[at] = WHITE,
                _ => {}
            }
            at += 1;
        }
        self.gc.cell_sweep.0 = at;
        let (mut at, end) = self.atoms.gc.sweep;
        while at < end && work < budget {
            work += self.atoms.sweep_str(at);
            at += 1;
            self.atoms.gc.sweep.0 = at;
        }
        self.gc.live -=
            self.gc.free.len() + self.gc.cell_free.len() + self.atoms.gc.free.len() - free;
        if work >= budget {
            return;
        }
        self.atoms.end_cycle();
        self.gc.phase = Phase::Idle;
        self.gc.trigger = if stress() {
            0
        } else {
            self.gc.live + self.gc.live.max(FLOOR)
        };
        self.gc_poll();
    }
}
