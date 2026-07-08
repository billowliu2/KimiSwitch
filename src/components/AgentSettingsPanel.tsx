import type { ReactNode } from "react";
import { useTranslation } from "../i18n";
import type { TranslationKey } from "../i18n/zh";
import { getAgentSettings, setAgentSettings } from "../lib/agent-settings";
import type { AgentSettings, Hook, PermissionRule } from "../types";

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

      <Card title={t("enableThinking")}>
        <Checkbox
          label={t("enableThinking")}
          checked={thinkingEnabled}
          onChange={(checked) => updateThinking({ enabled: checked })}
        />
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-sm text-gray-400">{t("thinkingLevel")}</span>
          <Segmented
            options={THINKING_LEVELS.map((lvl) => ({
              key: lvl,
              label: t(THINKING_LABELS[lvl]),
            }))}
            value={settings.thinking?.effort ?? "medium"}
            onChange={(effort) =>
              updateThinking({ effort: effort as AgentSettings["thinking"]["effort"] })
            }
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

      <Card title={t("permissionRules")}>
        <div className="space-y-2">
          {(settings.permission?.rules ?? []).map((rule, idx) => (
            <div key={idx} className="flex items-center gap-2">
              <select
                className="bg-[#1f1f23] border border-[#2a2a2e] rounded px-2 py-1 text-sm"
                value={rule.decision ?? "allow"}
                onChange={(e) => {
                  const rules = [...(settings.permission?.rules ?? [])];
                  rules[idx] = {
                    ...rule,
                    decision: e.target.value as PermissionRule["decision"],
                  };
                  setRules(rules);
                }}
              >
                {PERMISSION_DECISIONS.map((d) => (
                  <option key={d} value={d}>
                    {t(PERMISSION_LABELS[d])}
                  </option>
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
              setRules([
                ...(settings.permission?.rules ?? []),
                { decision: "allow", pattern: "" },
              ]);
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
                {COMMON_EVENTS.map((e) => (
                  <option key={e} value={e} />
                ))}
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
                  hooks[idx] = {
                    ...hook,
                    timeout: e.target.value === "" ? undefined : Number(e.target.value),
                  };
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
    <label
      className={`flex items-center gap-2 text-sm ${
        disabled ? "text-gray-600" : "text-[#e5e5e7]"
      }`}
    >
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
    <div
      className={`flex items-center rounded overflow-hidden border border-[#2a2a2e] ${
        disabled ? "opacity-50" : ""
      }`}
    >
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
