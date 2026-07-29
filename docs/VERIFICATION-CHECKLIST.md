# v0.6.0 手动验证 Checklist

> 本文档是 [PROPOSAL-presets-and-usage.md](./PROPOSAL-presets-and-usage.md) P0 实施后的回归清单。
> 覆盖 v0.6.0 新增的「预设供应商 + 供应商账单查询」功能，附带核心旧功能的回归项。
> **不替代自动化测试**（项目尚无单测体系），仅作为每次发版前的人工冒烟与回归依据。

## 0. 测试环境准备

- [ ] 干净 config 目录（备份并删除 `%USERPROFILE%/.kimi-code/config.toml` 与 `%USERPROFILE%/.kimi-code/kimi-switch.db`）
- [ ] 至少 2 个真实 API Key：DeepSeek（余额）、Kimi For Coding（套餐，登录 kimi.com/code 拿 `sk-...` key）；可选 OpenRouter（余额）
- [ ] 至少 1 个 OpenAI/Anthropic 兼容 key 作为非账单 provider 验证「不支持时不显示 footer」

---

## A. 预设供应商

### A1. 弹窗与入口
- [ ] 主页点「+」按钮 → 弹出 `PresetPickerModal`，含 15 条预设
- [ ] 搜索框输入「dee」/「kimi」/「glm」→ 实时过滤
- [ ] 排序切换「原始 / A-Z」→ 顺序变化
- [ ] 分类徽章配色：官方蓝 / 国产绿 / 第三方灰 / 聚合紫
- [ ] 底部「+ 自定义配置」按钮 → 关闭弹窗，走原空表单流（生成 `provider-N`）
- [ ] Esc 键关闭弹窗
- [ ] 点击遮罩关闭弹窗
- [ ] 弹窗打开时背景滚动被锁

### A2. 选中预设
- [ ] 选 kimi-coding → 卡片写入「kimi-coding」provider + `kimi-for-coding`、`kimi-k2.7-code` 模型，第一个设为 `default_model`
- [ ] provider 写入 `provider_type=kimi`，`base_url=https://api.kimi.com/coding/v1`，`api_key=null`
- [ ] usageKinds 持久化到 SQLite（验证方式：保存后重启 app，Kimi Coding 卡片底部仍出现账单区）
- [ ] 选 anthropic → `base_url` 为空（不写默认值）
- [ ] 选 google-genai → `provider_type=google-genai`，`base_url=https://generativelanguage.googleapis.com`
- [ ] 选 moonshot → `provider_type=kimi`，`base_url=https://api.moonshot.ai/v1`（Kimi 平台 API，按量付费）
- [ ] 选 zai → `provider_type=openai`，`base_url=https://api.z.ai/api/paas/v4`
- [ ] 选 volcengine → `provider_type=openai`，`base_url=https://ark.cn-beijing.volces.com/api/v3`，**无** usageKinds
- [ ] 选 bailian → 无 usageKinds（不显示账单区）

### A3. 冲突处理
- [ ] 已存在 `deepseek` provider → 选 deepseek preset 再次 → 新 provider 命名为 `deepseek-2`，模型 alias 全部带 `-2`
- [ ] 同 provider 内 alias 冲突 → 尾追加 `-2`/`-3`
- [ ] 切换不同预设（含同名模型 id）→ alias 强制 `${name}/${modelId}` 形式（**不**允许裸 alias）

### A4. 预填字段展示
- [ ] 选完预设后自动跳到 `ProviderEdit` 页
- [ ] `api_key` 留空、其它字段已预填
- [ ] 填入真实 key → Ctrl+S 保存
- [ ] 返回列表 → 新 provider 卡片可见，可点「使用中」/「切换使用」按钮激活

### A5. config.toml 污染检查
- [ ] 保存后打开 `%USERPROFILE%/.kimi-code/config.toml` → **不**含 `usageKinds` 字段
- [ ] 修改 provider 的 `base_url` 触发保存 → config.toml 仍是新 `base_url`，**无** `usage_kinds` 键

### A6. 旧数据迁移
- [ ] 用 v0.5.2 之前的 config（含裸 alias 如 `kimi-k3`、`glm-5-2-1`）启动 → app 正常加载
- [ ] 触发「复制 provider」→ 新 provider 的 alias 重命名正确（**不**再出现 `kimi-coding-k3` 这种缺 `/` 的形式）

---

## B. 供应商账单查询

### B1. 不支持时不渲染
- [ ] Moonshot / Bailian / OpenAI / Google / Anthropic 卡片底部**无** UsageFooter
- [ ] 自定义空表单（`provider-N`）卡片底部**无** UsageFooter
- [ ] 后端 `query_provider_usage` 不会为这些 provider 触发

### B2. 支持时自动查询
- [ ] 选 kimi-coding 预设、填 key、保存 → 卡片底部出现「⚡ N% 已使用 · 5h 后重置」
- [ ] 选 deepseek 预设、填 key、保存 → 卡片底部出现「💰 余额 ¥X.XX」
- [ ] 首次进入 ProviderList → 卡片并发查询，最多 3 个同时（DevTools network 可见）
- [ ] 单个 provider 查询超过 8 秒 → 卡片显示「网络异常 · 重试」，**不**阻塞其他 provider

