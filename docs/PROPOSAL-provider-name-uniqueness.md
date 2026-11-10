# 提案：供应商名称唯一性校验（防同名静默覆盖）

> **状态**：v2.1-implemented（已实施，待人工 GUI 验收）
> **作者**：Kimi Switch 内部
> **目标版本**：待定（建议下一补丁版本）
> **触发事件**：2026-10-16 用户在 TokenHub 上配置第二把 Key 后，第一个供应商条目静默丢失
>
> **修订记录**：
> - **v2.2（对抗性审查后加固，当前版）**：六项修复——① 4.7 暂存由单槽改多槽 `Map`（连续两次撞名不再丢弃前一个受害者）；② 用量弹窗的 silent save 复用同一套硬阻止闸门（原可绕过 trySave 把污染配置落盘）；③ `refresh` 返回成功标志，`reloadFromDisk` 仅在重载成功时清暂存（原失败也无条件清空）；④ 保存闸门新增 trim 级重名扫描 `findTrimDuplicateProviderNames`（`"TokenHub "` 原可经 Ctrl+S 落盘）；⑤ map 存在性判断 `in` 统一改 `Object.hasOwn`（`constructor` 等原型键会幽灵命中）；⑥ 撞名未还原时顶栏导航拦截（纵深防御，普通 dirty 导航不受影响）。
> - **v2.1（执行前修订 + 实施补强）**：① 4.7 由「冲突标志（离开撞名态即清除）」修订为「置换暂存 + 自动还原」——v2 原稿在用户改名离开撞名态后会放行保存，但被置换条目已在内存灭失，丢失仍会落盘；② 实施期补强：暂存清理统一为 `reloadFromDisk` 包装函数（覆盖全部从磁盘重载的调用点）、完全同名撞名经 `nameConflict` prop 补齐展示层红框（4.2）、空名列表以 `JSON.stringify` 渲染避免 `{names}` 空串。
> - **v2**：核实确认 v1 存在两处设计缺陷并修正——① 4.3 的「名称互撞扫描」为死代码（`IndexMap`/JS 对象键结构上不可重复，覆盖在写入瞬间完成，事后扫描永远只有一个键）；② Ctrl+S 为 window 级监听（`App.tsx:193-219`），绕过任何 disabled 按钮。v2 将 4.3 改为「空名扫描 + 冲突标志」，新增 4.7 冲突标志机制，4.2 明确实时校验仅为展示层；测试计划补 Ctrl+S 回归与丢弃还原因例；附录 A 增补两条警告；新增决策点 D6；第六节补记唯一绕行落盘路径。
> - v1：初稿。

---

## 一、背景与事故还原

### 1.1 用户场景

同一厂商（TokenHub，`base_url = https://tokenhub.sbs/`，anthropic 类型）有两把 API Key，希望配置成两个供应商条目分别使用。用户采用「新建」方式配置第二个，保存后发现第一个条目消失。

### 1.2 证据链（来自本机 `~/.kimi-code/backups/` 全量 58 份备份与 config.toml）

| 时间 | 状态 |
|---|---|
| 10-10 ~ 10-16 13:18 全部 58 份备份 | 一直存在 `[providers.TokenHub]`（Key 前缀 `sk-EGnYXU...`），`TokenHub-2` 从未出现过 |
| **10-16 13:18:35.137** | 唯一一次换名写入：备份记录旧状态后，config.toml 被整体重写为只含 `[providers.TokenHub-2]`（Key 前缀 `sk-RxTtns...`，即第二把 Key）；config.toml mtime 与最后一次备份时间戳精确吻合 |
| 现状 | 第一把 Key 只存在于备份中，不在 config.toml |

两条目的 `base_url`、`type` 完全相同，仅 Key 不同 —— **存储格式本身完全支持并存**，丢失是应用层行为。

### 1.3 第一把 Key 的恢复路径（见附录 A）

---

## 二、根因分析

### 2.1 数据模型：名称即主键

