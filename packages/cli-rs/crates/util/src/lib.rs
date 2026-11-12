//! Small modules that several crates share, on `libc` alone, `ring` behind its feature, and `windows-sys` on Windows.

use std::sync::{Mutex, MutexGuard, PoisonError};

pub mod dl;
pub mod error;
#[cfg(feature = "ring")]
pub mod hash;
pub mod path;
pub mod temp;
pub mod time;
#[cfg(windows)]
pub mod win;

/// Locks `mutex`, and takes the guard of a poisoned one: a panic on another thread leaves the data usable.
pub fn lock<T: ?Sized>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

/// A `serde_json::Value` object, like a TS object literal: `json_object!{ "type": "status", "error"?: error }`.
/// A key marked `?` takes an `Option` and is left out when it is `None`, as `JSON.stringify` drops `undefined`.
/// `..value` spreads the members of an object value, as `...value` does; other values add nothing.
/// Keys keep the order written. The caller depends on `serde_json`; this crate does not.
#[macro_export]
macro_rules! json_object {
    (@insert $map:ident) => {};
    (@insert $map:ident .. $value:expr $(, $($rest:tt)*)?) => {
        if let ::serde_json::Value::Object(object) = $value {
            $map.extend(object);
        }
        $crate::json_object!(@insert $map $($($rest)*)?);
    };
    (@insert $map:ident $key:literal ?: $value:expr $(, $($rest:tt)*)?) => {
        if let Some(value) = $value {
            $map.insert($key.into(), ::serde_json::json!(value));
        }
        $crate::json_object!(@insert $map $($($rest)*)?);
    };
    (@insert $map:ident $key:literal : $value:expr $(, $($rest:tt)*)?) => {
        $map.insert($key.into(), ::serde_json::json!($value));
        $crate::json_object!(@insert $map $($($rest)*)?);
    };
    ($($body:tt)*) => {{
        #[allow(unused_mut)]
        let mut map = ::serde_json::Map::new();
        $crate::json_object!(@insert map $($body)*);
        ::serde_json::Value::Object(map)
    }};
}

#[cfg(test)]
mod tests {
    #[test]
    fn json_object_keeps_order_drops_none_and_spreads() {
        let none: Option<&str> = None;
        let rest = serde_json::json!({ "b": 2, "z": "spread" });
        let object = json_object! { "z": "first", "a"?: none, "b"?: Some(1), ..rest, "c": [1], ..serde_json::json!(3) };
        assert_eq!(object.to_string(), r#"{"z":"spread","b":2,"c":[1]}"#);
        assert_eq!(json_object! {}.to_string(), "{}");
    }
}
