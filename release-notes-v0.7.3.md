## v0.7.3

### Kimi Code WebUI 应用内嵌窗口（本次新增）

- 高级设置页「在应用内打开」：新版 Web 界面以**独立顶层窗口**打开（1100×750、可缩放、居中），不再跳转到外部浏览器
- **单例**：窗口最多一个，重复点击自动聚焦；最小化后再次打开可恢复
- **服务器自动管理**：复用已在运行的 `kimi web` 本地服务（不重复拉起）；自己启动的服务器在窗口关闭或应用退出时自动清理，不留残留进程
- 两个入口并存：「在应用内打开」+「在浏览器打开」（浏览器入口复用已运行的本地服务器，直接打开 `http://127.0.0.1:58627`）

### 修复与打磨

- 窗口创建失败（快速双击竞态）时不再泄漏 `kimi web` 进程
- WebUI 说明文案与发布说明同步更新

### Downloads by platform

- **Windows**: `.msi` installer
- **macOS**: `.dmg` + `.app`（未签名，仅 Apple Silicon / M 系列芯片）
- **Linux**: `.deb` / `.AppImage` / `.rpm`

### macOS 安装说明（无开发者账号签名，需一次手动绕过）

> 原因：macOS 包未做 Developer ID 签名与公证（无 Apple 开发者账号），系统会拦截从网络下载的未签名应用（Gatekeeper）。`install-macos.sh` 通过清除「下载隔离」属性绕过该拦截，不影响功能与安全。

1. 下载 `Kimi.Switch_0.7.3_aarch64.dmg`，双击挂载后把 `Kimi Switch.app` 拖入「应用程序」文件夹
2. 下载本 Release 附带的 `install-macos.sh`，在终端运行：

   ```bash
   bash install-macos.sh
   ```

   脚本会自动清除下载隔离属性并启动应用，只需执行一次，之后正常使用。
3. 手动替代方案：右键 `Kimi Switch.app` → 打开 → 弹窗点「打开」；或 系统设置 → 隐私与安全性 → 仍要打开
