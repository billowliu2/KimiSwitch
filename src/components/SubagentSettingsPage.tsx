import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "../i18n";
import type { TranslationKey } from "../i18n/zh";
import type { ExperimentalEnvStatus, Model } from "../types";
import {
  EXPERIMENTAL_FLAGS,
  clearSecondaryModel,
  forcedEnvValue,
  getExperimentalFlags,
  getSecondaryModel,
  isFlagLockedByEnv,
  isMasterEnvOn,
  setExperimentalFlag,
  setSecondaryModelOnly,
  type ExperimentalFlagDef,
} from "../lib/subagent-settings";
import { Card, Toggle } from "./ui/controls";

interface SubagentSettingsPageProps {
  /** config.raw_other — hosts the `[experimental]` and `[secondary_model]` sections. */
  rawOther: unknown;
  /** All configured models (alias → entry) for the secondary-model picker. */
  models: Record<string, Model>;
  onChange: (nextRawOther: unknown) => void;
  onBack: () => void;
}

const EFFORTS = ["low", "medium", "high", "max"] as const;
const EFFORT_LABELS: Record<(typeof EFFORTS)[number], TranslationKey> = {
  low: "thinkingLow",
  medium: "thinkingMedium",
  high: "thinkingHigh",
  max: "thinkingMax",
};

const FLAG_LABELS: Record<string, { name: TranslationKey; desc: TranslationKey }> = {
  "secondary-model": { name: "flagSecondaryModel", desc: "flagSecondaryModelDesc" },
  "tool-select": { name: "flagToolSelect", desc: "flagToolSelectDesc" },
  "acp-v2": { name: "flagAcpV2", desc: "flagAcpV2Desc" },
  persistence_minidb_readmodel: {
    name: "flagMinidbReadmodel",
    desc: "flagMinidbReadmodelDesc",
  },
};

