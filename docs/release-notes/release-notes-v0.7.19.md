# KimiSwitch v0.7.19

## 适配

- **适配 kimi-code 0.43.0 实验 flag 镜像（7→5）**：移除已转正的 `auto_session_title` 开关（上游 #3749，AI 会话标题不再需要 flag，首轮对话后自动生成、可在重命名处重新生成）。设置页「实验性 flag」、环境变量探测（`get_experimental_env_status`）、中英文案与测试断言同步清理；上游 0.43.0 注册表现剩 5 个 flag： `wait_for` / `tool-select` / `notify_user` / `tower` / `subagent_fork`
- **兼容性核查结论（无需改动）**：0.43.0 的 wire 持久化重建（#3737）不影响用量统计——`usage.record` / `token_counting.measured` / `context.apply_compaction` / `turn.prompt` 记录全部保留（`turn.prompt` 仅新增可选 `turnId` 字段）；新增配置项 `loop_control.compaction_max_attempts`（#3750）经现有合并式写入验证保存不丢失；MCP `deferred` 字段（#3667）不涉及本应用管理的配置节

## 备注

- 若此前在 `[experimental]` 中显式开启过 `auto_session_title`，残留键会被上游静默忽略，无需手动清理
