## v0.7.7

### 双区域 OAuth 支持（适配 kimi-code 0.38.0）

- 适配官方 CLI v0.38.0 引入的双区域登录（mainland-cn `auth.kimi.com` / global `auth.kimi.ai`，#2862）
- **凭据动态解析**：按 provider 的 oauth ref（`key` / `oauthHost`）推导凭据文件与 token 刷新端点，global 账号（`credentials/kimi-code-env-<sha256>.json`）可正常查询用量；无 oauth ref 的老配置完全走旧路径，零回归
- **用量查询区域适配**：`api.kimi.ai/coding` 识别为官方套餐，usages 查询按 provider base_url 拼接
- **内置登录区域选择**：应用内 Kimi 登录对话框新增「中国大陆 / 国际版 (kimi.ai)」选择，登录成功后同步落盘凭据 + 按官方 CLI 行为 provision `[providers."managed:kimi-code"]`（global 写 `oauthHost`，cn 不写，保持区域信号正确）
- scoped key 推导与官方 CLI 逐字节一致（`JSON.stringify({oauthHost, baseUrl})` 的 sha256 前 16 位 hex），hash 值经独立复算验证

### 修复

- 修复手动添加模型后模型用量显示为 `xxx/新模型` 而非真实模型名：填入实际模型 ID 时别名自动跟随为 `<provider>/<model-id>`（含输入中间态跟随），连续添加占位条目不再互相覆盖
- 修复 managed（OAuth）供应商自填 `api_key` 在保存配置时被清空的问题：无 key 时按官方 provisioned 形态写空行，用户自填 key 完整保留

### 模型数据更新

- models.dev 快照刷新（**7246 模型 / 193 供应商**）：新增 **DeepSeek V4 Flash Vision Exp**（官方定价与 v4-flash 一致）、**Ox Alpha Free**（opencode-go，免费）等
