## v0.7.1

### 实验功能设置：子代理模型配置

- 新增「子代理模型（次主力模型）」设置：选择次主力模型后，子代理默认绑定该模型，不再继承主模型
- 仅保存模型引用，子代理直接继承所选模型的上下文长度与思考模式，无需补丁配置
- 界面只读展示继承的上下文长度与思考模式

### 仪表盘用量统计

- 识别子代理请求（`__secondary__`）：归为「子代理模型（估算）」独立展示，并缓存次主力模型定价，删除配置后历史记录仍稳定估算
- 自定义网关模型（未收录 models.dev）按官方同名模型跨 provider 匹配价格，不再落入兜底估算

### Downloads by platform

- **Windows**: `.msi` installer
- **macOS**: `.dmg` (unsigned — first launch needs right-click → Open) + `.app`
- **Linux**: `.deb` / `.AppImage` / `.rpm`
