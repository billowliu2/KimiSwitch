# Kimi Code 全局配置面板与模型默认上下文 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Kimi Code global settings panel inside ProviderEdit and auto-set `max_context_size` for new models based on a model-ID lookup table.

**Architecture:** Extend the shared `Config` type with typed agent settings, add two pure helper modules (`agent-settings.ts` for `raw_other` IO and `model-defaults.ts` for context lookup), and render the panel in a new React component wired through `ProviderEdit`.

**Tech Stack:** React 18, TypeScript, Tailwind CSS, custom i18n, Tauri v2 backend (no Rust changes).

---

### Task 1: Add agent settings types

**Files:**
- Modify: `src/types/index.ts`

- [ ] **Step 1: Append new types**

Insert at the end of `src/types/index.ts`:

```ts
export interface ThinkingConfig {
  enabled?: boolean;
  effort?: "low" | "medium" | "high" | "max";
  keep?: "all" | false | 0 | "no" | "off" | "none" | null;
}

export interface LoopControlConfig {
  max_retries_per_step?: number;
  reserved_context_size?: number;
}

export interface BackgroundConfig {
  max_running_tasks?: number;
  keep_alive_on_exit?: boolean;
}

export interface PermissionRule {
  decision?: "allow" | "deny" | "ask";
  scope?: string;
  pattern?: string;
  reason?: string;
}

export interface Hook {
  event?: string;
  matcher?: string;
  command?: string;
  timeout?: number;
}

export interface AgentSettings {
  thinking?: ThinkingConfig;
  loop_control?: LoopControlConfig;
  background?: BackgroundConfig;
  permission?: { rules?: PermissionRule[] };
  hooks?: Hook[];
}
```

- [ ] **Step 2: Commit**

```bash
git add src/types/index.ts
git commit -m "types: add AgentSettings and related Kimi Code config types"
```

---

### Task 2: Create model default context size lookup

**Files:**
- Create: `src/lib/model-defaults.ts`

- [ ] **Step 1: Create the lookup module**

Create `src/lib/model-defaults.ts`:

