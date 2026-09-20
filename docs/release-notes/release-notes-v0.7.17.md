# KimiSwitch v0.7.17

## 新增

- **账单查询适配 Sub2API 中转站（`balance:sub2api`）**：支持 Wei-Shaw/sub2api 面板的余额/额度查询（`GET {base}/v1/usage`），自动复用推理 `sk-` API Key，**无需**网页后台 Access Token；解析三种模式——单 Key 总额度（quota）、5 小时/每日/7 天速率窗口（含重置倒计时）、订阅组日/周/月额度与钱包余额（USD）
  - 用量配置面板新增「Sub2API 中转站」模板，可选覆盖查询地址（Base URL）
  - `detect_provider` 家族规则拆分：`codingplan.site` 主域识别为 Sub2API，`ai.codingplan.site` 识别为 NewAPI（修正此前主域被误判为 NewAPI 导致查询 404 的问题）
- **模型映射「获取模型列表」新增批量选择**：发现列表标题右侧新增「全选 / 取消全选 / 反选」三个按钮，配合已有的已添加标记与「添加选中的」，批量接入中转站模型列表更省事

## 修复

- 修复 `codingplan.site`（Sub2API 面板）走 NewAPI 模板查询必然失败的问题——NewAPI 模板（Access Token + User ID）仍适用于 NewAPI / OneAPI 站点，两者互不影响

## 备注

- Sub2API 查询的金额单位由上游硬编码为 USD；速率窗口标签沿用现有本地化（5 小时 / 每日 / 7 天）
