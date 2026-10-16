# 提案：设置改为全局页面（设置 + 高级功能 合一）

状态：**待评审**（本文档为主代理自查 + 交叉审核用，未开始实现）
日期：2026-10-15

---

## 1. 目标

取消「设置」弹窗，改为带返回按钮的全局页面；三个 Tab 从同一入口打开同一页面（顺序 **全局设置 | 高级设置 | 关于**）：

- **全局设置 Tab**：全局默认模型 / 供应商级别的默认项
- **高级设置 Tab**（原「高级设置」页内容 + 代理设置）：代理设置（thinking/循环控制/权限规则/hooks 等）、Kimi Code WebUI 快速打开、models.dev 模型数据、子代理副模型/模型池、实验开关
- **关于 Tab**（id 仍为 `general`，原 `SettingsModal` 内容）：外观（主题/语言）、更新（版本/检查/下载/安装）、Kimi Code CLI 版本与兼容性、关于

已确认的三个决策点：

| 决策 | 选择 | 含义 |
| --- | --- | --- |
| A | 1 | `AgentSettingsPanel` 从供应商编辑页（`ProviderEdit.tsx`）**移除**，只保留在设置页高级 Tab —— 单一入口 |
| B | 2 | **保留**旧 `view === "subagent"` 渲染分支作为兼容外壳，不删除 |
| C | 1 | 所有 section **抽成独立可复用组件**，不复制内容，避免两处分叉 |

## 2. 现状核实（已完成调研，行号为当前 main 上的位置）

| 文件 | 关键事实 |
| --- | --- |
| `src/App.tsx:83-85` | `view` 类型：`"list" \| "edit" \| "subagent" \| "dashboard" \| "sessions" \| "plugins"`，需新增 `"settings"` |
| `src/App.tsx:89` | `showSettings` state（改造后删除） |
| `src/App.tsx:600-638` | 顶部导航（供应商/数据看板/会话），**无 dirty 拦截**，直接 `setView` |
| `src/App.tsx:652-665` | 齿轮按钮 → `setShowSettings(true)`；含「有更新」绿点徽标（保留） |
| `src/App.tsx:682-696` | 渲染分支：`subagent` → `<SubagentSettingsPage>`（保留，即决策 B） |
| `src/App.tsx:697-724` | `ProviderEdit` 入参含 `rawOther` / `onRawOtherChange` / `defaultModel` |
| `src/App.tsx:906-914` | footer「高级设置」按钮（仅 `view === "list"` 显示）→ `setView("subagent")`，改为打开设置页高级 Tab |
| `src/App.tsx:919-926` | `<SettingsModal>` 挂载（改造后删除） |
| `src/components/SettingsModal.tsx`（589 行） | 4 个 section：外观 `:257`、更新 `:302`、Kimi Code `:434`、关于 `:500`；弹窗专属：`createPortal`、`fixed inset-0` 蒙层、Esc 关闭、`body.overflow` 锁定；`handleDownload`（`:103-130`）含「无安装包 → 打开 release 页」回退（**近期 bug 修复，必须逐字保留**）；全仓库仅 `App.tsx` 引用 |
| `src/components/SubagentSettingsPage.tsx`（710 行） | props `{ rawOther, models, onChange, onBack }`；返回头 `:402-414`，内容区 `:416-707`（masterOn 提示条 + WebUI Card + models.dev Card + 副模型/模型池 Card + 实验开关 Card）；仅 `App.tsx` 引用 |
| `src/components/AgentSettingsPanel.tsx`（451 行） | props `{ rawOther, onChange, models?, defaultModel? }`；读写全局 `config.raw_other`；自带 `mt-6` 外壳和 `agentSettings` 小标题，页面内可直接复用，**该文件本身不改**；目前唯一挂载点 `ProviderEdit.tsx:478-484`（`agent === "kimi_code"` 时） |
| `src/i18n/zh.ts` / `en.ts` | 已有：`settings`、`settingsTitle`、`settingsAppearance`、`settingsUpdates`、`settingsAbout`、`subagentSettings`、`back`；三个 Tab 直接复用 `settingsTabGlobal` / `subagentSettings` / `settingsAbout` |

数据流结论（合并无数据层改动）：`AgentSettingsPanel`、`SubagentSettingsPage` 都只读写全局 `config.raw_other`，`App.tsx` 已有现成回调 `onRawOtherChange={(next) => updateConfig((cfg) => ({ ...cfg, raw_other: next }))}`（`App.tsx:722-724`）。

## 3. 目标结构