- 前端与 Rust 的 `Config.providers` 均为 `IndexMap<String, Provider>`（`src-tauri/src/models.rs:243`），**以供应商名称为唯一 key**。
- 导出到 kimi-code config.toml 时按名称写小节（`src-tauri/src/kimi_code_io.rs:375`）：`[providers.TokenHub]`、`[providers.TokenHub-2]` 各自独立。
- **全库检索确认：不存在任何按 `base_url` 合并/去重的逻辑**（仅 `PartialEq` 与 OAuth host 判断）。同地址不同名的条目天然并存，与用户预期一致。
- **推论（v2 核实）**：由于键在结构上不可重复，**撞名的数据丢失发生在前端写入瞬间**（`providers[provider.name] = provider` 替换旧值），任何"事后扫描找重复键"的校验都不可能命中——这决定了兜底必须依赖写入点的冲突标志（4.7），而非保存时扫描。

结论：**名称是唯一身份标识，但没有任何一层强制它的唯一性** —— 撞名即在写入瞬间静默覆盖。

### 2.2 四个无校验写入点

| # | 位置 | 问题 |
|---|---|---|
| 1 | `src/App.tsx` `handleUpdateProvider`（实施前 :289-325） | 编辑中把名称改成已有名称 → `providers[provider.name] = provider` 直接覆盖旧条目，无提示。名称输入框每敲一键即触发（`src/components/ProviderEdit.tsx` 名称输入） |
| 2 | `src/App.tsx` `handleApplyProviderJson`（实施前 :508-515） | 「配置 JSON」页应用时，目标名称撞已有厂商 → 同样直接覆盖 |
| 3 | `src/App.tsx` `handleAddCustomProvider`（实施前 :231） | 新建自定义起名 `provider-${数量+1}`，删除过条目后号码可回退撞名，覆盖发生在用户输入任何内容之前 |
| 4 | `src/lib/validation.ts` `validateProviders` | 保存校验只查「缺 Key / 缺 base_url / 缺模型」，**不查名称重复与名称为空** |

### 2.3 落盘路径全量枚举（v2 新增，Grep 核实）

| 调用点 | 实施前位置 | 说明 |
|---|---|---|
| `trySave` 内部 `await save()` | `App.tsx:183` | 唯一的常规落盘汇聚点 |
| Ctrl+S 快捷键 → `trySave()` | `App.tsx:200` | **window 级监听（:217），绕过任何 disabled 按钮** |
| 切换供应商 → `trySave(name)` | `App.tsx:467` | 落盘整份配置 |
| 底部保存按钮 → `trySave()` | `App.tsx:901` | 同 Ctrl+S |
| `handleSaveUsageConfig` → `save({silent:true})` | `App.tsx:370` | **唯一绕过 trySave 的路径**（分析见第六节） |

### 2.4 复制流程的边界

`handleDuplicateProvider`（实施前 `App.tsx:373-400`）本身安全：起名走 `-copy` / `-copy-2` 防撞循环，模型别名复制走 `copyModelsOnProviderDuplicate`（`src/lib/providerRename.ts:61`）自动去重。toast 文案硬编码问题见 4.8。

但**复制后的编辑改名**汇入写入点 #1，且后果更脏：改名分支里 `rekeyModelsOnProviderRename` 会把副本模型 rekey 成 `TokenHub/xxx`，与原厂商家模型撞名后变 `TokenHub/xxx-2` —— 幸存厂商同时挂着两套模型映射，原厂商的模型条目混入幸存者名下。

### 2.5 事故路径复原（与「新建」操作吻合）

新建自定义 → 得到占位名 `provider-N` → 用户在名称框输入 `TokenHub`（瞬间在内存中覆盖原厂商家，无任何提示）→ 填第二把 Key → （改名为 `TokenHub-2` 或直接）保存 → 单次落盘即成事故现场。中间撞名状态从不落盘、从不告警，用户全程无感知。

---

## 三、方案总则