export function SubagentSettingsPage({
  rawOther,
  models,
  onChange,
  onBack,
}: SubagentSettingsPageProps) {
  const { t } = useTranslation();
  const [env, setEnv] = useState<ExperimentalEnvStatus | null>(null);

  useEffect(() => {
    invoke<ExperimentalEnvStatus>("get_experimental_env_status")
      .then(setEnv)
      .catch(() => setEnv({}));
  }, []);

  const flags = getExperimentalFlags(rawOther);
  const secondary = getSecondaryModel(rawOther);
  const masterOn = isMasterEnvOn(env);
  const secondaryFlag = EXPERIMENTAL_FLAGS[0]; // "secondary-model"
  const otherFlags = EXPERIMENTAL_FLAGS.slice(1);

  /** Effective state of the secondary-model flag (env overrides config). */
  const secondaryEnabled = masterOn
    ? true
    : isFlagLockedByEnv(env, secondaryFlag)
      ? forcedEnvValue(env, secondaryFlag)
      : flags["secondary-model"] === true;
  const secondaryLocked = masterOn || isFlagLockedByEnv(env, secondaryFlag);

  const aliasList = Object.keys(models).sort();

  // Inherited settings shown for the picked model: subagents bind the pointed
  // entry directly (no patch fields), so context size and effort come from the
  // model entry / global [thinking], not from a `[secondary_model]` patch.
  const selectedEntry = secondary.model ? models[secondary.model] : undefined;
  const inheritedContext = selectedEntry?.max_context_size;
  const modelEffort =
    selectedEntry &&
    typeof (selectedEntry.raw_other as Record<string, unknown> | undefined)
      ?.default_effort === "string"
      ? ((selectedEntry.raw_other as Record<string, unknown>).default_effort as string)
      : undefined;
  const thinkingEffort = (() => {
    const ro = rawOther as Record<string, unknown> | undefined;
    const thinking = ro?.thinking as Record<string, unknown> | undefined;
    return thinking && typeof thinking.effort === "string" && thinking.effort
      ? thinking.effort
      : undefined;
  })();
  const inheritedEffort = modelEffort ?? thinkingEffort;

  const fmtContext = (n: number): string =>
    n >= 1_000_000
      ? `${(n / 1_000_000).toFixed(1)}M`
      : n >= 1000
        ? `${Math.round(n / 1000)}K`
        : String(n);
  const effortLabel = (e: string): string => {
    const key = EFFORT_LABELS[e as (typeof EFFORTS)[number]];
    return key ? t(key) : e;
  };

  const renderFlagRow = (flag: ExperimentalFlagDef) => {
    const labels = FLAG_LABELS[flag.id];
    const locked = masterOn || isFlagLockedByEnv(env, flag);
    const on = masterOn
      ? true
      : isFlagLockedByEnv(env, flag)
        ? forcedEnvValue(env, flag)
        : flags[flag.id] === true;
    return (
      <div key={flag.id} className="flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <div className="text-sm text-content-primary">{t(labels.name)}</div>
          <div className="text-xs text-content-muted">
            {t(labels.desc)}
            <code className="ml-2">{flag.envVar}</code>
          </div>
        </div>
        {locked && (
          <span className="text-xs text-content-muted shrink-0">
            🔒 {t("lockedByEnv")}
          </span>
        )}
        <Toggle
          checked={on}
          disabled={locked}
          ariaLabel={t(labels.name)}
          onChange={(checked) =>
            onChange(setExperimentalFlag(rawOther, flag.id, checked))
          }
        />
      </div>
    );
  };

  return (
    <div className="h-full flex flex-col bg-app">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-panel">
        <button
          type="button"
          onClick={onBack}
          className="p-2 rounded-lg hover:bg-hover-2 focus:ring-2 focus:ring-blue-500 focus:outline-none"
        >
          ← {t("back")}
        </button>
        <h2 className="font-semibold text-lg">{t("subagentSettings")}</h2>
      </div>

      <div className="flex-1 overflow-auto p-6 space-y-4">
        {masterOn && (
          <div className="bg-green-100 dark:bg-green-900/20 border border-green-300 dark:border-green-500/30 rounded-lg px-4 py-2 text-sm text-green-700 dark:text-green-400">
            {t("masterEnvOnHint")}
          </div>
        )}

        {/* Subagent: secondary model picker + inherited settings */}
        <Card title={t("secondaryModelSection")}>
          <label className="flex items-center gap-3 text-sm text-content-primary">
            <span className="text-content-muted">{t("secondaryModelLabel")}</span>
            <select
              className="flex-1 max-w-md bg-input border border-border rounded px-2 py-1 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
              value={secondary.model ?? ""}
              onChange={(e) => {
                const alias = e.target.value;
                if (alias === "") {
                  onChange(clearSecondaryModel(rawOther));
                } else {
                  // Only the model reference is persisted — no patch fields.
                  // Subagents bind the pointed entry directly and inherit its
                  // settings; usage records stay keyed on the real alias
                  // instead of Kimi Code's synthesized `__secondary__` entry.
                  onChange(setSecondaryModelOnly(rawOther, alias));
                }
              }}
            >
              <option value="">{t("secondaryModelUnset")}</option>
              {aliasList.map((alias) => (
                <option key={alias} value={alias}>
                  {models[alias]?.display_name
                    ? `${alias}（${models[alias].display_name}）`
                    : alias}
                </option>
              ))}
            </select>
          </label>

          <div className="border-t border-border" />
          <div className="flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <div className="text-xs text-content-muted">
                {t(FLAG_LABELS[secondaryFlag.id].desc)}
                <code className="ml-2">{secondaryFlag.envVar}</code>
              </div>
            </div>
            {secondaryLocked && (
              <span className="text-xs text-content-muted shrink-0">
                🔒 {t("lockedByEnv")}
              </span>
            )}
            <Toggle
              checked={secondaryEnabled}
              disabled={secondaryLocked}
              ariaLabel={t(FLAG_LABELS[secondaryFlag.id].name)}
              onChange={(checked) =>
                onChange(setExperimentalFlag(rawOther, secondaryFlag.id, checked))
              }
            />
          </div>

          {secondary.model !== undefined && (
            <div className="rounded-lg border border-border bg-input/40 px-3 py-2.5 space-y-2">
              <div className="flex items-baseline gap-2 text-sm">
                <span className="shrink-0 text-content-muted">
                  {t("secondaryModelInheritedContext")}
                </span>
                <span className="font-medium text-content-primary">
                  {inheritedContext ? fmtContext(inheritedContext) : "—"}
                </span>
              </div>
              <div className="flex items-baseline gap-2 text-sm">
                <span className="shrink-0 text-content-muted">
                  {t("secondaryModelInheritedEffort")}
                </span>
                <span className="font-medium text-content-primary">
                  {inheritedEffort ? effortLabel(inheritedEffort) : "—"}
                </span>
              </div>
              <p className="text-xs text-content-muted">
                {t("secondaryModelInheritedHint")}
              </p>
            </div>
          )}

          <p className="text-xs text-content-muted">{t("secondaryModelPriorityHint")}</p>
        </Card>

        {/* Other experimental features (not subagent-related) */}
        <Card title={t("otherExperimentalFlags")}>
          {otherFlags.map(renderFlagRow)}
          <p className="text-xs text-content-muted">{t("experimentalFlagsHint")}</p>
        </Card>
      </div>
    </div>
  );
}