```ts
export const DEFAULT_MAX_CONTEXT_SIZE = 256000;

interface ModelContextRule {
  pattern: RegExp;
  max_context_size: number;
}

const MODEL_CONTEXT_RULES: ModelContextRule[] = [
  // Kimi
  { pattern: /^kimi-for-coding$/i, max_context_size: 262144 },
  { pattern: /^kimi-k2\.5/i, max_context_size: 256000 },
  { pattern: /^kimi-k2/i, max_context_size: 256000 },
  { pattern: /^kimi-/i, max_context_size: 256000 },
  // GLM
  { pattern: /^glm-5\.2/i, max_context_size: 1000000 },
  { pattern: /^glm-5\.1/i, max_context_size: 256000 },
  { pattern: /^glm-5/i, max_context_size: 256000 },
  { pattern: /^glm-4/i, max_context_size: 128000 },
  { pattern: /^glm-/i, max_context_size: 128000 },
  // MiniMax
  { pattern: /^MiniMax-M3/i, max_context_size: 1000000 },
  { pattern: /^MiniMax-Text-01/i, max_context_size: 400000 },
  { pattern: /^MiniMax-/i, max_context_size: 256000 },
  // Qwen
  { pattern: /^qwen2\.5/i, max_context_size: 128000 },
  { pattern: /^qwen-max/i, max_context_size: 128000 },
  { pattern: /^qwen-plus/i, max_context_size: 128000 },
  { pattern: /^qwen-turbo/i, max_context_size: 128000 },
  { pattern: /^qwen-coder/i, max_context_size: 128000 },
  { pattern: /^qwen-/i, max_context_size: 128000 },
  // DeepSeek
  { pattern: /^deepseek-r1/i, max_context_size: 64000 },
  { pattern: /^deepseek-v3/i, max_context_size: 64000 },
  { pattern: /^deepseek-coder/i, max_context_size: 64000 },
  { pattern: /^deepseek-/i, max_context_size: 64000 },
  // Hunyuan
  { pattern: /^hunyuan-pro/i, max_context_size: 32000 },
  { pattern: /^hunyuan-standard/i, max_context_size: 32000 },
  { pattern: /^hunyuan-lite/i, max_context_size: 32000 },
  { pattern: /^hunyuan-/i, max_context_size: 32000 },
  // Doubao
  { pattern: /^doubao-pro/i, max_context_size: 128000 },
  { pattern: /^doubao-lite/i, max_context_size: 128000 },
  { pattern: /^doubao-vision/i, max_context_size: 128000 },
  { pattern: /^doubao-/i, max_context_size: 128000 },
  // ERNIE
  { pattern: /^ernie-4\.0/i, max_context_size: 128000 },
  { pattern: /^ernie-3\.5/i, max_context_size: 128000 },
  { pattern: /^ernie-speed/i, max_context_size: 128000 },
  { pattern: /^ernie-lite/i, max_context_size: 128000 },
  { pattern: /^ernie-/i, max_context_size: 128000 },
  // Spark
  { pattern: /^spark-v4/i, max_context_size: 32000 },
  { pattern: /^spark-v3\.5/i, max_context_size: 32000 },
  { pattern: /^spark-pro/i, max_context_size: 32000 },
  { pattern: /^spark-max/i, max_context_size: 32000 },
  { pattern: /^spark-/i, max_context_size: 32000 },
  // SenseChat
  { pattern: /^sensechat-/i, max_context_size: 128000 },
  // Baichuan
  { pattern: /^baichuan-4/i, max_context_size: 128000 },
  { pattern: /^baichuan-3/i, max_context_size: 128000 },
  { pattern: /^baichuan-/i, max_context_size: 128000 },
  // Yi
  { pattern: /^yi-/i, max_context_size: 128000 },
  // Claude
  { pattern: /^claude-opus/i, max_context_size: 200000 },
  { pattern: /^claude-sonnet/i, max_context_size: 200000 },
  { pattern: /^claude-haiku/i, max_context_size: 200000 },
  { pattern: /^claude-/i, max_context_size: 200000 },
  // OpenAI
  { pattern: /^gpt-4\.1/i, max_context_size: 1047576 },
  { pattern: /^gpt-4o/i, max_context_size: 128000 },
  { pattern: /^gpt-4-turbo/i, max_context_size: 128000 },
  { pattern: /^gpt-4-/i, max_context_size: 128000 },
  // Gemini
  { pattern: /^gemini-2\.0-flash/i, max_context_size: 1048576 },
  { pattern: /^gemini-1\.5-pro/i, max_context_size: 2097152 },
  { pattern: /^gemini-1\.5-flash/i, max_context_size: 1048576 },
  { pattern: /^gemini-/i, max_context_size: 1048576 },
];

export function getDefaultMaxContextSize(modelId: string): number {
  for (const rule of MODEL_CONTEXT_RULES) {
    if (rule.pattern.test(modelId)) {
      return rule.max_context_size;
    }
  }
  return DEFAULT_MAX_CONTEXT_SIZE;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/model-defaults.ts
git commit -m "feat: add model default max_context_size lookup table"
```

---

### Task 3: Create agent settings IO helpers

**Files:**
- Create: `src/lib/agent-settings.ts`

- [ ] **Step 1: Create helper module**

Create `src/lib/agent-settings.ts`:

```ts
import type { AgentSettings } from "../types";

const DEFAULT_SETTINGS: AgentSettings = {
  thinking: {
    enabled: true,
    effort: "medium",
    keep: "all",
  },
  loop_control: {
    max_retries_per_step: 3,
    reserved_context_size: 50000,
  },
  background: {
    keep_alive_on_exit: false,
  },
  permission: { rules: [] },
  hooks: [],
};

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function getSection<T>(rawOther: unknown, key: string): T | undefined {
  const root = asRecord(rawOther);
  const section = root[key];
  if (section === undefined || section === null) return undefined;
  return section as T;
}

export function getAgentSettings(rawOther: unknown): AgentSettings {
  return {
    thinking: {
      ...DEFAULT_SETTINGS.thinking,
      ...getSection<AgentSettings["thinking"]>(rawOther, "thinking"),
    },
    loop_control: {
      ...DEFAULT_SETTINGS.loop_control,
      ...getSection<AgentSettings["loop_control"]>(rawOther, "loop_control"),
    },
    background: {
      ...DEFAULT_SETTINGS.background,
      ...getSection<AgentSettings["background"]>(rawOther, "background"),
    },
    permission: {
      rules: getSection<AgentSettings["permission"]>(rawOther, "permission")?.rules ?? [],
    },
    hooks: getSection<AgentSettings["hooks"]>(rawOther, "hooks") ?? [],
  };
}

export function setAgentSettings(
  rawOther: unknown,
  patch: Partial<AgentSettings>
): unknown {
  const root = { ...asRecord(rawOther) };
  const current = getAgentSettings(rawOther);
  const next: AgentSettings = {
    thinking: { ...current.thinking, ...patch.thinking },
    loop_control: { ...current.loop_control, ...patch.loop_control },
    background: { ...current.background, ...patch.background },
    permission: { rules: patch.permission?.rules ?? current.permission?.rules ?? [] },
    hooks: patch.hooks ?? current.hooks ?? [],
  };

  if (next.thinking) root.thinking = next.thinking;
  if (next.loop_control) root.loop_control = next.loop_control;
  if (next.background) root.background = next.background;
  if (next.permission?.rules && next.permission.rules.length > 0) {
    root.permission = next.permission;
  } else {
    delete root.permission;
  }
  if (next.hooks && next.hooks.length > 0) {
    root.hooks = next.hooks;
  } else {
    delete root.hooks;
  }

  return root;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/agent-settings.ts
git commit -m "feat: add agent settings read/write helpers"
```

---

### Task 4: Add i18n keys

**Files:**
- Modify: `src/i18n/zh.ts`
- Modify: `src/i18n/en.ts`

- [ ] **Step 1: Add Chinese keys**

Insert into `src/i18n/zh.ts` in the "Agent / target" section:

```ts
  agentSettings: "全局配置",
  enableThinking: "启用思考",
  thinkingLevel: "思考等级",
  thinkingKeep: "保留思考内容",
  thinkingLow: "低",
  thinkingMedium: "中",
  thinkingHigh: "高",
  thinkingMax: "最大",
  thinkingContextHint: "启用思考会占用更多上下文，请确保模型上下文长度和预留空间足够。",
  loopControlSettings: "循环控制",
  maxRetriesPerStep: "单步重试次数",
  reservedContextSize: "上下文预留大小",
  backgroundSettings: "后台任务",
  maxRunningTasks: "最大并发数",
  keepAliveOnExit: "退出时保持运行",
  permissionRules: "权限规则",
  permissionDecision: "处置",
  permissionPattern: "模式",
  permissionAllow: "允许",
  permissionDeny: "拒绝",
  permissionAsk: "询问",
  addRule: "+ 添加规则",
  addCommonRules: "添加常用规则",
  hooks: "生命周期钩子",
  hookEvent: "事件",
  hookMatcher: "匹配器",
  hookCommand: "命令",
  hookTimeout: "超时",
  addHook: "+ 添加钩子",
```

- [ ] **Step 2: Add English keys**

Insert matching keys into `src/i18n/en.ts`:

```ts
  agentSettings: "Global Settings",
  enableThinking: "Enable thinking",
  thinkingLevel: "Thinking level",
  thinkingKeep: "Keep thinking content",
  thinkingLow: "Low",
  thinkingMedium: "Medium",
  thinkingHigh: "High",
  thinkingMax: "Max",
  thinkingContextHint: "Thinking uses more context. Ensure the model context length and reserved size are sufficient.",
  loopControlSettings: "Loop Control",
  maxRetriesPerStep: "Max retries per step",
  reservedContextSize: "Reserved context size",
  backgroundSettings: "Background Tasks",
  maxRunningTasks: "Max running tasks",
  keepAliveOnExit: "Keep alive on exit",
  permissionRules: "Permission Rules",
  permissionDecision: "Decision",
  permissionPattern: "Pattern",
  permissionAllow: "Allow",
  permissionDeny: "Deny",
  permissionAsk: "Ask",
  addRule: "+ Add rule",
  addCommonRules: "Add common rules",
  hooks: "Lifecycle Hooks",
  hookEvent: "Event",
  hookMatcher: "Matcher",
  hookCommand: "Command",
  hookTimeout: "Timeout",
  addHook: "+ Add hook",
```