1. **唯一性以「供应商名称」为准**，与 base_url、厂商、类型无关（与用户确认的设计原则）。
2. **撞名 = 硬阻止**，不可弹窗确认后强行保存 —— 落盘即数据丢失，不存在"用户自担风险"的合理场景。
3. **前端多层拦截 + 汇聚点兜底**；Rust 层零改动（`IndexMap` 结构上存不住重复 key，丢失发生在前端内存合并瞬间，Rust 侧无法也无需防御）。
4. **所有硬阻止必须落在写入点与 `trySave` 本身**：Ctrl+S 是 window 级监听，按钮 disabled、红框提示等 UI 态一概不承担数据安全职责。
5. 不做数据迁移、不自动改动用户现有条目（包括幸存的 `TokenHub-2`）。

---

## 四、实施细节（已实施）

### 4.1 共享校验函数（`src/lib/validation.ts`）✅

```ts
export type ProviderNameIssue = "empty" | "duplicate";

export function validateProviderName(
  allNames: string[],        // 除当前编辑条目外的全部厂商名
  name: string,              // 待校验名称
): ProviderNameIssue | null;
```

- 比较规则：`trim()` 后**全等**（大小写敏感，见决策点 D1）；空名优先判 `empty`。
- 用于 4.2（展示层提示）；**不用于 4.3**（保存时地图里已无重复可扫，见 2.1 推论）。
- 单测 `src/lib/validation.test.ts` 7 用例（vitest）。

### 4.2 编辑页实时校验（`src/components/ProviderEdit.tsx`）✅【v2.1 补强】

- 新增 props：`allProviderNames: string[]`（App 传入，排除当前编辑条目）与 `nameConflict?: boolean`。
- `nameError = validateProviderName(allProviderNames, provider.name) != null || nameConflict === true` → 名称输入框红框 + 框下红字（`validationNameEmpty` / `validationNameDuplicate`）、保存按钮 `disabled`。
- **v2.1 补强原因**：完全同名撞名（本事故场景）下，`editingProvider` 逐键跟随新名，`allProviderNames` 排除当前条目后看不到冲突；由 App 传 `nameConflict={displacedRef.current.has(editingProvider)}` 补齐（ref 在 updateConfig 更新器内、重渲染前已变更，渲染读到最新值）。**v2.2**：暂存改多槽后必须按 `editingProvider` 命中判断，不能再用「暂存非空」，否则 A 处撞名会让无关的 B 编辑页也亮红框。
- **定位说明**：实时校验与按钮禁用是**展示层**，只负责让用户就地看到问题；真正的强制闸门在 4.3（trySave）与 4.5/4.7（写入点）。原因：Ctrl+S 绕过按钮态；且名称输入每敲一键即写入内存配置，红框出现时内存覆盖已经发生。

### 4.3 保存兜底（`src/App.tsx` `hardBlockMessage` + `trySave`）✅【v2 重写，v2.2 加固】

> v1 版本声称扫描"名称互撞的条目"——经核实为**死代码**（见 2.1 推论）。**v2.2** 把下面三项硬阻止抽成共享函数 `hardBlockMessage(): string | null`（返回 alert 文案或 null），供 `trySave` 与 `handleSaveUsageConfig` 共同使用，避免第二条写盘路径绕过闸门：

1. **撞名暂存**：`displacedRef.current.size > 0`（有厂商被置换未还原）→ `alert(t("saveBlockedDisplaced"))`，**硬阻止，不走 confirm**。
2. **空名扫描**：`Object.keys(config.providers)` 中 `trim() === ""` 的 key（清空名称走改名分支后会以 `providers[""]` 留在地图中）。命中 → `alert(t("saveBlockedNameConflict", { names: blankNames.map(k => JSON.stringify(k)).join(", ") }))` 并 `return false`。
3. **trim 级重名扫描（v2.2 新增）**：`findTrimDuplicateProviderNames(config.providers)` 按 trim 后的名字分组，返回所有落在 ≥2 个原始 key 组里的 key（排序稳定）。命中文案同上，names 同款 `JSON.stringify` 渲染。**理由**：编辑页红框按 trim 相等判定（`validation.ts:115`），但落盘闸门原来只查空名，`"TokenHub "` 可经 Ctrl+S 落盘，此后编辑页两条目永久红框且无出路。

