pub mod commands;
pub mod config_io;
pub mod dashboard;
pub mod db;
pub mod kimi_code_io;
pub mod models;
pub mod pi_io;

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder};
use tauri::Manager;

pub fn run() {
    tauri::Builder::default()
        // Single instance: must be registered before other plugins. When a
        // second process is launched, this callback runs in the existing
        // instance and simply brings its window back (including from tray).
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            println!("[Tauri] Setup started");
            let window = app.get_webview_window("main").unwrap();
            println!("[Tauri] Window label: {}", window.label());

            // Tray menu: show / separator / quit
            let show_i = MenuItem::with_id(app, "show", "显示", true, None::<&str>)?;
            let quit_i = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
            let menu = Menu::with_items(
                app,
                &[&show_i, &PredefinedMenuItem::separator(app)?, &quit_i],
            )?;

            // Tray icon: reuse the window icon
            let icon = app.default_window_icon().unwrap().clone();
            TrayIconBuilder::new()
                .icon(icon)
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.unminimize();
                            let _ = window.set_focus();
                        }
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let tauri::tray::TrayIconEvent::Click {
                        button,
                        button_state,
                        ..
                    } = event
                    {
                        if button == MouseButton::Left && button_state == MouseButtonState::Up {
                            let app = tray.app_handle();
                            if let Some(window) = app.get_webview_window("main") {
                                if window.is_visible().unwrap_or(true) {
                                    let _ = window.hide();
                                } else {
                                    let _ = window.show();
                                    let _ = window.unminimize();
                                    let _ = window.set_focus();
                                }
                            }
                        }
                    }
                })
                .build(app)?;

            // Minimize to tray: restore then hide so the taskbar button disappears
            let window_clone = window.clone();
            window.on_window_event(move |event| match event {
                tauri::WindowEvent::Resized(_) => {
                    if window_clone.is_minimized().unwrap_or(false) {
                        let _ = window_clone.unminimize();
                        let _ = window_clone.hide();
                    }
                }
                _ => {}
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::load_agent_config_command,
            commands::save_agent_config_command,
            commands::activate_agent_config_command,
            commands::open_agent_config_dir,
            commands::get_app_version,
            commands::list_provider_models,
            commands::test_connectivity,
            commands::debug_log,
            commands::get_app_setting,
            commands::set_app_setting,
            commands::check_for_update,
            commands::download_update,
            commands::open_installer,
            dashboard::get_paths,
            dashboard::get_prices,
            dashboard::get_summary,
            dashboard::list_sessions,
            dashboard::archive_session,
            dashboard::unarchive_session,
            dashboard::delete_session,
            dashboard::delete_workspace,
            dashboard::get_session_preview,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
