//! Query string encoding, bracket-encoded like `appendQuery`
//! (`packages/client/src/promise/generated/client.ts:2795-2810`). The encoders are `opencode-api-types`'s, which the
//! request builders use too.

pub use opencode_api_types::call::{append, encode};
pub use opencode_api_types::js::js_string;
