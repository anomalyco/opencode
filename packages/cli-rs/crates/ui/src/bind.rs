//! Callbacks that hold a weak reference. opentui-rust callbacks are `'static`, so one that reaches shared state
//! captures a `Weak` and upgrades it on each call. [`bind!`](crate::bind!) writes that plumbing once.

use std::rc::{Rc, Weak};

/// What [`bind!`](crate::bind!) captures: a `Weak` (cloned), an `Rc` (downgraded), or a type that knows its own
/// `Weak`.
pub trait WeakRef {
    type Target: ?Sized;
    fn weak_ref(&self) -> Weak<Self::Target>;
}

impl<T: ?Sized> WeakRef for Rc<T> {
    type Target = T;
    fn weak_ref(&self) -> Weak<T> {
        Rc::downgrade(self)
    }
}

impl<T: ?Sized> WeakRef for Weak<T> {
    type Target = T;
    fn weak_ref(&self) -> Weak<T> {
        self.clone()
    }
}

impl<W: WeakRef + ?Sized> WeakRef for &W {
    type Target = W::Target;
    fn weak_ref(&self) -> Weak<W::Target> {
        (**self).weak_ref()
    }
}

/// A `move` closure that holds `weak` (any [`WeakRef`]) weakly. Each call upgrades it, binds the `Rc` to the
/// first parameter and runs the body with the remaining parameters; when the target is gone the call returns
/// `Default::default()`. Add `, else value` to return something else.
///
/// ```ignore
/// props.on_select = Some(Rc::new(bind!(list, |list, option: &SelectOption<SessionID>| list.open(option))));
/// ```
#[macro_export]
macro_rules! bind {
    // Collects the closure parameters up to the closing `|`.
    (@args $weak:ident [$($this:tt)*] [$($arg:tt)*] | $($rest:tt)*) => {
        $crate::bind!(@closure $weak [$($this)*] [$($arg)*] $($rest)*)
    };
    (@args $weak:ident [$($this:tt)*] [$($arg:tt)*] $next:tt $($rest:tt)*) => {
        $crate::bind!(@args $weak [$($this)*] [$($arg)* $next] $($rest)*)
    };
    (@closure $weak:ident [$($this:tt)*] [$($arg:tt)*] $body:expr $(, else $fallback:expr)? $(,)?) => {
        move |$($arg)*| match $weak.upgrade() {
            Some($($this)*) => $body,
            None => $crate::bind!(@fallback $($fallback)?),
        }
    };
    (@fallback) => {
        Default::default()
    };
    (@fallback $fallback:expr) => {
        $fallback
    };
    ($weak:expr, |$this:pat_param| $($rest:tt)*) => {{
        let weak = $crate::bind::WeakRef::weak_ref(&$weak);
        $crate::bind!(@closure weak [$this] [] $($rest)*)
    }};
    ($weak:expr, |$this:pat_param, $($rest:tt)*) => {{
        let weak = $crate::bind::WeakRef::weak_ref(&$weak);
        $crate::bind!(@args weak [$this] [] $($rest)*)
    }};
}
