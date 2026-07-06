use crate::models::{Config, ProfileSummary};

#[tauri::command]
pub fn load_config_command() -> Config {
    Config {
        default_model: None,
        providers: indexmap::IndexMap::new(),
        models: indexmap::IndexMap::new(),
        raw_other: toml_edit::Table::new(),
    }
}

#[tauri::command]
pub fn save_config_command(_config: Config) -> Result<(), String> {
    Ok(())
}

#[tauri::command]
pub fn list_profiles() -> Vec<ProfileSummary> {
    Vec::new()
}

#[tauri::command]
pub fn load_profile(_filename: String) -> Config {
    Config {
        default_model: None,
        providers: indexmap::IndexMap::new(),
        models: indexmap::IndexMap::new(),
        raw_other: toml_edit::Table::new(),
    }
}

#[tauri::command]
pub fn save_profile(_filename: String, _config: Config) -> Result<(), String> {
    Ok(())
}

#[tauri::command]
pub fn switch_profile(_filename: String) -> Result<Config, String> {
    Ok(Config {
        default_model: None,
        providers: indexmap::IndexMap::new(),
        models: indexmap::IndexMap::new(),
        raw_other: toml_edit::Table::new(),
    })
}

#[tauri::command]
pub fn rename_profile(_old_filename: String, _new_name: String) -> Result<String, String> {
    Ok(String::new())
}

#[tauri::command]
pub fn delete_profile(_filename: String) -> Result<(), String> {
    Ok(())
}

#[tauri::command]
pub fn open_config_dir() -> Result<(), String> {
    Ok(())
}

#[tauri::command]
pub fn get_app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}
