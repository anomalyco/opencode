#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{Manager, CustomMenuItem, Menu, Submenu};
use std::sync::Mutex;

struct AppState {
    always_on_top: Mutex<bool>,
}

fn main() {
    // Create menu
    let toggle_always_on_top = CustomMenuItem::new("toggle_always_on_top".to_string(), "Always on Top")
        .accelerator("Cmd+T")
        .selected();
    
    let view_menu = Submenu::new(
        "View",
        Menu::new().add_item(toggle_always_on_top)
    );
    
    let menu = Menu::new().add_submenu(view_menu);

    tauri::Builder::default()
        .manage(AppState {
            always_on_top: Mutex::new(true),
        })
        .menu(menu)
        .on_menu_event(|event| {
            match event.menu_item_id() {
                "toggle_always_on_top" => {
                    let window = event.window();
                    let state = window.state::<AppState>();
                    let mut always_on_top = state.always_on_top.lock().unwrap();
                    *always_on_top = !*always_on_top;
                    window.set_always_on_top(*always_on_top).unwrap();
                }
                _ => {}
            }
        })
        .setup(|app| {
            let window = app.get_window("main").unwrap();
            
            #[cfg(target_os = "macos")]
            {
                use cocoa::appkit::{NSWindow, NSColor};
                use cocoa::base::{id, nil, NO};
                
                unsafe {
                    let ns_window = window.ns_window().unwrap() as id;
                    let clear_color = NSColor::clearColor(nil);
                    NSWindow::setBackgroundColor_(ns_window, clear_color);
                    NSWindow::setOpaque_(ns_window, NO);
                }
            }
            
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
