# KimiSwitch v0.7.12

## 适配 kimi-code 0.40.1

- **实验 flag 清单更新（9→10）**：新增 `file_history`（轮级文件历史快照）、`search_worker`（kap-server 全局搜索 worker）；`secondary-model`（子代理次主力模型）自 kimi-code 0.40.1 起默认开启，设置页显示"默认开启"徽章
- **flag 优先级语义修正**：跟随上游新优先级——单 flag 环境变量 > `[experimental]` 显式配置 > 总开关环境变量（仅强制开）> 默认值。总开关 `KIMI_CODE_EXPERIMENTAL_FLAG` 不再锁定全部开关，显式写入的 false/true 优先生效
- **环境变量探测补齐**：`tower` / `subagent_fork` / `wait_for` / `auto_session_title` 等此前漏探测的环境变量现在会正确显示"被环境变量锁定"状态
- **新增危险命令守卫开关**：权限设置页可配置 `[permission] dangerous_command_guard`（默认开启）——Auto 模式直接拒绝 `rm -rf` / `shutdown` 等危险命令，其它模式强制询问，关闭后回归旧行为

## 修复

- **WebUI 打开竞态**：首次打开较慢时多次点击"在应用内打开"不再报错——并发调用串行化 + 后到的点击自动聚焦已有窗口；失败路径不再误杀正在使用的 server；前端按钮增加"打开中..."防重入态

## 数据

- models-dev 快照更新至 7495 模型 / 212 供应商
