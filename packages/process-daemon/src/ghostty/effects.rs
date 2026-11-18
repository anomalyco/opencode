//! Callback state shared with Ghostty through retained userdata. Keep this module
//! independent of native calls so its ownership rules can also be checked by Miri.

use std::any::Any;
use std::cell::{Cell, RefCell};
use std::collections::VecDeque;
use std::ffi::c_void;
use std::panic::{AssertUnwindSafe, catch_unwind, resume_unwind};
use std::rc::Rc;

use super::ffi;

#[derive(Default)]
struct State {
    writes: RefCell<VecDeque<Vec<u8>>>,
    title_changed: Cell<bool>,
    panic: Cell<Option<Box<dyn Any + Send>>>,
}

#[derive(Default)]
pub(super) struct Effects {
    // Rc::as_ptr permits retained aliases across owner moves. A Box and mutable
    // reborrows of its pointee would invalidate Ghostty's stored userdata pointer.
    // Never use Rc::get_mut/make_mut: all pointee mutation must use interior mutability.
    state: Rc<State>,
}

impl Effects {
    pub(super) fn userdata(&self) -> *const c_void {
        Rc::as_ptr(&self.state).cast()
    }

    pub(super) fn take_writes(&self) -> VecDeque<Vec<u8>> {
        self.state.writes.take()
    }

    pub(super) fn take_title_changed(&self) -> bool {
        self.state.title_changed.replace(false)
    }

    pub(super) fn resume_panic(&self) {
        // Any Rust panic is resumed only after returning across the C boundary.
        if let Some(payload) = self.state.panic.take() {
            resume_unwind(payload);
        }
    }

    pub(super) unsafe extern "C" fn write_pty(
        _: ffi::GhosttyTerminal,
        userdata: *mut c_void,
        data: *const u8,
        len: usize,
    ) {
        // SAFETY: userdata comes from Rc::as_ptr, and Terminal keeps the owning
        // Effects alive until after native teardown. Only shared borrows are made.
        let state = unsafe { &*userdata.cast::<State>() };
        if let Some(payload) = state.panic.take() {
            state.panic.set(Some(payload));
            return;
        }
        let result = catch_unwind(AssertUnwindSafe(|| {
            if len == 0 {
                return;
            }
            assert!(!data.is_null() && len <= isize::MAX as usize);
            // SAFETY: Ghostty guarantees data is valid during this callback.
            // Retain only copied bytes, never the borrowed native buffer.
            state
                .writes
                .borrow_mut()
                .push_back(unsafe { std::slice::from_raw_parts(data, len) }.to_vec());
        }));
        if let Err(payload) = result {
            state.panic.set(Some(payload));
        }
    }

    pub(super) unsafe extern "C" fn title_changed(_: ffi::GhosttyTerminal, userdata: *mut c_void) {
        // SAFETY: the same retained shared allocation as write_pty.
        // Cell::set cannot panic or reenter Ghostty.
        unsafe { &*userdata.cast::<State>() }
            .title_changed
            .set(true);
    }
}

// The registration API accepts void pointers; still check signatures against
// the generated C typedefs at compile time.
const _: ffi::GhosttyTerminalWritePtyFn = Some(Effects::write_pty);
const _: ffi::GhosttyTerminalTitleChangedFn = Some(Effects::title_changed);
