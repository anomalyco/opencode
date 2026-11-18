#[path = "../src/transport/retained.rs"]
mod retained;

use std::cell::Cell;
use std::rc::Rc;

use retained::Retained;

struct Completion {
    bytes: usize,
    drops: Rc<Cell<usize>>,
}

impl Drop for Completion {
    fn drop(&mut self) {
        self.drops.set(self.drops.get() + 1);
    }
}

#[test]
fn retained_native_pointer_survives_owner_moves_and_repeated_access() {
    let drops = Rc::new(Cell::new(0));
    let operation = Retained::new(Completion {
        bytes: 0,
        drops: Rc::clone(&drops),
    });
    let native = operation.as_ptr();
    let mut pending = vec![operation];
    pending.reserve(100); // Move the owner while native code retains its pointer.
    for count in 1..=10 {
        let polled = pending[0].as_ptr();
        assert_eq!(native, polled);
        // SAFETY: stand-in for native mutation and a completion query. No Rust
        // reference to the allocation is created while its raw pointer is retained.
        unsafe {
            (*native).bytes = count;
            assert_eq!((*polled).bytes, count);
        }
    }
    let completed = pending.pop().unwrap();
    assert_eq!(drops.get(), 0);
    // Reclaim only after the native operation has completed (or been cancelled
    // and reaped). Miri checks that reclamation and the final access are valid.
    unsafe {
        assert_eq!((*native).bytes, 10);
    }
    drop(completed);
    assert_eq!(drops.get(), 1);
}
