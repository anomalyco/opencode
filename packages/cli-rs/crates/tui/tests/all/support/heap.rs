//! The test binary's allocator: the system allocator, which can count the Rust heap one thread allocates and still
//! holds, so a test can tell what a mount keeps. Each allocation carries in a header the measure it counts in, so
//! frees of other threads' allocations, such as messages decoded on the runtime's threads, do not count, nor frees of
//! what this thread allocated before the measure, such as the tasks of an earlier mount that its runtime drops in the
//! background. OpenTUI's native memory is not counted.
//!
//! A measure also counts, for the performance scenarios, the allocations and bytes of the measured thread and of
//! every thread, and the peak of each one's live bytes, and can record the stack of every so many allocations of
//! the measured thread.

use std::alloc::{GlobalAlloc, Layout, System};
use std::backtrace::Backtrace;
use std::cell::Cell;
use std::sync::atomic::{AtomicIsize, AtomicU64, AtomicUsize, Ordering};
use std::sync::{Mutex, MutexGuard};

pub struct Counting;

static MEASURED: AtomicUsize = AtomicUsize::new(0);
static MEASURE: AtomicUsize = AtomicUsize::new(0);
static NEXT_MEASURE: AtomicUsize = AtomicUsize::new(1);
static NEXT_THREAD: AtomicUsize = AtomicUsize::new(1);
static ONE_AT_A_TIME: Mutex<()> = Mutex::new(());

/// The measured thread's counters, then every thread's.
static THREAD_COUNTS: Counters = Counters::new();
static ALL_COUNTS: Counters = Counters::new();

struct Counters {
    live: AtomicIsize,
    peak: AtomicIsize,
    allocations: AtomicU64,
    bytes: AtomicU64,
}

impl Counters {
    const fn new() -> Self {
        Self {
            live: AtomicIsize::new(0),
            peak: AtomicIsize::new(0),
            allocations: AtomicU64::new(0),
            bytes: AtomicU64::new(0),
        }
    }

    fn reset(&self) {
        for counter in [&self.live, &self.peak] {
            counter.store(0, Ordering::SeqCst);
        }
        for counter in [&self.allocations, &self.bytes] {
            counter.store(0, Ordering::SeqCst);
        }
    }

    /// An allocation, or a reallocation to `bytes`, that changes the live bytes by `change`. Returns how many came
    /// before it.
    fn allocated(&self, bytes: usize, change: isize) -> u64 {
        self.bytes.fetch_add(bytes as u64, Ordering::Relaxed);
        self.changed(change);
        self.allocations.fetch_add(1, Ordering::Relaxed)
    }

    fn changed(&self, change: isize) {
        let live = self.live.fetch_add(change, Ordering::Relaxed) + change;
        self.peak.fetch_max(live, Ordering::Relaxed);
    }

    fn read(&self) -> Usage {
        Usage {
            allocations: self.allocations.load(Ordering::SeqCst),
            bytes: self.bytes.load(Ordering::SeqCst),
            peak: self.peak.load(Ordering::SeqCst).max(0) as u64,
            kept: self.live.load(Ordering::SeqCst),
        }
    }
}

/// What a measure counted so far on one thread or on all of them. Allocations count reallocations too, and bytes
/// count what each allocation or reallocation asked for.
#[derive(Clone, Copy, Debug, Default)]
pub struct Usage {
    pub allocations: u64,
    pub bytes: u64,
    /// The most bytes allocated during the measure that were live at once.
    pub peak: u64,
    /// Bytes allocated during the measure that remain live.
    pub kept: isize,
}

thread_local! {
    static THREAD: Cell<usize> = const { Cell::new(0) };
}

/// Count allocations on this thread until the guard drops.
pub fn measure() -> Measure {
    let lock = ONE_AT_A_TIME.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    THREAD_COUNTS.reset();
    ALL_COUNTS.reset();
    MEASURE.store(NEXT_MEASURE.fetch_add(1, Ordering::SeqCst), Ordering::SeqCst);
    MEASURED.store(thread(), Ordering::SeqCst);
    Measure { _lock: lock }
}

pub struct Measure {
    _lock: MutexGuard<'static, ()>,
}

impl Measure {
    /// Bytes allocated on this thread during the measurement that remain live.
    pub fn kept(&self) -> isize {
        THREAD_COUNTS.live.load(Ordering::SeqCst)
    }

    /// This thread's counts.
    pub fn thread(&self) -> Usage {
        THREAD_COUNTS.read()
    }

    /// Every thread's counts.
    pub fn all(&self) -> Usage {
        ALL_COUNTS.read()
    }
}

impl Drop for Measure {
    fn drop(&mut self) {
        MEASURED.store(0, Ordering::SeqCst);
        MEASURE.store(0, Ordering::SeqCst);
    }
}

/// This thread's number. A `const` thread local without drop glue allocates nothing and stays readable while the
/// thread exits.
fn thread() -> usize {
    THREAD
        .try_with(|id| {
            if id.get() == 0 {
                id.set(NEXT_THREAD.fetch_add(1, Ordering::Relaxed));
            }
            id.get()
        })
        .unwrap_or(0)
}

/// The room before an allocation for its header, keeping the allocation's alignment.
fn header(layout: Layout) -> usize {
    layout.align().max(size_of::<usize>())
}

/// The tag of an allocation made now: the measure shifted left by one, and in the low bit whether the measured
/// thread made it. Zero outside a measure.
fn tag_now() -> usize {
    let measure = MEASURE.load(Ordering::Relaxed);
    if measure == 0 {
        return 0;
    }
    let measured = MEASURED.load(Ordering::Relaxed);
    measure << 1 | usize::from(measured != 0 && measured == thread())
}

