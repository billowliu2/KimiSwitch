import { useEffect, useReducer, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "../i18n";
import type { TranslationKey } from "../i18n/zh";
import { getAgentSettings, setAgentSettings } from "../lib/agent-settings";
import { getModelRef, modelsDevReady } from "../lib/models-dev";
import { modelWireName } from "../lib/model-effective";
import {
  THINKING_EFFORTS,
  readSupportEfforts,
  resolveThinkingEffortSupport,
  type EffortAvailability,
} from "../lib/thinking-efforts";
import type {
  AgentSettings,
  ExperimentalEnvStatus,
  Hook,
  Model,
  PermissionRule,
} from "../types";
import { Card, Checkbox, NumberField, Segmented } from "./ui/controls";

interface AgentSettingsPanelProps {
  rawOther: unknown;
  onChange: (nextRawOther: unknown) => void;
  /** Configured models (alias → entry) — used to resolve effort support. */
  models?: Record<string, Model>;
  /** Alias of the model the effort tier actually applies to. */
  defaultModel?: string | null;
}

const THINKING_LABELS: Record<(typeof THINKING_EFFORTS)[number], TranslationKey> = {
  low: "thinkingLow",
  medium: "thinkingMedium",
  high: "thinkingHigh",
  max: "thinkingMax",
  xhigh: "thinkingXHigh",
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

export function AgentSettingsPanel({ rawOther, onChange, models, defaultModel }: AgentSettingsPanelProps) {
  const { t } = useTranslation();
  const settings = getAgentSettings(rawOther);
  /**
   * KIMI_CODE_LEGACY_FLAG=1 keeps the v1 loop_control keys dual-written for
   * v1-engine users; the default (v2) writes only max_attempts_per_step.
   */
  const [legacyV1, setLegacyV1] = useState(false);
  // The models.dev index loads in the background; re-render once it lands so
  // the reasoning flag can disable the thinking area.
  const [, forceModelsDevReady] = useReducer((x: number) => x + 1, 0);

  useEffect(() => {
    invoke<ExperimentalEnvStatus>("get_experimental_env_status")
      .then((env) => {
        const value = env?.KIMI_CODE_LEGACY_FLAG ?? "";
        setLegacyV1(["1", "true", "yes", "on"].includes(value.trim().toLowerCase()));
      })
      .catch(() => setLegacyV1(false));
  }, []);

  useEffect(() => {
    // The panel only needs the flag once; App owns the permanent
    // onModelsDevReady listener for later hot swaps.
    let alive = true;
    modelsDevReady().then(() => {
      if (alive) forceModelsDevReady();
    });
    return () => {
      alive = false;
    };
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

  const updateTask = (patch: Partial<AgentSettings["task"]>) => {
    update({ task: { ...settings.task, ...patch } });
  };

  const updateScalar = <K extends "workspace" | "database" | "mcp" | "read">(
    key: K,
    patch: Partial<NonNullable<AgentSettings[K]>>
  ) => {
    update({ [key]: { ...settings[key], ...patch } } as Partial<AgentSettings>);
  };

  const updateWatch = (patch: Partial<AgentSettings["watch"]>) => {
    update({ watch: { ...settings.watch, ...patch } });
  };

  const setRules = (rules: PermissionRule[]) => {
    update({ permission: { rules } });
  };

  const setHooks = (hooks: Hook[]) => {
    update({ hooks });
  };

  const thinkingEnabled = settings.thinking?.enabled ?? true;

  // Which tiers the current default model accepts: `[models."<alias>"]
  // support_efforts` first, then the models.dev `reasoning` flag.
  const defaultEntry = defaultModel ? models?.[defaultModel] : undefined;
  const effortSupport = resolveThinkingEffortSupport({
    supportEfforts: readSupportEfforts(defaultEntry),
    reasoning: defaultEntry ? getModelRef(modelWireName(defaultEntry))?.reasoning : undefined,
  });

  const effortNote = (availability: EffortAvailability): string | undefined => {
    const note = availability.note;
    if (!note) return undefined;
    if (note.kind === "thinkingUnsupported") return t("thinkingEffortUnsupported");
    if (note.kind === "tierUnsupported") {
      return t("thinkingEffortTierUnsupported", { levels: note.supported.join(", ") });
    }
    return t("thinkingEffortTierUndeclared");
  };

  // Upstream takes a free-form string: keep a hand-written tier visible and
  // selectable instead of dropping it from the control. The "medium" fallback
  // is display-only — `settings.thinking.effort` stays undefined while the
  // config has no `[thinking] effort` key, so picking a tier here is what
  // writes it (an unmaterialized default must not shadow a per-model
  // `default_effort`; see lib/agent-settings.ts).
  const effort = settings.thinking?.effort ?? "medium";
  const effortOptions: {
    key: string;
    label: string;
    disabled?: boolean;
    title?: string;
  }[] = THINKING_EFFORTS.map((tier) => ({
    key: tier,
    label: t(THINKING_LABELS[tier]),
    disabled: !effortSupport.levels[tier].enabled,
    title: effortNote(effortSupport.levels[tier]),
  }));
  if (!THINKING_EFFORTS.includes(effort as (typeof THINKING_EFFORTS)[number])) {
    effortOptions.push({ key: effort, label: effort });
  }

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
            options={effortOptions}
            value={effort}
            onChange={(next) => updateThinking({ effort: next })}
            disabled={!thinkingEnabled || !effortSupport.thinkingSupported}
          />
        </div>
        {!effortSupport.thinkingSupported && (
          <p className="text-xs text-amber-500 dark:text-amber-400">
            {t("thinkingEffortUnsupported")}
          </p>
        )}
        <p className="text-xs text-content-muted">
          {t("thinkingEffortDependsOnDefaultModel")}
        </p>
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
        {/* kimi-code 0.43.0+ `loop_control.compaction_max_attempts`. The
            upstream default is 5; an empty field or 0 removes the key instead
            of writing a literal 0 (see setAgentSettings). */}
        <NumberField
          label={t("compactionMaxAttempts")}
          value={settings.loop_control?.compaction_max_attempts ?? 5}
          onChange={(v) => updateLoopControl({ compaction_max_attempts: v })}
        />
        <p className="text-xs text-content-muted">{t("compactionMaxAttemptsHint")}</p>
      </Card>

      <Card title={t("backgroundSettings")}>
        {/* kimi-code 2.4.0 renamed this section `[background]` → `[task]`;
            upstream still merges the legacy name in, field by field with
            `[task]` winning, so the values shown here come from the merged
            view (getAgentSettings → resolveTaskSection). Writes always target
            `[task]` and migrate/drop `[background]` (see setAgentSettings). */}
        <NumberField
          label={t("maxRunningTasks")}
          value={settings.task?.max_running_tasks}
          onChange={(v) => updateTask({ max_running_tasks: v })}
        />
        <p className="text-xs text-content-muted">{t("maxRunningTasksDesc")}</p>
        <Checkbox
          label={t("keepAliveOnExit")}
          checked={settings.task?.keep_alive_on_exit ?? false}
          onChange={(checked) => updateTask({ keep_alive_on_exit: checked })}
        />
        <p className="text-xs text-content-muted">{t("keepAliveOnExitDesc")}</p>
        <Checkbox
          label={t("bashAutoBackgroundOnTimeout")}
          checked={settings.task?.bash_auto_background_on_timeout ?? true}
          onChange={(checked) =>
            updateTask({ bash_auto_background_on_timeout: checked })
          }
        />
        <p className="text-xs text-content-muted">
          {t("bashAutoBackgroundOnTimeoutDesc")}
        </p>
        <NumberField
          label={t("bashTaskTimeoutS")}
          value={settings.task?.bash_task_timeout_s}
          onChange={(v) => updateTask({ bash_task_timeout_s: v })}
        />
        <p className="text-xs text-content-muted">{t("bashTaskTimeoutSDesc")}</p>
        <NumberField
          label={t("killGracePeriodMs")}
          value={settings.task?.kill_grace_period_ms}
          onChange={(v) => updateTask({ kill_grace_period_ms: v })}
        />
        <p className="text-xs text-content-muted">{t("killGracePeriodMsDesc")}</p>
        {/* print mode only (`kimi -p`): grouped behind a disclosure so the
            interactive-mode defaults stay out of the way. */}
        <details className="pt-1">
          <summary className="text-sm text-content-muted cursor-pointer">
            {t("taskPrintModeSection")}
          </summary>
          <div className="mt-2 space-y-3">
            <p className="text-xs text-content-muted">
              {t("taskPrintModeSectionDesc")}
            </p>
            <label className="flex items-center gap-3 text-sm text-content-primary">
              <span className="text-content-muted">{t("printBackgroundMode")}</span>
              <select
                className="bg-input border border-border rounded px-2 py-1 text-sm"
                value={settings.task?.print_background_mode ?? "steer"}
                onChange={(e) =>
                  updateTask({
                    print_background_mode: e.target
                      .value as NonNullable<
                      AgentSettings["task"]
                    >["print_background_mode"],
                  })
                }
              >
                <option value="steer">{t("printBackgroundSteer")}</option>
                <option value="drain">{t("printBackgroundDrain")}</option>
                <option value="exit">{t("printBackgroundExit")}</option>
              </select>
            </label>
            <p className="text-xs text-content-muted">
              {t("printBackgroundModeDesc")}
            </p>
            <NumberField
              label={t("printWaitCeilingS")}
              value={settings.task?.print_wait_ceiling_s}
              onChange={(v) => updateTask({ print_wait_ceiling_s: v })}
            />
            <p className="text-xs text-content-muted">
              {t("printWaitCeilingSDesc")}
            </p>
            <NumberField
              label={t("printMaxTurns")}
              value={settings.task?.print_max_turns}
              onChange={(v) => updateTask({ print_max_turns: v })}
            />
            <p className="text-xs text-content-muted">{t("printMaxTurnsDesc")}</p>
          </div>
        </details>
      </Card>

      <Card title={t("workspaceTrustSettings")}>
        {/* kimi-code 2.5.0 `[workspace] require_trust` (upstream #4517).
            Upstream default true, so an unticked box writes
            require_trust = false and a ticked one removes the key. This one is
            a security switch: with trust prompts off, project-level MCP servers
            and other trust-gated project config load unchecked. */}
        <Checkbox
          label={t("workspaceRequireTrust")}
          checked={settings.workspace?.require_trust ?? true}
          onChange={(checked) =>
            updateScalar("workspace", { require_trust: checked })
          }
        />
        <p className="text-xs text-content-muted">
          {t("workspaceRequireTrustDesc")}
        </p>
        {settings.workspace?.require_trust === false && (
          <p className="text-xs text-amber-500 dark:text-amber-400">
            {t("workspaceRequireTrustWarning")}
          </p>
        )}
      </Card>

      <Card title={t("databaseSettings")}>
        {/* kimi-code 2.5.0: `[database] global_search` now defaults to false
            (it used to be on), so only a checked box writes the key. */}
        <Checkbox
          label={t("databaseGlobalSearch")}
          checked={settings.database?.global_search ?? false}
          onChange={(checked) =>
            updateScalar("database", { global_search: checked })
          }
        />
        <p className="text-xs text-content-muted">
          {t("databaseGlobalSearchDesc")}
        </p>
      </Card>

      <Card title={t("mcpSettings")}>
        {/* kimi-code 2.4.0 (upstream #4283) workspace-level MCP reconnect
            backoff. Both keys have non-zero defaults, so an emptied field
            leaves the key out instead of writing a 0 the section schema
            rejects (min 1). */}
        <NumberField
          label={t("mcpReconnectInitialDelayMs")}
          value={settings.mcp?.reconnect_initial_delay_ms}
          onChange={(v) =>
            updateScalar("mcp", { reconnect_initial_delay_ms: v })
          }
        />
        <p className="text-xs text-content-muted">
          {t("mcpReconnectInitialDelayMsDesc")}
        </p>
        <NumberField
          label={t("mcpReconnectMaxDelayMs")}
          value={settings.mcp?.reconnect_max_delay_ms}
          onChange={(v) => updateScalar("mcp", { reconnect_max_delay_ms: v })}
        />
        <p className="text-xs text-content-muted">
          {t("mcpReconnectMaxDelayMsDesc")}
        </p>
      </Card>

      <Card title={t("readSettings")}>
        {/* `[read]`: upstream 2.4.1 lowered max_chars from 500000 to 100000.
            Both keys are positive ints upstream — 0 / empty removes the key
            rather than pinning an invalid value. */}
        <NumberField
          label={t("readMaxChars")}
          value={settings.read?.max_chars}
          onChange={(v) => updateScalar("read", { max_chars: v })}
        />
        <p className="text-xs text-content-muted">{t("readMaxCharsDesc")}</p>
        <NumberField
          label={t("readDefaultMaxChars")}
          value={settings.read?.default_max_chars}
          onChange={(v) => updateScalar("read", { default_max_chars: v })}
        />
        <p className="text-xs text-content-muted">
          {t("readDefaultMaxCharsDesc")}
        </p>
      </Card>

      <Card title={t("watchSettings")}>
        {/* Top-level `[watch] enabled` (kimi-code 2.0.1+; 2.0.2 flipped the
            default off, #4015 flipped it back on). KIMI_CODE_WATCH outranks
            this config at runtime — the env var is probed by
            get_experimental_env_status as a non-flag entry but deliberately
            locks nothing here, the toggle just documents the config value
            that applies when the env var is unset. */}
        <Checkbox
          label={t("watchEnabled")}
          checked={settings.watch?.enabled ?? true}
          onChange={(checked) => updateWatch({ enabled: checked })}
        />
        <p className="text-xs text-content-muted">{t("watchEnabledDesc")}</p>
      </Card>

      <Card title={t("behaviorSettings")}>
        {/* Top-level booleans. auto_session_title / repeat_breaker default to
            true upstream: false is written explicitly, true removes the key.
            disable_feedback_survey (kimi-code 2.3.0) is the inverse — its
            upstream default is false (survey on), so only true is written and
            unchecking removes the key (see setAgentSettings). */}
        <Checkbox
          label={t("autoSessionTitle")}
          checked={settings.auto_session_title ?? true}
          onChange={(checked) => update({ auto_session_title: checked })}
        />
        <p className="text-xs text-content-muted">{t("autoSessionTitleDesc")}</p>
        <Checkbox
          label={t("repeatBreaker")}
          checked={settings.repeat_breaker ?? true}
          onChange={(checked) => update({ repeat_breaker: checked })}
        />
        <p className="text-xs text-content-muted">{t("repeatBreakerDesc")}</p>
        <Checkbox
          label={t("disableFeedbackSurvey")}
          checked={settings.disable_feedback_survey ?? false}
          onChange={(checked) => update({ disable_feedback_survey: checked })}
        />
        <p className="text-xs text-content-muted">
          {t("disableFeedbackSurveyDesc")}
        </p>
      </Card>

      <Card title={t("permissionRules")}>
        {/* kimi-code `[permission] dangerous_command_guard`. The env
            var KIMI_CODE_DANGEROUS_COMMAND_GUARD (literal "true"/"false")
            outranks this config at runtime; no env-lock UI here (deliberate
            minimal scope). Absent key = upstream default on. Since
            kimi-code 0.41.0 the guard only gates Manual/YOLO modes —
            Auto (never-ask) mode no longer intercepts dangerous
            commands. Since kimi-code 2.3.0 the switch gates all three
            built-in ask policies — dangerous command, sensitive file, and
            git control path — not just the dangerous-command guard. */}
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
