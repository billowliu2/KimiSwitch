## v0.7.6

### OpenCode Go 套餐用量查询

- 新增 **OpenCode Go 套餐额度查询**：供应商卡片用量页脚显示 **5 小时滚动 / 7 天 / 30 天** 三个窗口的已用百分比与重置时间（数据源为 opencode.ai 官方 usage API）
- 数据源：`GET https://opencode.ai/zen/go/v1/usage`（Bearer 认证），直接解析官方 `rolling / weekly / monthly` 三窗口的 `percent` 与 `resetsAt`
- **老配置自动适配**：已配置 OpenCode Go API Key 的现有用户无需任何手动设置，程序按 `base_url` 自动识别并启用用量查询
- 兼容处理：已适配 opencode.ai 的 Cloudflare 拦截（请求携带浏览器 User-Agent），并对外部接口失败给出可读的错误提示

### 插件目录占用错误提示优化

- 插件目录被运行中进程占用时的错误提示给出明确指引（底层改进）

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