## v0.7.4

### 仪表盘热力图双击弹窗（本次新增）

- 热力图方块**双击**即可弹窗查看当日模型用量分布
- 每种模型独立展示：**Token 用量 / 请求次数 / 费用 / 缓存命中率**（此前仅有 token 数）
- 范围外日期（不在当前 7d / 30d / all 范围内的方块）不可双击、无放大效果
- 弹窗内 Escape / 点击遮罩 / 关闭按钮均可关闭

### 数据结构升级

- 后端 `[dashboard] by_model` 从纯 token 数升级为结构化对象（含 requests / cost / cacheHitRate），弹窗和柱状图双击均展示全量指标

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
