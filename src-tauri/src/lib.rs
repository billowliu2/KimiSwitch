pub mod commands;
pub mod config_io;
pub mod models;
pub mod profile_manager;
pub mod validators;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            commands::load_config_command,
            commands::save_config_command,
            commands::list_profiles,
            commands::load_profile,
            commands::save_profile,
            commands::switch_profile,
            commands::rename_profile,
            commands::delete_profile,
            commands::open_config_dir,
            commands::get_app_version,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
