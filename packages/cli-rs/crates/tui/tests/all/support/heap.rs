//! The test binary's allocator: the system allocator, which can count the Rust heap one thread allocates and still
//! holds, so a test can tell what a mount keeps. Each allocation carries the allocating thread in a header, so frees
//! of other threads' allocations, such as messages decoded on the runtime's threads, do not count. OpenTUI's native
//! memory is not counted.

use std::alloc::{GlobalAlloc, Layout, System};
use std::cell::Cell;
use std::sync::atomic::{AtomicIsize, AtomicUsize, Ordering};
use std::sync::{Mutex, MutexGuard};

pub struct Counting;

/// The thread whose allocations count, 0 for none.
static MEASURED: AtomicUsize = AtomicUsize::new(0);
static LIVE: AtomicIsize = AtomicIsize::new(0);
static NEXT_THREAD: AtomicUsize = AtomicUsize::new(1);
static ONE_AT_A_TIME: Mutex<()> = Mutex::new(());

thread_local! {
    static THREAD: Cell<usize> = const { Cell::new(0) };
}

/// Counts what this thread allocates from now on, until the measure drops.
pub fn measure() -> Measure {
    let lock = ONE_AT_A_TIME.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    LIVE.store(0, Ordering::SeqCst);
    MEASURED.store(thread(), Ordering::SeqCst);
    Measure { _lock: lock }
}

pub struct Measure {
    _lock: MutexGuard<'static, ()>,
}

impl Measure {
    /// The bytes this thread allocated since the measure started and that are not freed yet.
    pub fn kept(&self) -> isize {
        LIVE.load(Ordering::SeqCst)
    }
}

impl Drop for Measure {
    fn drop(&mut self) {
        MEASURED.store(0, Ordering::SeqCst);
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

fn count(owner: usize, bytes: isize) {
    if owner != 0 && owner == MEASURED.load(Ordering::Relaxed) {
        LIVE.fetch_add(bytes, Ordering::Relaxed);
    }
}

// SAFETY: each allocation is the system's, `header(layout)` bytes larger and aligned as asked; the caller gets the
// pointer past the header, whose last word holds the allocating thread.
#[allow(unsafe_code)]
unsafe impl GlobalAlloc for Counting {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        unsafe { tag(System.alloc(with_header(layout)), layout) }
    }

    unsafe fn alloc_zeroed(&self, layout: Layout) -> *mut u8 {
        unsafe { tag(System.alloc_zeroed(with_header(layout)), layout) }
    }

    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        unsafe {
            count(owner(ptr), -(layout.size() as isize));
            System.dealloc(ptr.sub(header(layout)), with_header(layout));
        }
    }

    unsafe fn realloc(&self, ptr: *mut u8, layout: Layout, new_size: usize) -> *mut u8 {
        unsafe {
            let owner = owner(ptr);
            let base = System.realloc(ptr.sub(header(layout)), with_header(layout), new_size + header(layout));
            if base.is_null() {
                return base;
            }
            count(owner, new_size as isize - layout.size() as isize);
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
    let owner = thread();
    count(owner, layout.size() as isize);
    unsafe {
        let ptr = base.add(header(layout));
        ptr.cast::<usize>().sub(1).write_unaligned(owner);
        ptr
    }
}

#[allow(unsafe_code)]
unsafe fn owner(ptr: *mut u8) -> usize {
    unsafe { ptr.cast::<usize>().sub(1).read_unaligned() }
}
