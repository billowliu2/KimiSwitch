# KimiSwitch v0.7.21

## 新增

- **models.dev 在线同步**：高级设置新增「模型参考数据（models.dev）」卡片——一键在线拉取 models.dev 最新快照，新模型发布后无需等待 KimiSwitch 发版：
  - 覆盖三类参考数据：模型上下文长度、能力标记（思考 / 工具 / 图像 / 视频）、单价（$/M tokens）
  - 同步后立即生效：供应商编辑页的参数自动填充、仪表盘用量计价（Rust 侧价格索引按快照文件 mtime 自动重建，无需重启应用）
  - 数据落在 `~/.kimi-switch/models-dev.json`，打包内置快照始终作为兜底；无效副本自动回退
  - 支持一键「恢复内置数据」，随时可重新同步
  - 状态行显示当前数据来源（在线同步 / 随版本内置）、快照日期与模型 / 供应商数量
  - 代理环境自动适配：依次读取 `HTTPS_PROXY` / `HTTP_PROXY` 环境变量与 git `http.proxy` 配置

## 修复

- **构建链路数据漂移**：`fetch-models-dev.mjs` 此前只写 `src/lib/models-dev.json`（Rust 计价内嵌），前端实际加载的 `public/models-dev.json` 需手工拷贝，历史上已两次滞后。现在两个文件由脚本同步写入，彻底消除漂移

## 适配

- **kimi-code 2.1.0 已适配确认**：实验 flag 注册表（5 个）、config 模式、用量 / quota 格式均无变化；上游 `[watch]` 默认关闭与现有开关行为一致；新增 `tui_mode`（`~/.kimi-code/tui.toml`）不涉及配置管理面，暂无适配需求

## 数据

- models-dev 快照同步至 2026-09-23（8,126 模型 / 223 供应商）
