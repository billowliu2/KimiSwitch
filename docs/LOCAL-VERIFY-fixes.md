# 本地验证清单 — 配置一致性修复（待发 v0.8.3）

构建版本：0.8.2（含未提交改动）。自动化测试已全绿（前端 146 / Rust 197），
以下是**必须人工验证**的场景，重点是引擎侧对配置结构的实际反应。

验证前备份：`~/.kimi-code/config.toml`、`~/.kimi-switch/kimi-switch.db`

---

## 0. 前置：确认基线干净

- [ ] 打开 `~/.kimi-code/config.toml`，搜索 `opencode-go-copy` / `opencode-go-1` → 应为 0 命中
- [ ] KimiSwitch 供应商列表中 `opencode-go` 正常显示，模型 3 条（longcat / mimo / step-5）
- [ ] 高级设置 → 子代理模型池中 3 条 opencode-go 条目都在
- [ ] kimi-code 会话能正常启动（`kimi` 命令），确认 `default_model` 生效

---

## 1. 复制供应商（本次修复的严重回归点）

- [ ] 供应商列表 → `opencode-go` 点「复制」
- [ ] **源供应商 `opencode-go` 的 3 个模型仍在**（这是关键：旧实现会清空）
- [ ] 副本 `opencode-go-copy` 也有 3 个模型，别名带 `-copy` 前缀
- [ ] 副本默认状态为「未启用 / 未使用中」
- [ ] 点返回 → 弹出未保存确认 → 选「放弃」→ **列表里副本消失**（验证防呆：放弃不落盘）
- [ ] 重新复制 → Ctrl+S 保存 → 重启应用 → 副本仍在（验证保存生效）
- [ ] 删除副本 → Ctrl+S → 重启 → 副本消失，`opencode-go` 完好

## 2. 供应商改名（僵尸别名根源）

- [ ] 编辑 `opencode-go-copy` → 名称改为 `opencode-renamed` → 保存 → 返回
- [ ] `config.toml` 中该供应商的模型别名变为 `opencode-renamed/*`，**无 `opencode-go-copy/*` 残留**
- [ ] 全局默认模型、该供应商记住的默认模型都指向新别名
- [ ] 子代理池中若有副本的条目，键同步变为新别名（描述保留）
- [ ] kimi-code 会话能启动，默认模型正确

## 3. 删除供应商（关联清理）

- [ ] 先把某个模型加入子代理池，并设为池默认
- [ ] 删除该供应商 → Ctrl+S → 打开 `config.toml` 检查：
  - [ ] 该供应商的 `[models.*]` 段落全部消失
  - [ ] `[secondary_model.models]` 中引用它的条目已消失
  - [ ] 池 `default_model` / `model` 已回落到剩余条目（不是悬空）
  - [ ] 池被清空时整个 `[secondary_model]` 节消失
  - [ ] `default_model` 若指向被删模型则为 `""` 或不再指向它
  - [ ] **kimi-code 会话能正常启动**（重点：验证引擎对 `default_model = ""` 的容忍度）
- [ ] SQLite 检查：`~/.kimi-switch/kimi-switch.db` 的 `settings` 表中
      `usage_kinds:<该供应商名>` / `usage_config:<该供应商名>` 行已删除
- [ ] 无关的 settings 行（如 `app.language`）未受影响

## 4. 删除单个模型

- [ ] 把某模型加入子代理池 → 编辑该供应商 → 删除该模型 → 保存
- [ ] `config.toml` 中 `[secondary_model.models]` 对应条目消失
- [ ] 池默认为被删模型时已回落到其他条目

## 5. 防呆：放弃修改不落盘

- [ ] 编辑供应商改名 → 点返回 → 选「放弃」→ 重新打开：名称为旧名，**config.toml 未变**
- [ ] 删除模型 → 点返回 → 放弃 → 重新打开：模型仍在
- [ ] 复制供应商 → 放弃 → 副本消失
- [ ] 任何改动后不点保存就关闭应用 → 重启后配置不变

## 6. Pi agent 不受牵连

- [ ] 切到 Pi agent 面板，确认其供应商与用量查询配置正常
- [ ] 切回 KimiCode 保存一次 → 再看 Pi 的用量查询设置，应仍在
- [ ] 检查 SQLite `settings` 表：Pi 供应商的 `usage_*` 行未被误删

## 7. 防呆：改名冲突

- [ ] 存在 `opencode-go` 和 `opencode-go-copy` 时，把后者改名为 `opencode-go` 并保存
- [ ] 结果：两个供应商条目与各自模型都保留，冲突方别名带 `-2` 后缀，**无静默丢模型**

---

## 已知遗留（不属于本次范围）

- config.toml 中若存在 provider 已删除的僵尸 `[models.*]` 段落，应用不会自动删除
  （用户权威文件，只防复发），需手动清理一次
- `default_model = ""` 时 kimi-code CLI 的确切回退行为，建议实测确认