```
src/components/settings/
├── SettingsPage.tsx          新增：返回头 + Tab 切换 + 内容容器（本次唯一的"页面"）
├── SettingsGeneralTab.tsx    新增：SettingsModal 的 4 个 section，去掉弹窗外壳
└── SettingsAdvancedTab.tsx   新增：AgentSettingsPanel + SubagentSettingsPage 内容区，去掉返回头

src/components/
├── SettingsModal.tsx         删除（仅 App.tsx 引用，一并摘除）
└── SubagentSettingsPage.tsx  改为薄壳：返回头 + <SettingsAdvancedTab>（决策 B 的兼容入口）
```

### 3.1 组件接口契约

```tsx
// SettingsGeneralTab.tsx —— 自包含（主题/语言/版本/下载状态都内置）
interface SettingsGeneralTabProps {
  updateInfo: UpdateInfo | null;
  checking: boolean;
  onCheckUpdate: () => void;
  lastChecked: number | null;
}

// SettingsAdvancedTab.tsx —— 纯内容，无返回头
interface SettingsAdvancedTabProps {
  rawOther: unknown;
  models: Record<string, Model>;
  defaultModel: string | null;          // 供 AgentSettingsPanel 判断 effort 支持
  onChange: (nextRawOther: unknown) => void;
}

// SettingsPage.tsx
// 返回头与 SubagentSettingsPage 同款：`← {t("back")}` + 标题 `t("settingsTitle")`（"设置"）
interface SettingsPageProps {
  // Tab 受控（不用 initialTab + 内部 state）——齿轮按钮在 header 常驻，
  // 停留在设置页时再点齿轮，必须能切回第一个 Tab（全局设置）；非受控则 prop 变化不生效。
  activeTab: "global" | "advanced" | "general";
  onTabChange: (tab: "global" | "advanced" | "general") => void;
  onBack: () => void;
  // 透传给三个 Tab：
  updateInfo / checking / onCheckUpdate / lastChecked
  rawOther / models / defaultModel / onRawOtherChange
}
```

### 3.2 Tab 挂载策略（审核补充的关键点）

原 `SettingsModal` **常驻挂载**（`open=false` 时返回 null 但 hooks 仍在跑），下载进度监听、`downloadedPath` 状态在弹窗开关间不丢失。改造后若用条件渲染 `{tab === "general" && ...}`，下载进行中切到高级 Tab（或按返回离开页面）会丢失 `downloadedPath`，「安装」按钮消失——这是行为回归。

**方案：三个 Tab 面板都常驻挂载，非激活 Tab 用 `className="hidden"` 隐藏。** 代价仅是高级 Tab 提前挂载（一次 `getAgentSettings` IPC 读，无副作用），换来下载状态与滚动位置不丢。

## 4. App.tsx 接线

1. `view` 类型加 `"settings"`；删除 `showSettings` state 与 `<SettingsModal>` 挂载、import；删除 `SettingsModal.tsx`。
2. 新增 `settingsTab` state（`"global" | "advanced" | "general"`）。
3. 齿轮按钮（`App.tsx:670`）→ `setSettingsTab("global"); setView("settings")`（第一个 Tab 即全局设置）；绿点徽标保留。
4. header「高级设置」按钮 → `setSettingsTab("advanced"); setView("settings")`，文案键不变。
5. 渲染分支加（Tab 受控，state 放 App）：
   ```tsx
   ) : view === "settings" ? (
     <SettingsPage
       activeTab={settingsTab}
       onTabChange={setSettingsTab}
       onBack={() => setView("list")}
       updateInfo={updateInfo} checking={checking} onCheckUpdate={checkNow} lastChecked={lastChecked}
       rawOther={config.raw_other} models={config.models} defaultModel={config.default_model}
       onRawOtherChange={(next) => updateConfig((cfg) => ({ ...cfg, raw_other: next }))}
     />
   ```
6. 兼容分支（决策 B）：`view === "subagent"` 保留，仅多传 `defaultModel={config.default_model}`（`SubagentSettingsPage` 新增可选 prop）。此后 UI 上无入口指向它，代码保留。

## 5. ProviderEdit.tsx 摘除（决策 A）

- 删除 `AgentSettingsPanel` 挂载块（`:477-484`）与 import（`:16`）。
- 连锁清理（`noUnusedLocals` / `noUnusedParameters` 开启，tsc 会逼出来）：`rawOther` / `onRawOtherChange` 两个 props 若无其他使用则从 `ProviderEditProps`（`:93` 附近）和 `App.tsx:721-724` 调用处一并删除；`modelsByAlias` 等仅为其存在的中间变量同步清理。以 `npx tsc --noEmit` 零错误为准。

## 6. i18n

三个 Tab 文案键（zh / en）：

| key | zh | en |
| --- | --- | --- |
| `settingsTabGlobal` | 全局设置 | Global Settings |
| `subagentSettings` | 高级设置 | Advanced Settings |
| `settingsAbout` | 关于 | About |

不新增其他 key；`SubagentSettingsPage` 薄壳继续复用 `subagentSettings` / `back`。

