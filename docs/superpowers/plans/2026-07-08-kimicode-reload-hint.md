# Kimi Code /reload Hint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an info icon tooltip next to the "switch provider" button, visible only in the Kimi Code tab, reminding users to run `/reload` after switching providers.

**Architecture:** Extend `ProviderList` to receive the current `agent` and conditionally render a hint icon beside the switch button. Keep changes minimal and UI-only; no state or backend changes.

**Tech Stack:** React 18, TypeScript, Tailwind CSS, custom i18n module (`src/i18n`).

---

### Task 1: Add i18n translation keys

**Files:**
- Modify: `src/i18n/zh.ts`
- Modify: `src/i18n/en.ts`

- [ ] **Step 1: Add Chinese translation**

Insert `switchReloadHint` into the "Provider list" section of `src/i18n/zh.ts`, e.g. after `switchTo`:

```ts
  switchReloadHint: "切换供应商后，请在 Kimi Code 中执行 /reload 以生效。",
```

- [ ] **Step 2: Add English translation**

Insert the matching key into `src/i18n/en.ts`:

```ts
  switchReloadHint: "After switching providers, run /reload in Kimi Code to apply the change.",
```

- [ ] **Step 3: Commit**

```bash
git add src/i18n/zh.ts src/i18n/en.ts
git commit -m "i18n: add switchReloadHint for Kimi Code reload reminder"
```

---

### Task 2: Update ProviderList to accept agent and render hint

**Files:**
- Modify: `src/components/ProviderList.tsx`

- [ ] **Step 1: Import Agent type and update props**

Add `Agent` to the import from `../types` and add `agent` to `ProviderListProps`:

```tsx
import { useTranslation } from "../i18n";
import type { Agent, Model, Provider } from "../types";

interface ProviderListProps {
  providers: Provider[];
  defaultModel: string | null;
  models: Record<string, Model>;
  onEdit: (name: string) => void;
  onDelete: (name: string) => void;
  onAdd: () => void;
  onSwitchProvider: (name: string) => void;
  agent: Agent;
}
```

- [ ] **Step 2: Destructure agent in component signature**

```tsx
export function ProviderList({
  providers,
  defaultModel,
  models,
  onEdit,
  onDelete,
  onAdd,
  onSwitchProvider,
  agent,
}: ProviderListProps) {
```

- [ ] **Step 3: Render hint icon next to the switch button**

In the supplier card actions area, place an info icon immediately after the "切换使用" / "Switch to" button, rendered only when `agent === "kimi_code"`:

```tsx
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSwitchProvider(provider.name);
                      }}
                      className={`px-3 py-1.5 text-sm rounded focus:ring-2 focus:outline-none ${
                        isActive
                          ? "bg-green-600 hover:bg-green-700 text-white focus:ring-green-500"
                          : "bg-blue-600 hover:bg-blue-700 text-white focus:ring-blue-500"
                      }`}
                    >
                      {isActive ? t("inUse") : t("switchTo")}
                    </button>
                    {agent === "kimi_code" && (
                      <span
                        className="text-sm text-gray-500 hover:text-gray-300 cursor-help select-none"
                        title={t("switchReloadHint")}
                        aria-label={t("switchReloadHint")}
                      >
                        ⓘ
                      </span>
                    )}
```

- [ ] **Step 4: Commit**

```bash
git add src/components/ProviderList.tsx
git commit -m "feat: show /reload hint next to switch provider button in Kimi Code tab"
```

---

### Task 3: Pass agent from App to ProviderList

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Add agent prop to ProviderList usage**

Locate the `<ProviderList ... />` call in `src/App.tsx` and add `agent={agent}`:

```tsx
          <ProviderList
            providers={providers}
            defaultModel={config.default_model}
            models={config.models}
            onEdit={(name) => {
              setEditingProvider(name);
              setView("edit");
            }}
            onDelete={handleDeleteProvider}
            onAdd={handleAddProvider}
            onSwitchProvider={handleSwitchProvider}
            agent={agent}
          />
```

- [ ] **Step 2: Commit**

```bash
git add src/App.tsx
git commit -m "chore: pass current agent to ProviderList"
```

---

### Task 4: Verify with type check and manual test

- [ ] **Step 1: Run TypeScript compilation**

```bash
npm run build
```

Expected: `tsc` completes without errors and Vite builds successfully.

- [ ] **Step 2: Run the app**

```bash
npm run tauri-dev
```

- [ ] **Step 3: Manual verification**

1. Select the **Kimi Code** tab.
2. Hover over the `ⓘ` icon next to any provider's "切换使用" / "Switch to" button.
3. Confirm the tooltip reads:  
   - 中文：`切换供应商后，请在 Kimi Code 中执行 /reload 以生效。`  
   - English: `After switching providers, run /reload in Kimi Code to apply the change.`
4. Switch to the **Pi** tab and confirm the `ⓘ` icon is **not** present.

- [ ] **Step 4: Commit verification notes (optional)**

If any fixes were needed, commit them; otherwise no additional commit is required.

---

## Self-Review

- **Spec coverage:** Every design requirement (icon next to switch button, Kimi Code only, i18n, no new dependencies) maps to a task above.
- **Placeholder scan:** No TBD/TODO/fill-in-details present.
- **Type consistency:** `Agent` type is imported from `../types` and used consistently in props and conditional rendering.