- 覆盖范围：`trySave` 的全部三条入口（Ctrl+S、底部按钮、切换供应商）在 `await save()` 之前统一过检；**v2.2** 起用量配置弹窗的 silent save 也过同一闸门（见 4.9）。
- 单测：`findTrimDuplicateProviderNames` 在 `src/lib/validation.test.ts` 新增 5 用例（无重复 / 空白变体重复 / 多组重复 / 大小写不同不算重复 / 空名不计入）。

### 4.4 新建自定义起名防撞（`handleAddCustomProvider`）✅

```ts
let n = providers.length + 1;
let name = `provider-${n}`;
while (Object.hasOwn(config.providers, name)) { n++; name = `provider-${n}`; }
```

### 4.5 JSON 应用防撞（`handleApplyProviderJson`）✅【v2.2 补还原】

- 应用前：空名 → `alert(t("validationNameEmpty"))` return；`provider.name !== editingProvider && Object.hasOwn(config.providers, provider.name)` → `alert(t("applyJsonNameConflict"))` return。均不产生任何状态变更（**源头拒绝**，应用是一次性动作，无逐键写入问题）。
- **v2.2**：更新器内在 providers 写入完成后调用 `restoreDisplaced(providers)`。原实现只有改名/删除两条还原路径，撞名态下应用 JSON 后暂存永远无法清空 → 之后每次保存都被永久阻断。

### 4.6 i18n（`src/i18n/zh.ts` / `src/i18n/en.ts`）✅

| key | zh | en |
|---|---|---|
| `validationNameEmpty` | 供应商名称不能为空 | Provider name is required |
| `validationNameDuplicate` | 名称与其他供应商重复 | Name conflicts with another provider |
| `saveBlockedNameConflict` | 保存已阻止：以下供应商名称冲突或为空：{names} | Save blocked: duplicate or empty provider names: {names} |
| `applyJsonNameConflict` | JSON 中的名称与其他供应商重复，未应用 | Name in JSON conflicts with another provider; not applied |
| `saveBlockedDisplaced`（v2.1） | 保存已阻止：本次编辑曾发生同名覆盖，请返回并丢弃更改后重试 | Save blocked: a provider was overwritten by a name conflict during this edit; go back and discard changes, then retry |

（插值用 `t(key, { names })` 命名占位符，与 `saveValidationConfirm` 一致。v2.2 未新增 key——trim 重名复用 `saveBlockedNameConflict`，导航拦截复用 `saveBlockedDisplaced`；zh/en 各 585 条保持对等。）

### 4.9 用量配置弹窗的保存闸门（`handleSaveUsageConfig`）✅【v2.2 新增】

- 原实现直接 `save({ silent: true })`，绕过 `trySave`，撞名态可经弹窗把污染配置落盘。
- 修复：`save` 之前调用 `hardBlockMessage()`，命中则 `alert(理由)` 并 `return Promise.resolve()`。**不抛错**——`UsageConfigModal.tsx` 的 `handleTest` 会 `await onSave(...)`，抛错会进 catch 显示误导性的「网络错误」。
- **保留 `silent: true` 语义**：非 silent 会切 loading 屏、卸载弹窗、吞掉测试查询结果。

### 4.10 顶栏导航拦截（`guardedSetView`）✅【v2.2 新增】

- 顶栏四个导航按钮（供应商 / dashboard / sessions / 子代理设置）原为纯 `setView`。撞名未还原时离开编辑页会让用户失去唯一能修好的入口（改名 / 删除占位者 / 丢弃），而保存仍被阻断。
- 修复：包一层 `guardedSetView(view, prepare?)`，**仅当暂存 Map 非空**时 `alert(t("saveBlockedDisplaced"))` 并阻止导航。非撞名的普通 dirty 导航**不受影响**（体验不变）。
- 侧边设置齿轮同走该守卫（`prepare` 用于先切 `settingsTab`）；`handleEditBack` 仍是显式丢弃路径，不拦。

### 4.7 撞名置换暂存与自动还原（`src/App.tsx`）✅【v2 新增，v2.1 执行前修订，v2.2 改多槽】

