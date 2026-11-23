use std::sync::{Mutex, MutexGuard, PoisonError};

pub mod bundle;
pub mod busy;
pub mod dl;
pub mod error;
#[cfg(feature = "ring")]
pub mod hash;
pub mod job;
pub mod page;
pub mod path;
pub mod rng;
pub mod temp;
pub mod text_boundary;
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
/// `"key": move value` (or `?: move`) inserts an owned `Value` as it is; a plain value is serialized from a borrow,
/// which copies a `Value` deeply.
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
    (@insert $map:ident $key:literal ?: move $value:expr $(, $($rest:tt)*)?) => {
        if let Some(value) = $value {
            $map.insert($key.into(), ::serde_json::Value::from(value));
        }
        $crate::json_object!(@insert $map $($($rest)*)?);
    };
    (@insert $map:ident $key:literal : move $value:expr $(, $($rest:tt)*)?) => {
        $map.insert($key.into(), ::serde_json::Value::from($value));
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
    fn json_object_moves_owned_values() {
        let content = serde_json::Value::String("x".repeat(1024));
        let buffer = content.as_str().unwrap().as_ptr();
        let inner = json_object! { "content": move content };
        let outer = json_object! { "a"?: move None::<serde_json::Value>, "state"?: move Some(inner) };
        let outer = json_object! { "part": move outer };
        assert_eq!(outer["part"]["state"]["content"].as_str().unwrap().as_ptr(), buffer);
        assert_eq!(outer["part"].as_object().unwrap().len(), 1);
        let copied = json_object! { "part": outer };
        assert_ne!(copied["part"]["part"]["state"]["content"].as_str().unwrap().as_ptr(), buffer);
    }
}
