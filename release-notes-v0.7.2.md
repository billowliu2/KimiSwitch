## v0.7.2

### 子代理模型指定（实验功能）

- 新增「子代理模型（次主力模型）」指定：在实验功能设置中为子代理选择次主力模型后，子代理默认绑定该模型，不再继承主模型
- 实验开关改为滑动开关，修复开启态因样式缺失而不可见的问题
- 仅保存模型引用，子代理直接继承所选模型的上下文长度与思考模式

### 模型数据与发布

- models.dev 模型列表与价格数据同步更新
- 官网企业版视觉升级；出品公司标识统一为 codingplan.site
- macOS 发布优化：Release 附带 `install-macos.sh` 一键安装脚本（见下方说明）

### Downloads by platform

- **Windows**: `.msi` installer
- **macOS**: `.dmg` + `.app`（未签名，仅 Apple Silicon / M 系列芯片）
- **Linux**: `.deb` / `.AppImage` / `.rpm`

### macOS 安装说明（无开发者账号签名，需一次手动绕过）

> 原因：macOS 包未做 Developer ID 签名与公证（无 Apple 开发者账号），系统会拦截从网络下载的未签名应用（Gatekeeper）。`install-macos.sh` 通过清除「下载隔离」属性绕过该拦截，不影响功能与安全。

1. 下载 `Kimi.Switch_0.7.2_aarch64.dmg`，双击挂载后把 `Kimi Switch.app` 拖入「应用程序」文件夹
2. 下载本 Release 附带的 `install-macos.sh`，在终端运行：

   ```bash
   bash install-macos.sh
   ```

   脚本会自动清除下载隔离属性并启动应用，只需执行一次，之后正常使用。
3. 手动替代方案：右键 `Kimi Switch.app` → 打开 → 弹窗点「打开」；或 系统设置 → 隐私与安全性 → 仍要打开