堵住 Ctrl+S 洞的核心机制。**v2.1 修订**：v2 原稿"未命中即清标志"存在还原漏洞——撞名瞬间原条目已在内存中被销毁，用户随后改名离开撞名态时标志清空、保存放行，但被置换的条目并未回来，丢失照样落盘。修订为**置换暂存 + 自动还原**：

- **状态（v2.2 改多槽）**：`displacedRef: Map<string, Provider>`（useRef，不参与渲染），key = 被占用的供应商名。"处于冲突未还原态" 由 `displacedRef.current.size > 0` 派生，`trySave` / `handleSaveUsageConfig` / 顶栏导航以此硬阻止。
  - **为何多槽**：单槽 `{key, provider} | null` 下，用户改名 A→B（撞 B）、再改名 C→D（撞 D）时，第二次撞名会因"暂存已非空"被整体跳过——D 的原条目被覆盖且无任何记录，最终可被静默落盘。
  - **同 key 重复撞名不刷新快照**：再次撞上同一名字时覆盖的是上一个 squatter，只有槽里的首份快照是原始受害者，必须保留。
- **`restoreDisplaced(providers)` 共享 helper**：遍历暂存，凡 `key` 已不在 `providers` 里的槽位全部写回并从暂存删除（`Object.hasOwn` 判存在）。供 `handleUpdateProvider`、`handleDeleteProvider`、`handleApplyProviderJson` 三处复用。
- **`handleUpdateProvider` 更新器内的执行顺序（不可换）**，以 `oldKey` = 名称等于 `editingProvider` 的条目之 key：
  1. 对变更前地图判定 `displacedKey = (provider.name !== oldKey && Object.hasOwn(cfg.providers, provider.name)) ? provider.name : null`；
  2. 执行原有改名/直赋逻辑；
  3. **还原**：`restoreDisplaced(providers)`。（必须在改名搬走旧 key **之后**——否则被编辑条目自己占着那个 key，还原条件永假；且必须在暂存新的受害者之前，先腾空已还原的槽位。）
  4. **置换**：若 `displacedKey` 非空且 `!displacedRef.current.has(displacedKey)` → `set(displacedKey, 变更前地图中该条目)`。
  - 照常提交的原因：名称输入是受控组件且逐键回写，拒绝提交会导致输入逐字符回跳；内存损伤由"暂存可还原 + 不落盘"兜底。
- **检查**：`hardBlockMessage()` 第一项（4.3）。
- **清理（v2.1 统一，v2.2 加成功条件）**：`reloadFromDisk` 包装函数——`await refresh()` 返回 `true`（重载真的成功）**之后**才 `clear()` 暂存；重载失败时内存仍处撞名态，必须继续阻止保存。覆盖全部从磁盘重载的调用点：Ctrl+R、`handleEditBack` 两条丢弃路径、页脚「重新加载配置」、切换被阻回滚、加载失败重试。顶部「providers」返回列表不重载、不清暂存（v2.2 起该导航本身被 `guardedSetView` 拦截，见 4.10）。
- **删除还原**：撞名后删除正在编辑的厂商 → 同一 helper 把暂存条目还原进 providers 并清空（其占用的 key 已释放）。还原后的条目模型已被 rekey/删除流程清掉，保存时完整性确认会提示"缺模型"——属可接受的残余影响。
- **其他残余影响（可接受）**：撞名瞬间的改名分支会把模型别名 rekey 出 `-2` 后缀，还原后别名可能残留编号痕迹，无害。
- 更彻底的替代方案（名称输入改本地草稿态、保存时一次性提交）见决策点 D6。

### 4.8 附带小修 ✅

- `handleDuplicateProvider` 的 toast 文案不再硬编码 `${name}-copy`，显示真实新名（`-copy` / `-copy-2`…）。

### 4.11 map 存在性判断统一 `Object.hasOwn`（`src/App.tsx`）✅【v2.2 新增】

