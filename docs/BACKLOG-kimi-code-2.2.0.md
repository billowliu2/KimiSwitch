# Kimi Code 2.2.0 适配 — 可选后续项

> 2026-10-15 适配核验时确认：必改项为零（`[mcp] default_deferred` 与 `[models] upgrade`
> 元数据经 raw_other 透传无损往返，回归测试见 `src-tauri/src/kimi_code_io.rs`
> 的 `kimi_code_roundtrip_*` 两条测试）。以下为**评估后暂缓**的可选增强，按需再排期。

## 1. 模型退役角标（UI 增强）

- **内容**：模型列表读取模型 `raw_other.upgrade.retirement_at`，显示「将于 X 退役，
  建议迁移到 Y」角标
- **暂缓原因**：上游 2.2.0 才引入迁移元数据，实际写入该字段的 registry 还很少，
  等 CLI 侧普及后再做收益更高

## 2. JSON 编辑器透传字段提示（防误删）

- **内容**：JSON 预览 / 应用处提示「删除 `raw_other` 会丢失 CLI 透传字段
  （如 `upgrade` 迁移元数据）」
- **位置**：`handleApplyProviderJson`（`src/App.tsx`）是整表重建语义——用户手改
  JSON 删掉 `raw_other` 块时透传字段随之丢失；属用户显式编辑行为，非 bug
- **暂缓原因**：触发条件苛刻（须手动删除 raw_other 块），文案提示即可，优先级低

## 3. TOML datetime 类型降级兜底（上游依赖）

- **内容**：若上游未来把 `upgrade.retirement_at` 写成 TOML datetime（当前是字符串），
  `toml_value_to_json` → `json_to_toml` 往返会把它降级为字符串
- **暂缓原因**：当前上游（kimi-code 2.2.0）写入的就是字符串，无实际影响；
  升级 CLI 时留意 `git diff` config.toml 中该字段类型即可

## 背景参考

- 适配结论：实验开关（5 flag）、版本基线（≥2.0.2 → current）、前端模型编辑
  merge 语义均无需改动
- `executor = "kaos"` 检测评估过、放弃：该字段在 mcp.json（KimiSwitch 不管理），
  不在 config.toml
