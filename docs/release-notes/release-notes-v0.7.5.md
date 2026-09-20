## v0.7.5

### 子代理模型池适配（kimi-code 0.36.0 新引擎）

- 适配 kimi-code v2 的 `[secondary_model]` 模型池语义：`default_model` + `[secondary_model.models]` 表 + `force`
- **双写兼容**：写入配置时 `model` 与 `default_model` 同步同值，v1 legacy 引擎（`KIMI_CODE_LEGACY_FLAG=1`）与 v2 引擎均可正常识别
- 高级设置页新增**模型池管理**：升级旧配置为模型池、增删池条目、编辑每条目的路由描述（渲染进主代理 Agent/AgentSwarm 工具描述，直接影响主模型对子代理模型的调度质量）
- 支持 **force 强制默认模型**开关（开启会清空池条目，带二次确认）
- 保存前本地校验：primary 保留别名、池条目与 default_model 一致性、别名必须已注册、force 与池互斥等 6 类错误前置拦截
- 新增 32 个单元测试覆盖池读写与校验逻辑（vitest）

### 仪表盘热力图详情改为按需加载

- 双击热力图方块改为调用后端 `get_day_detail` 按需聚合当日数据，**不再受当前 7d / 30d 范围限制**，任何有数据的日期都可查看明细
- 无数据日期双击给出提示，不再静默无响应

### 模型数据更新

- models.dev 快照刷新至 2026-08-15（6583 模型 / 185 供应商），新增 **GLM-5.3** 等一批新模型（含定价与能力标记）

### Downloads by platform

- **Windows**: `.msi` installer
- **macOS**: `.dmg` + `.app`（未签名，仅 Apple Silicon / M 系列芯片）
- **Linux**: `.deb` / `.AppImage` / `.rpm`

### macOS 安装说明（无开发者账号签名，需一次手动绕过）

1. 下载 `Kimi.Switch_*.dmg`，双击挂载后把 `Kimi Switch.app` 拖入「应用程序」文件夹
2. 下载本 Release 附带的 `install-macos.sh`，在终端运行：

   ```bash
   bash install-macos.sh
   ```

   脚本会自动清除下载隔离属性并启动应用，只需执行一次，之后正常使用。
3. 手动替代方案：右键 `Kimi Switch.app` → 打开 → 弹窗点「打开」；或 系统设置 → 隐私与安全性 → 仍要打开
