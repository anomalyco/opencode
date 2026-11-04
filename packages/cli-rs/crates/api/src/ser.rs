//! Serde helpers the generated types use to write numbers as `JSON.stringify` does.

use serde::Serializer;

/// A protocol number that is not an integer schema: a whole value is written as `3`, not `3.0`, so
/// request bodies match the TypeScript client byte for byte.
pub fn number<S: Serializer>(value: &f64, serializer: S) -> Result<S::Ok, S::Error> {
    // `fract` is NaN for non-finite values, which serde_json writes as `null`, as JavaScript does.
    if value.fract() == 0.0 && value.abs() < 9_223_372_036_854_775_808.0 {
        return serializer.serialize_i64(*value as i64);
    }
    serializer.serialize_f64(*value)
}

pub fn option_number<S: Serializer>(value: &Option<f64>, serializer: S) -> Result<S::Ok, S::Error> {
    match value {
        Some(value) => number(value, serializer),
        None => serializer.serialize_none(),
    }
}