## 7. 行为差异清单（有意为之，评审确认）

| # | 差异 | 说明 |
| --- | --- | --- |
| 1 | Esc 不再关闭设置 | 弹窗行为；页面用「← 返回」。如需保留可加，默认不加 |
| 2 | 设置不再遮挡底层界面 | 弹窗 → 页面，符合本次需求本意 |
| 3 | footer 出现在设置页 | footer 显示条件不含 `settings`，保存/重载按钮仍可用（高级 Tab 改 `raw_other` 会标 dirty，**能在页内直接保存**，是改善而非回归） |
| 4 | 顶部导航「供应商」高亮条件 | `list/edit/subagent` 高亮（`App.tsx:604`），`settings` 不加入高亮，返回后仍正确 |
| 5 | 齿轮/高级按钮进入设置页**不做 dirty 拦截** | 与现有 header 导航（数据看板/会话）一致；配置在内存中不丢失 |
| 6 | 停留在设置页时再点齿轮 | 切回第一个 Tab（全局设置），受控 Tab 保证 prop 变化生效，见 3.1 |
| 7 | footer 按钮文案 | 与高级设置 Tab 共用 `subagentSettings`（高级设置），文案一致 |

## 8. 不做的事（边界）

- 不动 dashboard / sessions / plugins 页面，不动 Rust 侧任何代码。
- 不改 `AgentSettingsPanel.tsx` 内部（含 `mt-6` 外壳与「代理设置」小标题，在高级 Tab 中观感正常）；高级 Tab 不再按 `agent === "kimi_code"` 判断——当前仅支持 kimi_code（`getInitialAgent` 恒返回 `"kimi_code"`），判断无意义。
- Tab 选择不持久化到 localStorage：每次进入按入口决定初始 Tab（齿轮 → 全局设置，header「高级设置」→ 高级设置）。
- 不新增组件测试：项目测试先例仅覆盖 `src/lib` / `src/hooks`，无组件测试；本次跟随先例。
- `SettingsGeneralTab` 只在设置页打开时挂载（原弹窗常驻挂载）——下载监听只能由设置页内的按钮发起，无实际影响。
- 工作区里已有的未提交改动（更新下载修复、OpenTerminal 链接、models-dev 数据）与本提案无关，实现时**不混入**，分开提交。

## 9. 实施步骤（依赖顺序）

1. **并行抽取**（两个子代理，文件不相交）：
   a. `SettingsGeneralTab.tsx`（含下载回退修复逐字保留）
   b. `SettingsAdvancedTab.tsx` + `SubagentSettingsPage.tsx` 改薄壳
2. **接线**（主代理）：`SettingsPage.tsx` + `App.tsx` + `ProviderEdit.tsx` + i18n 两键 + 删除 `SettingsModal.tsx`。
3. **验证**：`npx tsc --noEmit` 零错误 → `npm test`（150 例基线）→ `cargo test`（应无影响，跑一遍确认 208 例基线）。
4. **dev 实测**（注意先 `taskkill` 关正式版，单实例锁冲突）：见 10。

## 10. 验收标准

**自动化**：`npx tsc --noEmit` 零错误；`npm test` 全绿；`cargo test` 全绿。

**手动清单**（`npm run tauri-dev`）：

- [ ] 齿轮 → 打开设置页，初始停在「全局设置」Tab，四个 section（外观/更新/KimiCode/关于）在「关于」Tab 中原弹窗内容一致（含 OpenTerminal 链接）
- [ ] header「高级设置」→ 同一页面，初始停在「高级设置」Tab，含代理设置 + 原 4 个 Card
- [ ] 「← 返回」回到供应商列表
- [ ] 供应商编辑页模型 Tab **不再出现**代理设置区块
- [ ] 高级 Tab 改动（如实验开关）→ footer 出现未保存标记 → 可在页内保存 → 配置文件落盘正确
- [ ] 检查更新 / 下载 / 安装流程可用；下载中切到高级 Tab 再切回，进度与「安装」按钮不丢
- [ ] 主题、语言切换即时生效
- [ ] 有新版本时齿轮绿点徽标仍显示
- [ ] 停留在设置页时再点齿轮 → 切回第一个 Tab（全局设置）
- [ ] header「高级设置」按钮文案与高级设置 Tab 名一致

## 11. 风险与回退

| 风险 | 缓解 |
| --- | --- |
| 抽取时漏搬/改错下载回退逻辑 | 验收清单专项覆盖；diff 逐行 review |
| 高级 Tab 提前挂载引发意外 IPC | 仅一次只读 `getAgentSettings`，无写操作 |
| `ProviderEdit` props 清理波及其他用法 | 已核实 `rawOther` 仅 `AgentSettingsPanel` 消费，tsc 兜底 |
| 回退 | 单独 commit，`git revert` 即可整体回退，不碰数据格式 |