- 原实现散用 `key in obj`，而 `in` 走原型链：命名 `constructor` / `toString` / `__proto__` 的供应商会产生幽灵命中（自建名循环误判已占用、JSON 应用误报撞名、暂存还原条件永假、模型别名去重失效）。
- 已全量排查并替换（`handleAddCustomProvider`、`handleUpdateProvider` 的 `displacedKey`、`restoreDisplaced`、`handleApplyProviderJson` 的四处、`onModelChange` 的占位别名判定、`onModelAdd`、`onBulkAdd`）；只改语义等价的纯 map 存在性判断，未动其余逻辑。
- **前置条件**：`Object.hasOwn` 需要 `lib: ES2022`（原 `ES2020` 下 `tsc` 报 TS2550）。已把 `tsconfig.json` 的 `lib` 提升到 `ES2022`，`target` 保持 `ES2020`——该 API 属运行时能力，Tauri 2 支持的 WebView2 / WebKitGTK / WKWebView 均具备。
- `src/lib/subagent-settings.ts` 等处仍有同类 `in` 判断，属本次修复范围之外（不在撞名写盘路径上），未改动。

---

## 五、测试计划

### 5.1 自动化（已通过 ✅）

- `src/lib/validation.test.ts`：12 用例——7 条 `validateProviderName`（空名 / 纯空白 / 撞名 / 大小写不判撞 / 双侧 trim / 唯一名 / 空名优先级）+ 5 条 `findTrimDuplicateProviderNames`（无重复 / 空白变体重复 / 多组重复排序 / 大小写不同不算重复 / 空名不计入）。
- 置换暂存算法（4.7）经 27 条断言的独立推演脚本验证（撞名置位、Ctrl+S 阻止、改名还原、连续两次碰撞、删除还原、页脚重载后放行、顶部返回后仍阻止等），脚本为临时产物已删除。
- 全量 `npm test`：11 文件 / 162 用例通过；`npx tsc -p tsconfig.json --noEmit` 无错误；`npm run build` 成功。

### 5.2 手工端到端清单（待 GUI 验收 ⏳）

1. 新建自定义 → 名称改成已有厂商名 → 输入框标红、保存按钮禁用。
2. 上述状态下按 Ctrl+S → 弹 alert 阻止，config.toml mtime 不变（核心回归用例）。
3. 「配置 JSON」页粘贴含撞名 `name` 的 JSON → 拒绝应用，配置无变化。
4. 复制 TokenHub → 编辑副本改名为 `TokenHub` → 红框（v2.1 后完全同名也有红框）+ Ctrl+S 被阻。
5. 正常并存回归：`TokenHub` + `TokenHub-2` 同时在场，切换激活、重启应用、kimi-code CLI 实际调用均正常。
6. 新建自定义 → 删除一个 `provider-N` 再新建 → 占位名不回退撞名。
7. 撞名状态下点「返回」并确认丢弃 → 列表恢复原状（原厂商家与其 Key 完整回来）；Ctrl+R 走确认丢弃同验。
8. 撞名状态下点页脚「重新加载配置」→ 重载后保存放行、内存与磁盘一致。
9. **（v2.2）连续两次撞名**：改名 A→B 撞名，不解决，再改名 C→D 撞名 → 两次的受害者都能各自还原，不出现只回来一个的情况。
10. **（v2.2）撞名态下打开用量配置弹窗 → 保存/测试** → 弹与 Ctrl+S 相同的阻止 alert，弹窗不被卸载，不出现「网络错误」字样。
11. **（v2.2）trim 重名**：手工构造 `TokenHub` 与 `TokenHub `（尾部空格）两条目 → Ctrl+S 被阻，names 里能看到两个带引号的名字。
12. **（v2.2）导航拦截**：撞名未解决时点顶栏 dashboard / sessions / 子代理设置 → 弹阻止 alert 且停原地；解决后（丢弃）恢复正常导航。普通未保存修改下导航仍照常放行。
13. **（v2.2）重载失败**：让 `load_agent_config_command` 失败（如临时破坏后端）→ 撞名态下点「重新加载配置」→ 错误提示出现，且随后的 Ctrl+S **仍被阻止**（暂存未被误清）。

---

## 六、不改什么（范围控制）与已记录的绕行路径

