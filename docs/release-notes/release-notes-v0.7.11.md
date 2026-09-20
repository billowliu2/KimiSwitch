## v0.7.11

### 适配 kimi-code 0.39.1

- **修复：`[thinking]` 保留开关不再破坏思考配置**。此前在 UI 关闭"保留思考内容"会写入布尔 `keep = false`，而上游两个引擎都只接受字符串——v2 会把整个 `[thinking]` 节校验失败并丢弃。现改为写 `keep = "off"`，存量配置里的布尔值加载时自动归一化
- **修复：`loop_control` 不再触发上游废弃告警**。默认只写新键 `max_attempts_per_step` 并清理存量旧键 `max_retries_per_step`；仅检测到 `KIMI_CODE_LEGACY_FLAG`（v1 引擎）时才双写
- **思考强度移除 `max` 档**（上游已自动迁移为 `high`），存量配置显示归一
- **实验开关同步上游全集**：新增 remote-control；`wait_for` 与 persistence_minidb_readmodel 已在上游转正默认开启，UI 会标注"默认开启"（显式关闭优先）

### 会话归档与上游 v2 对齐

- **归档不再搬动文件**：改为在会话 `state.json` 写入 `archived`/`archivedAt` 元数据（与 CLI v2 的 `setArchived` 逐字段一致），CLI 侧与 Kimi Switch 侧归档状态从此互通
- 旧版本物理归档的会话（`.kcd-archive/` 目录）仍可识别为已归档并正常恢复
- 归档不再改写 `session_index.jsonl`（删除会话的行为不变）

### 子代理模型池修复

- **修复：模型池无法添加第二个条目**。从"仅默认模型"的隐式单条目形态添加条目时，默认模型现在会自动物化进池，不再被"默认模型不在模型池中"的校验拦截

### 模型数据同步

- models.dev 快照刷新至 **7482 个模型 / 207 个供应商**
