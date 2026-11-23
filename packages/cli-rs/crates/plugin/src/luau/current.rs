//! What the running call of a Luau plugin was given (its `Read`, its `Host`, setup's registration, a view), reachable
//! from the VM's `read` and `host` objects while the call runs and from nothing after it.
//!
//! The objects live in the VM, which outlives every call, while what a call is given lives for that call only. So the
//! call's borrow is kept here as a raw pointer, with its lifetime erased, by an [`Enter`] guard that the call creates
//! and drops before it returns, also when it unwinds, which puts back what was there before. A Luau function that
//! keeps an object and calls it later reaches that later call's borrow, or none: never one that ended.

#![allow(unsafe_code)]

use std::cell::Cell;

use mlua::Error;
use opencode_plugin_abi::{self as abi, v2};

/// The borrow of the running call, if any.
#[derive(Clone, Copy, Default)]
pub(crate) enum Current {
    #[default]
    Idle,
    Read(*const (dyn abi::Read + 'static)),
    Host(*const (dyn abi::Host + 'static)),
    Setup(*mut abi::Setup<'static>),
    View(*mut v2::View<'static>),
}

impl Current {
    /// A render's: it reads.
    pub(crate) fn reading<'a>(read: &'a (dyn abi::Read + 'a)) -> Self {
        let read: *const (dyn abi::Read + 'a) = read;
        // SAFETY: only the lifetime changes; [`Enter`] keeps the pointer for no longer than the borrow.
        Self::Read(unsafe {
            std::mem::transmute::<*const (dyn abi::Read + 'a), *const (dyn abi::Read + 'static)>(read)
        })
    }

    /// A handler's: it reads and acts.
    pub(crate) fn acting<'a>(host: &'a (dyn abi::Host + 'a)) -> Self {
        let host: *const (dyn abi::Host + 'a) = host;
        // SAFETY: as for `reading`.
        Self::Host(unsafe {
            std::mem::transmute::<*const (dyn abi::Host + 'a), *const (dyn abi::Host + 'static)>(host)
        })
    }

    pub(crate) fn setting_up(setup: &mut abi::Setup<'_>) -> Self {
        Self::Setup((setup as *mut abi::Setup<'_>).cast())
    }

    pub(crate) fn viewing(view: &mut v2::View<'_>) -> Self {
        Self::View((view as *mut v2::View<'_>).cast())
    }

    /// What the call may read: any call reads.
    pub(crate) fn read<'a>(self) -> mlua::Result<&'a dyn abi::Read> {
        // SAFETY: each pointer is the running call's borrow, live while its [`Enter`] is, and the caller is a method
        // of the VM's objects, which runs within that call.
        unsafe {
            match self {
                Self::Idle => Err(Error::runtime("the host is reachable only while the plugin's call runs")),
                Self::Read(read) => Ok(&*read),
                Self::Host(host) => Ok(&*host as &dyn abi::Read),
                Self::Setup(setup) => Ok((*setup).host() as &dyn abi::Read),
                Self::View(view) => Ok((*view).read),
            }
        }
    }

    /// What the call may act on: a render or a view reads only.
    pub(crate) fn host<'a>(self) -> mlua::Result<&'a dyn abi::Host> {
        // SAFETY: as for `read`.
        unsafe {
            match self {
                Self::Host(host) => Ok(&*host),
                Self::Setup(setup) => Ok((*setup).host()),
                Self::Idle => Err(Error::runtime("the host is reachable only while the plugin's call runs")),
                Self::Read(_) | Self::View(_) => {
                    Err(Error::runtime("a render or a view may read, and ask for nothing"))
                }
            }
        }
    }

    /// Setup's registration, while setup runs.
    pub(crate) fn setup<'a>(self) -> Option<&'a mut abi::Setup<'static>> {
        match self {
            // SAFETY: as for `read`; setup's methods run one at a time on this thread, and none keeps the reference.
            Self::Setup(setup) => Some(unsafe { &mut *setup }),
            _ => None,
        }
    }

    /// The running view, while one runs.
    pub(crate) fn view<'a>(self) -> Option<&'a mut v2::View<'static>> {
        match self {
            // SAFETY: as for `setup`; a memo's build enters the view it is given, so the outer one is not used meanwhile.
            Self::View(view) => Some(unsafe { &mut *view }),
            _ => None,
        }
    }
}

/// Where a VM keeps its running call's borrow.
#[derive(Default)]
pub(crate) struct Slot(Cell<Current>);

impl Slot {
    pub(crate) fn get(&self) -> Current {
        self.0.get()
    }
}

/// Keeps a call's borrow in its slot until it drops, then puts back what was there.
pub(crate) struct Enter<'a> {
    slot: &'a Slot,
    previous: Current,
}

impl<'a> Enter<'a> {
    pub(crate) fn new(slot: &'a Slot, current: Current) -> Self {
        Self { slot, previous: slot.0.replace(current) }
    }
}

impl Drop for Enter<'_> {
    fn drop(&mut self) {
        self.slot.0.set(self.previous);
    }
}
