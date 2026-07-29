// Adapted from cc-switch (MIT, © Jason Young)
// https://github.com/farion1231/cc-switch

//! Shared return contract for provider billing/usage queries.
//!
//! MUST stay camelCase: the frontend reads `planName` / `resetsAt` /
//! `isValid` — snake_case serialization would silently misalign every field.

use serde::Serialize;

#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct UsageData {
    pub plan_name: Option<String>,
    pub remaining: Option<f64>,
    pub total: Option<f64>,
    pub used: Option<f64>,
    pub unit: Option<String>,
    pub is_valid: Option<bool>,
    pub resets_at: Option<String>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct UsageResult {
    pub success: bool,
    pub data: Option<Vec<UsageData>>,
    pub error: Option<String>,
}

impl UsageResult {
    pub fn ok(data: Vec<UsageData>) -> Self {
        UsageResult {
            success: true,
            data: if data.is_empty() { None } else { Some(data) },
            error: None,
        }
    }

    pub fn failure(msg: String) -> Self {
        UsageResult {
            success: false,
            data: None,
            error: Some(msg),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn usage_result_serializes_camel_case() {
        let result = UsageResult {
            success: true,
            data: Some(vec![UsageData {
                plan_name: Some("five_hour".to_string()),
                remaining: Some(65.0),
                total: Some(100.0),
                used: Some(35.0),
                unit: Some("%".to_string()),
                is_valid: Some(true),
                resets_at: Some("2026-07-29T12:00:00+00:00".to_string()),
            }]),
            error: None,
        };
        let json = serde_json::to_string(&result).unwrap();
        assert!(json.contains("\"planName\""), "json: {json}");
        assert!(json.contains("\"resetsAt\""), "json: {json}");
        assert!(json.contains("\"isValid\""), "json: {json}");
        assert!(json.contains("\"plan_name\"") == false, "json: {json}");
        assert!(json.contains("\"resets_at\"") == false, "json: {json}");
        assert!(json.contains("\"is_valid\"") == false, "json: {json}");
    }
}
