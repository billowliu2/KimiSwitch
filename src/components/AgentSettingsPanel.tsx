import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "../i18n";
import type { TranslationKey } from "../i18n/zh";
import { getAgentSettings, setAgentSettings } from "../lib/agent-settings";
import type {
  AgentSettings,
  ExperimentalEnvStatus,
  Hook,
  PermissionRule,
} from "../types";
import { Card, Checkbox, NumberField, Segmented } from "./ui/controls";

interface AgentSettingsPanelProps {
  rawOther: unknown;
  onChange: (nextRawOther: unknown) => void;
}

// Upstream removed the "max" effort tier (auto-migrates to "high").
const THINKING_LEVELS = ["low", "medium", "high"] as const;
const THINKING_LABELS: Record<(typeof THINKING_LEVELS)[number], TranslationKey> = {
  low: "thinkingLow",
  medium: "thinkingMedium",
  high: "thinkingHigh",
};

const PERMISSION_DECISIONS = ["allow", "deny", "ask"] as const;
const PERMISSION_LABELS: Record<(typeof PERMISSION_DECISIONS)[number], TranslationKey> = {
  allow: "permissionAllow",
  deny: "permissionDeny",
  ask: "permissionAsk",
};

// kimi-code 0.33+ added TurnStarted / UserPromptQueued / TaskStarted /
// SessionHeartbeat hook events (plus SessionStart / SessionEnd).
const COMMON_EVENTS = [
  "PreToolUse",
  "PostToolUse",
  "TurnStarted",
  "UserPromptQueued",
  "TaskStarted",
  "SessionHeartbeat",
  "SessionStart",
  "SessionEnd",
] as const;

export function AgentSettingsPanel({ rawOther, onChange }: AgentSettingsPanelProps) {
  const { t } = useTranslation();
  const settings = getAgentSettings(rawOther);
  /**
   * KIMI_CODE_LEGACY_FLAG=1 keeps the v1 loop_control keys dual-written for
   * v1-engine users; the default (v2) writes only max_attempts_per_step.
   */
  const [legacyV1, setLegacyV1] = useState(false);

  useEffect(() => {
    invoke<ExperimentalEnvStatus>("get_experimental_env_status")
      .then((env) => {
        const value = env?.KIMI_CODE_LEGACY_FLAG ?? "";
        setLegacyV1(["1", "true", "yes", "on"].includes(value.trim().toLowerCase()));
      })
      .catch(() => setLegacyV1(false));
  }, []);

  const update = (patch: Partial<AgentSettings>) => {
    onChange(setAgentSettings(rawOther, patch, { legacyV1 }));
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
      <h3 className="text-content-muted text-sm font-medium">{t("agentSettings")}</h3>

      <Card title={t("enableThinking")}>
        <Checkbox
          label={t("enableThinking")}
          checked={thinkingEnabled}
          onChange={(checked) => updateThinking({ enabled: checked })}
        />
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-sm text-content-muted">{t("thinkingLevel")}</span>
          <Segmented
            options={THINKING_LEVELS.map((lvl) => ({
              key: lvl,
              label: t(THINKING_LABELS[lvl]),
            }))}
            value={settings.thinking?.effort ?? "medium"}
            onChange={(effort) =>
              updateThinking({ effort: effort as NonNullable<AgentSettings["thinking"]>["effort"] })
            }
            disabled={!thinkingEnabled}
          />
        </div>
        <Checkbox
          label={t("thinkingKeep")}
          checked={settings.thinking?.keep === "all"}
          disabled={!thinkingEnabled}
          onChange={(checked) => updateThinking({ keep: checked ? "all" : "off" })}
        />
        <p className="text-xs text-content-muted">{t("thinkingContextHint")}</p>
      </Card>

      <Card title={t("loopControlSettings")}>
        <NumberField
          label={t("maxAttemptsPerStep")}
          value={
            settings.loop_control?.max_attempts_per_step ??
            settings.loop_control?.max_retries_per_step ??
            3
          }
          onChange={(v) =>
            updateLoopControl({
              max_attempts_per_step: v,
              max_retries_per_step: v,
            })
          }
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
        {/* kimi-code `[permission] dangerous_command_guard`. The env
            var KIMI_CODE_DANGEROUS_COMMAND_GUARD (literal "true"/"false")
            outranks this config at runtime; no env-lock UI here (deliberate
            minimal scope). Absent key = upstream default on. Since
            kimi-code 0.41.0 the guard only gates Manual/YOLO modes —
            Auto (never-ask) mode no longer intercepts dangerous
            commands. */}
        <Checkbox
          label={t("permissionDangerousGuard")}
          checked={settings.permission?.dangerous_command_guard ?? true}
          onChange={(checked) =>
            update({
              permission: {
                ...settings.permission,
                dangerous_command_guard: checked,
              },
            })
          }
        />
        <p className="text-xs text-content-muted">
          {t("permissionDangerousGuardDesc")}
        </p>
        <div className="space-y-2">
          {(settings.permission?.rules ?? []).map((rule, idx) => (
            <div key={idx} className="flex items-center gap-2">
              <select
                className="bg-input border border-border rounded px-2 py-1 text-sm"
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
                className="flex-1 min-w-0 bg-input border border-border rounded px-2 py-1 text-sm"
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
            className="px-3 py-1.5 text-sm border border-border rounded hover:bg-hover-2"
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
            className="px-3 py-1.5 text-sm border border-border rounded hover:bg-hover-2"
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
                className="w-32 bg-input border border-border rounded px-2 py-1 text-sm"
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
                className="w-24 bg-input border border-border rounded px-2 py-1 text-sm"
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
                className="flex-1 min-w-0 bg-input border border-border rounded px-2 py-1 text-sm"
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
                className="w-20 bg-input border border-border rounded px-2 py-1 text-sm"
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
          className="px-3 py-1.5 text-sm border border-border rounded hover:bg-hover-2"
        >
          {t("addHook")}
        </button>
      </Card>
    </div>
  );
}