- **不引入**内部 UUID/自增 id 作为主键 —— 改动面覆盖前后端与 config.toml 语义，收益不匹配。
- **不动** Rust 存储层与导入/导出（`kimi_code_io.rs`、`db.rs`）。
- **不做**任何按 `base_url` 的判断（用户明确否决）。
- **不迁移**现有配置（`TokenHub-2` 保持原名；第一把 Key 由用户按附录 A 自行恢复）。
- **记录不修**：`handleSaveUsageConfig` 直接 `save({silent:true})` 绕过 trySave。经推演撞名态无法经正常 UI 到达该入口（用量弹窗仅在列表页打开；编辑页返回必经丢弃/确认刷新；Ctrl+R 有 dirty 确认；关闭窗口有 beforeunload dirty 提示），属理论洞。若未来在列表页新增直接写路径，需重新评估此处。

---

## 七、决策点（已按建议值实施 ✅）

| # | 问题 | 采纳结论 |
|---|---|---|
| D1 | 大小写：`TokenHub` vs `tokenhub` 算不算撞名？ | **全等判定**（TOML 键与 CLI 均大小写敏感） |
| D2 | 撞名时保存按钮 `disabled`，还是可点但弹错？ | **disabled** + trySave 硬阻止兜底 |
| D3 | 复制副本是否清空 `usage_config`？ | 暂不动，仅记录该行为 |
| D4 | 是否顺带修 4.8 的 toast 文案？ | 已修 |
| D5 | `trySave` 对「名称为空」是否也硬阻止？ | 是 |
| **D6（v2）** | 堵 Ctrl+S 漏洞的机制：4.7 置换暂存（v2.1） vs 名称输入本地草稿态 | **置换暂存**（已实施；草稿态为后续重构方向，可彻底消除逐键内存损伤） |

---

## 附录 A：第一把 Key 恢复步骤

> ⚠️ **警告 1**：手工修改 config.toml 前**先完全退出 Kimi Switch**（含托盘进程）。应用内存态在下一次任何保存时都会整体覆写 config.toml，保存路径不检测外部修改。
>
> ⚠️ **警告 2**：备份保留期为 **7 天**（`kimi_code_io.rs:55` 按修改时间清理），该备份最迟约 10-23 会被清掉——如不立即恢复，请先把备份文件复制到其他位置保存。

1. 打开 `C:/Users/130591/.kimi-code/backups/config.toml.bak.20261016_131835_.125`。
2. 复制 `[providers.TokenHub]` 小节（含 `api_key = "sk-EGnYXU..."`）及其对应的 `[models."TokenHub/..."]` 各小节。
3. 粘贴回当前 `~/.kimi-code/config.toml`（或通过 Kimi Switch UI 新建供应商，名称填 `TokenHub`，粘贴 Key 与模型映射）。
4. 与 `[providers.TokenHub-2]` 并存即可，无需其他调整。

## 附录 B：关键代码位置（实施前定位）

- 存储主键：`src-tauri/src/models.rs:243`、`src-tauri/src/kimi_code_io.rs:292-377`
- 写入点 #1：`src/App.tsx:289-325`（`handleUpdateProvider`）、`src/components/ProviderEdit.tsx:249-254`（名称输入）
- 写入点 #2：`src/App.tsx:508-515`（`handleApplyProviderJson`）
- 写入点 #3：`src/App.tsx:228-256`（`handleAddCustomProvider`）
- 校验缺口：`src/lib/validation.ts:33-89`（`validateProviders`）
- 落盘路径枚举：`App.tsx:183 / :200 / :370 / :467 / :901`（见 2.3 表）
- Ctrl+S 监听：`App.tsx:193-219`（window 级 keydown）
- 丢弃还原：`App.tsx:487-506`（`handleEditBack` → `refresh()`）、Ctrl+R `:202-207`、beforeunload `:120-130`
- 复制流程：`src/App.tsx:373-400`、`src/lib/providerRename.ts:29-79`
- 备份策略：`src-tauri/src/kimi_code_io.rs:47-65`（每次写入前全量备份，7 天保留）

> 注：以上行号为**实施前**定位，作为事故分析与评审依据保留；实施后 App.tsx / ProviderEdit.tsx 行号有位移，以当前代码为准。