- [ ] **Step 3: Commit**

```bash
git add src/i18n/zh.ts src/i18n/en.ts
git commit -m "i18n: add agent settings panel translations"
```

---

### Task 5: Build the AgentSettingsPanel component

**Files:**
- Create: `src/components/AgentSettingsPanel.tsx`

- [ ] **Step 1: Create the panel component**

Create `src/components/AgentSettingsPanel.tsx`:

```tsx
import { useTranslation } from "../i18n";
import { getAgentSettings, setAgentSettings } from "../lib/agent-settings";
import type { AgentSettings, PermissionRule, Hook } from "../types";
import type { ReactNode } from "react";
import type { TranslationKey } from "../i18n/zh";

interface AgentSettingsPanelProps {
  rawOther: unknown;
  onChange: (nextRawOther: unknown) => void;
}

const THINKING_LEVELS = ["low", "medium", "high", "max"] as const;
const THINKING_LABELS: Record<(typeof THINKING_LEVELS)[number], TranslationKey> = {
  low: "thinkingLow",
  medium: "thinkingMedium",
  high: "thinkingHigh",
  max: "thinkingMax",
};
const PERMISSION_DECISIONS = ["allow", "deny", "ask"] as const;
const PERMISSION_LABELS: Record<(typeof PERMISSION_DECISIONS)[number], TranslationKey> = {
  allow: "permissionAllow",
  deny: "permissionDeny",
  ask: "permissionAsk",
};
const COMMON_EVENTS = ["PreToolUse", "PostToolUse"] as const;

export function AgentSettingsPanel({ rawOther, onChange }: AgentSettingsPanelProps) {
  const { t } = useTranslation();
  const settings = getAgentSettings(rawOther);

  const update = (patch: Partial<AgentSettings>) => {
    onChange(setAgentSettings(rawOther, patch));
  };

  const updateThinking = (patch: Partial<AgentSettings["thinking"]>) => {
    update({ thinking: { ...settings.thinking, ...patch } });
  };

  const updateLoopControl = (patch: Partial<AgentSettings["loop_control"]>) => {
    update({ loop_control: { ...settings.loop_control, ...patch } });
  };

  const updateBackground = (patch: Partial<AgentSettings["background"]>) => {
    update({ background: { ...settings.background, ...patch } });
  };

  const setRules = (rules: PermissionRule[]) => {
    update({ permission: { rules } });
  };

  const setHooks = (hooks: Hook[]) => {
    update({ hooks });
  };

  const thinkingEnabled = settings.thinking?.enabled ?? true;

  return (
    <div className="mt-6 space-y-4">
      <h3 className="text-gray-400 text-sm font-medium">{t("agentSettings")}</h3>

      {/* Thinking */}
      <Card title={t("enableThinking")}>
        <Checkbox
          label={t("enableThinking")}
          checked={thinkingEnabled}
          onChange={(checked) => updateThinking({ enabled: checked })}
        />
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-sm text-gray-400">{t("thinkingLevel")}</span>
          <Segmented
            options={THINKING_LEVELS.map((lvl) => ({ key: lvl, label: t(THINKING_LABELS[lvl]) }))}
            value={settings.thinking?.effort ?? "medium"}
            onChange={(effort) => updateThinking({ effort })}
            disabled={!thinkingEnabled}
          />
        </div>
        <Checkbox
          label={t("thinkingKeep")}
          checked={settings.thinking?.keep === "all"}
          disabled={!thinkingEnabled}
          onChange={(checked) => updateThinking({ keep: checked ? "all" : false })}
        />
        <p className="text-xs text-gray-500">{t("thinkingContextHint")}</p>
      </Card>

      {/* Loop Control */}
      <Card title={t("loopControlSettings")}>
        <NumberField
          label={t("maxRetriesPerStep")}
          value={settings.loop_control?.max_retries_per_step ?? 3}
          onChange={(v) => updateLoopControl({ max_retries_per_step: v })}
        />
        <NumberField
          label={t("reservedContextSize")}
          value={settings.loop_control?.reserved_context_size ?? 50000}
          onChange={(v) => updateLoopControl({ reserved_context_size: v })}
        />
      </Card>

      {/* Background */}
      <Card title={t("backgroundSettings")}>
        <NumberField
          label={t("maxRunningTasks")}
          value={settings.background?.max_running_tasks}
          onChange={(v) => updateBackground({ max_running_tasks: v })}
        />
        <Checkbox
          label={t("keepAliveOnExit")}
          checked={settings.background?.keep_alive_on_exit ?? false}
          onChange={(checked) => updateBackground({ keep_alive_on_exit: checked })}
        />
      </Card>

      {/* Permission Rules */}
      <Card title={t("permissionRules")}>
        <div className="space-y-2">
          {(settings.permission?.rules ?? []).map((rule, idx) => (
            <div key={idx} className="flex items-center gap-2">
              <select
                className="bg-[#1f1f23] border border-[#2a2a2e] rounded px-2 py-1 text-sm"
                value={rule.decision ?? "allow"}
                onChange={(e) => {
                  const rules = [...(settings.permission?.rules ?? [])];
                  rules[idx] = { ...rule, decision: e.target.value as PermissionRule["decision"] };
                  setRules(rules);
                }}
              >
                {PERMISSION_DECISIONS.map((d) => (
                  <option key={d} value={d}>{t(PERMISSION_LABELS[d])}</option>
                ))}
              </select>
              <input
                type="text"
                className="flex-1 min-w-0 bg-[#1f1f23] border border-[#2a2a2e] rounded px-2 py-1 text-sm"
                value={rule.pattern ?? ""}
                placeholder={t("permissionPattern")}
                onChange={(e) => {
                  const rules = [...(settings.permission?.rules ?? [])];
                  rules[idx] = { ...rule, pattern: e.target.value };
                  setRules(rules);
                }}
              />
              <button
                type="button"
                onClick={() => {
                  const rules = [...(settings.permission?.rules ?? [])];
                  rules.splice(idx, 1);
                  setRules(rules);
                }}
                className="px-2 py-1 text-sm text-red-400 hover:bg-red-900/20 rounded"
              >
                ×
              </button>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setRules([...(settings.permission?.rules ?? []), { decision: "allow", pattern: "" }]);
            }}
            className="px-3 py-1.5 text-sm border border-[#2a2a2e] rounded hover:bg-[#252529]"
          >
            {t("addRule")}
          </button>
          <button
            type="button"
            onClick={() => {
              setRules([
                ...(settings.permission?.rules ?? []),
                { decision: "allow", pattern: "Read" },
                { decision: "deny", pattern: "Bash(rm -rf*)" },
              ]);
            }}
            className="px-3 py-1.5 text-sm border border-[#2a2a2e] rounded hover:bg-[#252529]"
          >
            {t("addCommonRules")}
          </button>
        </div>
      </Card>

      {/* Hooks */}
      <Card title={t("hooks")}>
        <div className="space-y-2">
          {(settings.hooks ?? []).map((hook, idx) => (
            <div key={idx} className="flex items-center gap-2 flex-wrap">
              <input
                list="hook-events"
                type="text"
                className="w-32 bg-[#1f1f23] border border-[#2a2a2e] rounded px-2 py-1 text-sm"
                value={hook.event ?? ""}
                placeholder={t("hookEvent")}
                onChange={(e) => {
                  const hooks = [...(settings.hooks ?? [])];
                  hooks[idx] = { ...hook, event: e.target.value };
                  setHooks(hooks);
                }}
              />
              <datalist id="hook-events">
                {COMMON_EVENTS.map((e) => <option key={e} value={e} />)}
              </datalist>
              <input
                type="text"
                className="w-24 bg-[#1f1f23] border border-[#2a2a2e] rounded px-2 py-1 text-sm"
                value={hook.matcher ?? ""}
                placeholder={t("hookMatcher")}
                onChange={(e) => {
                  const hooks = [...(settings.hooks ?? [])];
                  hooks[idx] = { ...hook, matcher: e.target.value };
                  setHooks(hooks);
                }}
              />
              <input
                type="text"
                className="flex-1 min-w-0 bg-[#1f1f23] border border-[#2a2a2e] rounded px-2 py-1 text-sm"
                value={hook.command ?? ""}
                placeholder={t("hookCommand")}
                onChange={(e) => {
                  const hooks = [...(settings.hooks ?? [])];
                  hooks[idx] = { ...hook, command: e.target.value };
                  setHooks(hooks);
                }}
              />
              <input
                type="number"
                className="w-20 bg-[#1f1f23] border border-[#2a2a2e] rounded px-2 py-1 text-sm"
                value={hook.timeout ?? ""}
                placeholder={t("hookTimeout")}
                onChange={(e) => {
                  const hooks = [...(settings.hooks ?? [])];
                  hooks[idx] = { ...hook, timeout: e.target.value === "" ? undefined : Number(e.target.value) };
                  setHooks(hooks);
                }}
              />
              <button
                type="button"
                onClick={() => {
                  const hooks = [...(settings.hooks ?? [])];
                  hooks.splice(idx, 1);
                  setHooks(hooks);
                }}
                className="px-2 py-1 text-sm text-red-400 hover:bg-red-900/20 rounded"
              >
                ×
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={() => {
            setHooks([...(settings.hooks ?? []), { event: "", matcher: "", command: "" }]);
          }}
          className="px-3 py-1.5 text-sm border border-[#2a2a2e] rounded hover:bg-[#252529]"
        >
          {t("addHook")}
        </button>
      </Card>
    </div>
  );
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="bg-[#16161a] border border-[#2a2a2e] rounded-xl p-4 space-y-3">
      <h4 className="text-gray-400 text-sm font-medium">{title}</h4>
      {children}
    </div>
  );
}

function Checkbox({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className={`flex items-center gap-2 text-sm ${disabled ? "text-gray-600" : "text-[#e5e5e7]"}`}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="rounded border-[#2a2a2e] bg-[#1f1f23] text-blue-600 focus:ring-blue-500"
      />
      {label}
    </label>
  );
}

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value?: number;
  onChange: (value: number | undefined) => void;
}) {
  return (
    <label className="flex items-center gap-3 text-sm text-[#e5e5e7]">
      <span className="text-gray-400">{label}</span>
      <input
        type="number"
        value={value ?? ""}
        onChange={(e) => {
          const raw = e.target.value;
          onChange(raw === "" ? undefined : Number(raw));
        }}
        className="w-32 bg-[#1f1f23] border border-[#2a2a2e] rounded px-2 py-1 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
      />
    </label>
  );
}

function Segmented({
  options,
  value,
  onChange,
  disabled,
}: {
  options: { key: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className={`flex items-center rounded overflow-hidden border border-[#2a2a2e] ${disabled ? "opacity-50" : ""}`}>
      {options.map((opt) => (
        <button
          key={opt.key}
          type="button"
          disabled={disabled}
          onClick={() => onChange(opt.key)}
          className={`px-3 py-1 text-sm ${
            value === opt.key
              ? "bg-blue-600 text-white"
              : "bg-[#1f1f23] text-gray-400 hover:bg-[#252529]"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/AgentSettingsPanel.tsx
git commit -m "feat: add AgentSettingsPanel component"
```

---

### Task 6: Wire AgentSettingsPanel into ProviderEdit

**Files:**
- Modify: `src/components/ProviderEdit.tsx`

- [ ] **Step 1: Update ProviderEditProps**

Add `rawOther` and `onRawOtherChange` to the props interface:

```tsx
interface ProviderEditProps {
  agent: Agent;
  provider: Provider;
  models: Model[];
  defaultModel: string | null;
  rawOther: unknown;
  onRawOtherChange: (nextRawOther: unknown) => void;
  onBack: () => void;
  // ... existing callbacks
}
```

- [ ] **Step 2: Destructure new props**

```tsx
export function ProviderEdit({
  agent,
  provider,
  models,
  defaultModel,
  rawOther,
  onRawOtherChange,
  onBack,
  // ... existing
}: ProviderEditProps) {
```

- [ ] **Step 3: Render the panel in the model mapping tab**

Locate the model mapping tab content (around the model table and "+ 添加模型映射" button) and insert `<AgentSettingsPanel />` at the bottom, conditionally for Kimi Code:

```tsx
          {agent === "kimi_code" && (
            <AgentSettingsPanel rawOther={rawOther} onChange={onRawOtherChange} />
          )}
```

- [ ] **Step 4: Commit**

```bash
git add src/components/ProviderEdit.tsx
git commit -m "feat: render AgentSettingsPanel in ProviderEdit for Kimi Code"
```

---

### Task 7: Wire ProviderEdit to App.tsx

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Pass rawOther and updater to ProviderEdit**

Find the `<ProviderEdit ... />` call and add:

```tsx
          <ProviderEdit
            agent={agent}
            provider={currentProvider}
            models={...}
            defaultModel={config.default_model}
            rawOther={config.raw_other}
            onRawOtherChange={(nextRawOther) =>
              updateConfig((cfg) => ({ ...cfg, raw_other: nextRawOther }))
            }
            // ... existing props
          />
```

- [ ] **Step 2: Commit**

```bash
git add src/App.tsx
git commit -m "chore: pass rawOther to ProviderEdit"
```

---

### Task 8: Apply smart max_context_size defaults when adding models

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Import helper in App.tsx**

In `src/App.tsx`, import:

```tsx
import { getDefaultMaxContextSize } from "./lib/model-defaults";
```

- [ ] **Step 2: Use lookup in onModelAdd**

Find the `onModelAdd` prop passed to `<ProviderEdit />` and update the default `max_context_size`:

```tsx
            onModelAdd={() => {
              const providerModels = Object.values(config.models).filter(
                (m) => m.provider === currentProvider.name
              );
              const alias = `${currentProvider.name}-${providerModels.length + 1}`;
              updateConfig((cfg) => ({
                ...cfg,
                models: {
                  ...cfg.models,
                  [alias]: {
                    alias,
                    provider: currentProvider.name,
                    model: "",
                    max_context_size: getDefaultMaxContextSize(alias),
                    display_name: null,
                    role: null,
                    supports_1m: false,
                    capabilities: [],
                  },
                },
              }));
            }}
```

- [ ] **Step 3: Use lookup in handleApplyProviderJson**

Update the model creation loop in `handleApplyProviderJson`:

```tsx
              updatedModels[alias] = {
                ...m,
                alias,
                provider: provider.name,
                max_context_size: m.max_context_size ?? getDefaultMaxContextSize(m.model),
              };
```

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx
git commit -m "feat: apply smart default max_context_size when adding models"
```

---

### Task 9: Verify with build and manual checks

- [ ] **Step 1: Type check**

```bash
npm run build
```

Expected: `tsc` and Vite build succeed.

- [ ] **Step 2: Run the app**

```bash
npm run tauri-dev
```

- [ ] **Step 3: Manual verification**

1. Kimi Code tab → edit a provider → "模型映射" tab → scroll to bottom.
2. Confirm "全局配置" panel shows 5 cards.
3. Toggle "启用思考" and verify effort/keep enable/disable.
4. Change thinking effort, save, open `~/.kimi-code/config.toml`, verify `[thinking]` block.
5. Add a permission rule and a hook, save, verify `[[permission.rules]]` and `[[hooks]]` in TOML.
6. Add a new model with alias `glm-5.2-xxx`, verify `max_context_size` defaults to `1000000`.
7. Add a new model with unknown alias, verify `max_context_size` defaults to `256000`.
8. Switch to Pi tab, confirm global settings panel is not visible.

- [ ] **Step 4: Commit any fixes**

If any fixes were needed during verification, commit them.

---

## Self-Review

- **Spec coverage:** Every requirement (5 cards, model defaults, i18n, Kimi-only visibility, manual override) maps to a task.
- **Placeholder scan:** No TBD/TODO/fill-in-details; all code is shown.
- **Type consistency:** `AgentSettings`, helper signatures, and component props match across tasks.
