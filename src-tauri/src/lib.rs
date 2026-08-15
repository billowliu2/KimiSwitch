pub mod commands;
pub mod config_io;
pub mod dashboard;
pub mod db;
pub mod kimi_code_io;
pub mod models;
pub mod oauth;
pub mod pi_io;
pub mod services;

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
            // Build the models.dev price index off the first dashboard query.
            dashboard::warm_price_index();
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
                .tooltip("Kimi Switch")
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
                                let _ = window.show();
                                let _ = window.unminimize();
                                let _ = window.set_focus();
                            }
                        }
                    }
                })
                .build(app)?;

            // Close button -> hide to tray instead of quitting. Minimize keeps
            // the taskbar button (native behaviour); only an explicit close
            // (window X) retreats to the tray.
            let window_clone = window.clone();
            window.on_window_event(move |event| match event {
                tauri::WindowEvent::CloseRequested { api, .. } => {
                    api.prevent_close();
                    let _ = window_clone.hide();
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
            commands::query_provider_usage,
            commands::debug_log,
            commands::get_app_setting,
            commands::set_app_setting,
            commands::check_for_update,
            commands::download_update,
            commands::open_installer,
            commands::open_external_url,
            commands::open_kimi_web,
            commands::open_kimi_web_embedded,
            commands::kimi_oauth_start,
            commands::kimi_oauth_poll,
            commands::get_experimental_env_status,
            dashboard::get_paths,
            dashboard::get_prices,
            dashboard::get_summary,
            dashboard::get_day_detail,
            dashboard::list_sessions,
            dashboard::archive_session,
            dashboard::unarchive_session,
            dashboard::delete_session,
            dashboard::delete_workspace,
            dashboard::get_session_preview,
        ])
        .manage(commands::KimiWebState::default())
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|app: &tauri::AppHandle, event| {
            // Ensure a `kimi web` server spawned for the embedded WebUI window
            // is stopped when the app exits (windows already destroyed first).
            if let tauri::RunEvent::Exit = event {
                let state = app.state::<commands::KimiWebState>();
                commands::kill_spawned_kimi_web(&state);
            }
        });
}
