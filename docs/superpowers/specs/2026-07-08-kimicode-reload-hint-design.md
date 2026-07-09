# Kimi Code 选项卡 /reload 提示设计

## 背景

用户在 Kimi Code 选项卡下切换供应商后，Kimi Code CLI 需要执行 `/reload` 才能加载新的提供方配置。当前界面没有给出该提示，用户容易遗漏这一步。

## 目标

在 Kimi Code 选项卡下，给每个供应商的"切换使用"按钮旁边增加一个信息提示，告知用户切换供应商后需要执行 `/reload`。

## 设计

### 位置与交互

- 在 `ProviderList` 组件中，每个供应商卡片右侧的"切换使用"按钮旁边添加一个信息图标 `ⓘ`。
- 使用原生 `title` 属性展示 tooltip，鼠标悬停时显示提示文案。
- 仅在当前选中 `agent === "kimi_code"` 时显示该图标；Pi 选项卡下不显示。

### 文案

- 中文：`切换供应商后，请在 Kimi Code 中执行 /reload 以生效。`
- 英文：`After switching providers, run /reload in Kimi Code to apply the change.`

### 样式

- 图标大小约 14px，颜色为 `text-gray-500`，hover 时变为 `text-gray-300`。
- 图标与"切换使用"按钮间距约 8px（`gap-2`）。
- 不引入额外依赖或自定义 tooltip 组件。

### 组件与数据流

- `src/components/ProviderList.tsx`：
  - `ProviderListProps` 新增 `agent: Agent` 字段。
  - 根据 `agent` 决定是否渲染提示图标。
  - 图标 `title` 使用 `t("switchReloadHint")`。
- `src/App.tsx`：
  - 渲染 `<ProviderList />` 时传入 `agent={agent}`。
- `src/i18n/zh.ts` 与 `src/i18n/en.ts`：
  - 新增键 `switchReloadHint`。

## 验收标准

- [ ] 切换到 Kimi Code 选项卡时，每个供应商的"切换使用"按钮旁出现 `ⓘ` 图标。
- [ ] 鼠标悬停在图标上时，显示正确语言版本的 `/reload` 提示。
- [ ] 切换到 Pi 选项卡时，该图标不显示。
- [ ] 不引入新的运行时依赖。
- [ ] TypeScript 编译与项目构建保持通过。
