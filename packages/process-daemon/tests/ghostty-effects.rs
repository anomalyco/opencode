//! Exercise the production callback owner without linking or calling native code.
//! The small NativeOwner stand-in retains the same userdata pointer that C would.
//! Also run by the isolated tests/ghostty-effects Cargo manifest under Miri.
#![cfg(test)]

#[path = "../src/ghostty/effects.rs"]
mod effects;
#[path = "../src/ghostty/ffi.rs"]
mod ffi;

use std::collections::VecDeque;
use std::ffi::c_void;
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::ptr;

use effects::Effects;

struct NativeOwner {
    effects: Effects,
    userdata: *mut c_void,
}

impl NativeOwner {
    fn new() -> Self {
        let effects = Effects::default();
        // Register before returning/moving the owner, exactly as Terminal::new does.
        let userdata = effects.userdata().cast_mut();
        Self { effects, userdata }
    }

    fn emit(&mut self, bytes: &[u8]) {
        // SAFETY: effects still owns the retained userdata, and bytes lives through the call.
        unsafe { Effects::write_pty(ptr::null_mut(), self.userdata, bytes.as_ptr(), bytes.len()) };
        self.effects.resume_panic();
    }

    fn take_writes(&mut self) -> VecDeque<Vec<u8>> {
        // Exercise a mutable borrow of the containing owner, not just a standalone Rc.
        self.effects.take_writes()
    }
}

impl Drop for NativeOwner {
    fn drop(&mut self) {
        // Model native teardown while callback state must still be alive, as in Terminal::drop.
        // SAFETY: the Effects field is only dropped after this destructor returns.
        unsafe {
            Effects::write_pty(ptr::null_mut(), self.userdata, b"teardown".as_ptr(), 8);
            Effects::title_changed(ptr::null_mut(), self.userdata);
        }
    }
}

#[test]
fn retained_userdata_survives_moves_and_repeated_drains() {
    let mut owners = Vec::with_capacity(1);
    owners.push(NativeOwner::new());
    owners.reserve_exact(32);
    let mut owner = Box::new(owners.pop().unwrap());

    for byte in 0..8 {
        owner.emit(&[byte]);
        assert_eq!(owner.take_writes(), VecDeque::from([vec![byte]]));
        assert!(owner.take_writes().is_empty());
        // This pointer was never refreshed after construction or mutable owner borrows.
        unsafe { Effects::title_changed(ptr::null_mut(), owner.userdata) };
        assert!(owner.effects.take_title_changed());
        assert!(!owner.effects.take_title_changed());
    }
}

#[test]
fn callback_bytes_are_owned_after_the_source_buffer_is_gone() {
    let mut owner = NativeOwner::new();
    let mut bytes = vec![1, 2, 3];
    owner.emit(&bytes);
    bytes.fill(0);
    drop(bytes);
    assert_eq!(owner.take_writes(), VecDeque::from([vec![1, 2, 3]]));
}

#[test]
fn empty_callback_does_not_dereference_a_null_buffer() {
    let mut owner = NativeOwner::new();
    // SAFETY: zero-length callbacks do not require a data allocation.
    unsafe { Effects::write_pty(ptr::null_mut(), owner.userdata, ptr::null(), 0) };
    owner.effects.resume_panic();
    assert!(owner.take_writes().is_empty());
}

#[test]
fn callback_panics_return_to_the_caller_before_resuming() {
    let mut owner = NativeOwner::new();
    // Intentionally trigger the defensive assertion before any buffer dereference.
    unsafe { Effects::write_pty(ptr::null_mut(), owner.userdata, ptr::null(), 1) };
    assert!(catch_unwind(AssertUnwindSafe(|| owner.effects.resume_panic())).is_err());
    owner.emit(b"after panic");
    assert_eq!(
        owner.take_writes(),
        VecDeque::from([b"after panic".to_vec()])
    );
}

#[test]
fn retained_userdata_is_live_during_native_teardown() {
    drop(NativeOwner::new());
}