### B3. 5min 缓存
- [ ] 查询成功后 5 分钟内重进 ProviderList → 不再发新请求（DevTools network 确认）
- [ ] 缓存过期后重进 → 自动重新查询（先 ghost 旧数据再后台拉新）
- [ ] 进程重启后 → 缓存清空（Rust 端内存 + 前端 module Map 都丢），首次进列表重新查

### B4. 手动刷新
- [ ] 点卡片底部「刷新」图标 → 跳过缓存直接查
- [ ] 刷新按钮 click 不会触发卡片「进入编辑」onClick（stopPropagation 验证）
- [ ] 刷新中按钮变转圈、禁用防重入

### B5. 错误处理
- [ ] api_key 为空 → 卡片显示「API Key 无效」红字 + 重试按钮
- [ ] api_key 错误（401）→ 卡片显示「API Key 无效」
- [ ] 网络断开 / DNS 失败 → 卡片显示「网络异常」 + 重试按钮
- [ ] 提供商返回非预期 JSON → 卡片显示「查询失败 · <错误文本>」
- [ ] 错误状态保留旧数据作 ghost（半透明）+ 缓存仍写入错误 entry，TTL 内不重发

### B6. 多 kind 渲染
- [ ] Kimi For Coding 有两层（`five_hour` + `weekly_limit`）→ 两行独立显示，前缀 `five_hour · ` / `weekly_limit · `
- [ ] 套餐行配色：< 70% 已用 绿 / 70-89 橙 / ≥ 90 红
- [ ] 倒计时：> 24h `Nd` / < 24h `Nh` / < 1h `Nm`；已过期显示「已重置」
- [ ] 余额行：CNY→¥ / USD→$ / 其他原样
- [ ] 同一 provider 同时有套餐 + 余额（v1 不存在这种组合，但 detect 启发式已支持）→ 两行都显示

### B7. SQLite 持久化
- [ ] 保存预设后查 SQLite `settings` 表 → 存在 `usage_kinds:kimi-coding` 键，值为 `["plan:kimi_coding"]`
- [ ] 删除 provider → 下次 save 时对应 key 被删（避免脏数据）
- [ ] 卸载 app → 卸载时同步删除（验证方式：卸载后 `%USERPROFILE%/.kimi-code/` 不残留 `kimi-switch.db`）

### B8. 真实 API 验证（**需真实 key**，按用户实有 key 勾选）
- [ ] DeepSeek `user/balance` → 返回 CNY 余额
- [ ] Kimi For Coding `coding/v1/usages` → 返回 `five_hour` + `weekly_limit` 两层
- [ ] OpenRouter `credits` → 返回 USD 余额
- [ ] SiliconFlow `user/info` → 返回余额
- [ ] StepFun `accounts` → 返回余额（已加在 P0 实施中，但任务里程碑归 P1）
- [ ] Novita `user/balance` → 注意 `/10000` 单位换算
- [ ] Zhipu `glm/bigmodel` 套餐 → 返回百分比 + 重置时间
- [ ] MiniMax 套餐 → 返回周桶用量

### B9. 跨 agent 隔离
- [ ] KimiCode 与 Pi（虽然 UI 屏蔽）同名 provider 各自独立缓存不串

---

## C. 核心旧功能回归（v0.6.0 没动但要确认没破）

- [ ] 切换使用按钮：点「使用中」→ 卡片高亮 + config.toml 写入 + `/reload` 提示
- [ ] 复制 provider：alias 重命名正确（包括老数据非规范 alias）
- [ ] 删除 provider：关联模型一并删除
- [ ] 编辑 provider：改名后关联模型 `m.provider` 同步更新
- [ ] 测速按钮：弹气泡，6 秒后自动消失
- [ ] 拉取模型：填入 base_url + key → 拉到的模型自动建 alias，max_context 走 models.dev
- [ ] 设置面板：主题切换、语言切换、检查更新、打开配置目录
- [ ] 检查更新：启动时静默 + 8 小时一次
- [ ] 用量仪表盘：模型用量趋势 / 供应商模型用量趋势 双 Tab、热力图、会话管理
- [ ] 关闭按钮（X）隐藏到托盘
- [ ] Ctrl+S / Ctrl+R / Ctrl+O 快捷键

---

## D. 构建与发布

- [ ] `npx tsc --noEmit` 0 error
- [ ] `cd src-tauri && cargo check` 0 error
- [ ] `cd src-tauri && cargo test` 全过（当前 26 用例）
- [ ] `npm run tauri-build` MSI 产物 `src-tauri/target/release/bundle/msi/Kimi Switch_<version>_x64_en-US.msi`
- [ ] MSI 静默安装后启动正常、config 迁移正常
- [ ] 启动空白超时 5 秒有橙色提示

---

## E. 已知不验证项（设计层面注定做不到）

- ⚪ Volcengine 套餐查询（v1 不支持，需独立 AK/SK，留 P2）
- ⚪ ZenMux（v1 不做）
- ⚪ `ProviderEdit` 顶部「切换预设」下拉（P2）
- ⚪ 仪表盘 KPI「供应商侧配额」卡（P3）
- ⚪ `/reload` 不会自动套用新 `default_model`（Kimi Code 上游限制，详见 README「已知限制」段）
- ⚪ 切换预设后自动激活新 provider（产品决策未定）

---

*完成所有 ✓ 后再发版。任意一条 ✗ 都需定位并修复后重测。*