/// Counts an allocation of `bytes` tagged `tag` that changes the live bytes by `change`.
fn count(tag: usize, bytes: usize, change: isize) {
    if tag == 0 || tag >> 1 != MEASURE.load(Ordering::Relaxed) {
        return;
    }
    ALL_COUNTS.allocated(bytes, change);
    if tag & 1 == 1 {
        let before = THREAD_COUNTS.allocated(bytes, change);
        let every = SAMPLE_EVERY.load(Ordering::Relaxed);
        if every != 0 && before.is_multiple_of(every) {
            sample();
        }
    }
}

/// Every how many of the measured thread's allocations [`sample`] records the stack; 0 records none.
static SAMPLE_EVERY: AtomicU64 = AtomicU64::new(0);
static SAMPLES: Mutex<Vec<Backtrace>> = Mutex::new(Vec::new());

thread_local! {
    /// This thread is recording a sample, whose own allocations are not sampled.
    static SAMPLING: Cell<bool> = const { Cell::new(false) };
}

/// Records the stack of every `every`th allocation of the measured thread from now on, for [`samples`]; 0 stops.
pub fn sample_every(every: u64) {
    SAMPLE_EVERY.store(every, Ordering::SeqCst);
}

/// The stacks recorded since the last call.
pub fn samples() -> Vec<Backtrace> {
    std::mem::take(&mut *SAMPLES.lock().unwrap_or_else(|poisoned| poisoned.into_inner()))
}

fn sample() {
    if SAMPLING.try_with(|sampling| sampling.replace(true)).unwrap_or(true) {
        return;
    }
    let trace = Backtrace::force_capture();
    SAMPLES.lock().unwrap_or_else(|poisoned| poisoned.into_inner()).push(trace);
    let _ = SAMPLING.try_with(|sampling| sampling.set(false));
}

/// Counts a free of `bytes` of an allocation tagged `tag`.
fn free(tag: usize, bytes: usize) {
    if tag == 0 || tag >> 1 != MEASURE.load(Ordering::Relaxed) {
        return;
    }
    ALL_COUNTS.changed(-(bytes as isize));
    if tag & 1 == 1 {
        THREAD_COUNTS.changed(-(bytes as isize));
    }
}

// SAFETY: each allocation is the system's, `header(layout)` bytes larger and aligned as asked; the caller gets the
// pointer past the header, whose last word holds the tag the allocation counts under.
#[allow(unsafe_code)]
unsafe impl GlobalAlloc for Counting {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        // SAFETY: `with_header` is non-zero sized, and `tag` gets the system's allocation of that layout or null.
        unsafe { tag(System.alloc(with_header(layout)), layout) }
    }

    unsafe fn alloc_zeroed(&self, layout: Layout) -> *mut u8 {
        // SAFETY: `with_header` is non-zero sized, and `tag` gets the system's allocation of that layout or null.
        unsafe { tag(System.alloc_zeroed(with_header(layout)), layout) }
    }

    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        // SAFETY: `ptr` came from `alloc`, so the header before it holds the tag and `System` allocated its base.
        unsafe {
            free(tag_of(ptr), layout.size());
            System.dealloc(ptr.sub(header(layout)), with_header(layout));
        }
    }

    unsafe fn realloc(&self, ptr: *mut u8, layout: Layout, new_size: usize) -> *mut u8 {
        // SAFETY: `ptr` came from `alloc`, so the header before it holds the tag and `System` allocated its base.
        unsafe {
            let tag = tag_of(ptr);
            let base = System.realloc(ptr.sub(header(layout)), with_header(layout), new_size + header(layout));
            if base.is_null() {
                return base;
            }
            count(tag, new_size, new_size as isize - layout.size() as isize);
            base.add(header(layout))
        }
    }
}

fn with_header(layout: Layout) -> Layout {
    Layout::from_size_align(layout.size() + header(layout), layout.align()).expect("allocation size overflows")
}

#[allow(unsafe_code)]
unsafe fn tag(base: *mut u8, layout: Layout) -> *mut u8 {
    if base.is_null() {
        return base;
    }
    let tag = tag_now();
    count(tag, layout.size(), layout.size() as isize);
    // SAFETY: `base` is a live allocation of `with_header(layout)` bytes, so the header's last word is in bounds.
    unsafe {
        let ptr = base.add(header(layout));
        ptr.cast::<usize>().sub(1).write_unaligned(tag);
        ptr
    }
}

#[allow(unsafe_code)]
unsafe fn tag_of(ptr: *mut u8) -> usize {
    // SAFETY: `ptr` came from `tag`, which wrote the tag in the word before it.
    unsafe { ptr.cast::<usize>().sub(1).read_unaligned() }
}

/// Memory this thread allocated before a measure and another thread frees during it is not part of the measure, as
/// the tasks of a mount that ended, which its runtime frees in the background while the next mount is measured.
#[test]
fn a_measure_counts_no_free_of_what_came_before_it() {
    let before = vec![0u8; 65_536];
    let barrier = std::sync::Barrier::new(2);
    std::thread::scope(|scope| {
        let barrier = &barrier;
        scope.spawn(move || {
            barrier.wait();
            drop(before);
            barrier.wait();
        });
        let measure = measure();
        barrier.wait();
        barrier.wait();
        assert_eq!(measure.kept(), 0);
    });
}
