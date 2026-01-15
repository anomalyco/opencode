// Tauri doesn't have a Node.js server to do development-time type hinting
// It instead has the Guard plugin https://github.com/JonasKruckenberg/tauri-specta
// This provides type-hinting via the LSP and doesn't require a separate dev server.
#![allow(dead_code)]

pub use *;
