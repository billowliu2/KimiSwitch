## v0.7.10

### 配置写回保护（适配 kimi-code 0.38+ 配置演进）

- **修复：保存不再误删 CLI 新增的顶层配置节**。此前在 Kimi Switch 加载配置后，若 Kimi Code CLI 往 `config.toml` 写入了新的顶层节（如 0.38+ 的 `[task]` / `[swarm]` / `[cron]` / `[tools]` / `[identity]` / `[token_counting]` 等），回到 Kimi Switch 保存时会把这些节**静默删除**。现在以导入时的顶层键为基线：CLI 后加的节原样保留；在界面中显式删除的节仍会被移除；老数据（无基线，如 SQLite 快照恢复）不删任何键
- **修复：未知供应商类型不再被改写**。`config.toml` 中 Kimi Code 新增的供应商 `type` 值往返读写后不再被改写成 `kimi`，原样保留；编辑器 API 格式下拉框显示原始值（标注"未知类型"）；模型发现等不支持的操作返回明确错误提示，不再误用 `KIMI_API_KEY`
- SQLite 快照恢复路径同步修复（此前从快照恢复同样会丢失未知类型）
- 新增 3 个配置往返回归测试（Rust 测试 106 项全绿，前端 tsc / vitest 通过）
