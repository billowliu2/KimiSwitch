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
  getSubagentModelPool,
  isExperimentalFlagSet,
  isFlagLockedByEnv,
  isMasterEnvOn,
  removeSubagentPoolEntry,
  setExperimentalFlag,
  setSecondaryModelOnly,
  setSubagentDefault,
  setSubagentForce,
  upsertSubagentPoolEntry,
  validateSubagentPool,
  type ExperimentalFlagDef,
  type PoolValidationError,
  type ValidationErrorKey,
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

// Upstream removed the "max" effort tier (auto-migrates to "high").
const EFFORTS = ["low", "medium", "high"] as const;
const EFFORT_LABELS: Record<(typeof EFFORTS)[number], TranslationKey> = {
  low: "thinkingLow",
  medium: "thinkingMedium",
  high: "thinkingHigh",
};

const FLAG_LABELS: Record<string, { name: TranslationKey; desc: TranslationKey }> = {
  "secondary-model": { name: "flagSecondaryModel", desc: "flagSecondaryModelDesc" },
  "tool-select": { name: "flagToolSelect", desc: "flagToolSelectDesc" },
  persistence_minidb_readmodel: {
    name: "flagMinidbReadmodel",
    desc: "flagMinidbReadmodelDesc",
  },
  tower: { name: "flagTower", desc: "flagTowerDesc" },
  subagent_fork: { name: "flagSubagentFork", desc: "flagSubagentForkDesc" },
  wait_for: { name: "flagWaitFor", desc: "flagWaitForDesc" },
  auto_session_title: {
    name: "flagAutoSessionTitle",
    desc: "flagAutoSessionTitleDesc",
  },
  "remote-control": { name: "flagRemoteControl", desc: "flagRemoteControlDesc" },
};

/** Validation-error i18n key per engine rule, for the pre-write self-check. */
const POOL_ERROR_KEYS: Record<ValidationErrorKey, TranslationKey> = {
  primaryReserved: "secondaryPoolErrorPrimaryReserved",
  defaultRequired: "secondaryPoolErrorDefaultRequired",
  defaultNotInPool: "secondaryPoolErrorDefaultNotInPool",
  aliasNotInModels: "secondaryPoolErrorAliasNotInModels",
  forceRequiresDefault: "secondaryPoolErrorForceRequiresDefault",
  forceExcludesModels: "secondaryPoolErrorForceExcludesModels",
};

/**
 * One row of the subagent model pool: default radio + alias + editable
 * description (saved on blur/Enter via the parent's write chain) + remove.
 * The description input keeps a local draft so typing is not persisted per
 * keystroke; everything else is derived from `rawOther` on each render.
 */
function PoolEntryRow({
  alias,
  displayName,
  description,
  isDefault,
  canRemove,
  onSetDefault,
  onSave,
  onRemove,
}: {
  alias: string;
  displayName: string | null;
  description: string;
  isDefault: boolean;
  canRemove: boolean;
  onSetDefault: (alias: string) => void;
  onSave: (alias: string, description: string) => void;
  onRemove: (alias: string) => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(description);

  const commit = () => {
    if (draft === description) return;
    onSave(alias, draft);
  };

  return (
    <div className="flex items-center gap-2 text-sm">
      <input
        type="radio"
        checked={isDefault}
        aria-label={t("setDefault")}
        onChange={() => onSetDefault(alias)}
        className="shrink-0 accent-blue-600 focus:ring-blue-500"
      />
      <span className="shrink-0 font-medium text-content-primary">{alias}</span>
      {displayName && (
        <span className="shrink-0 text-xs text-content-muted">{displayName}</span>
      )}
      {isDefault && (
        <span className="shrink-0 text-xs text-blue-600 dark:text-blue-400 border border-blue-500/30 rounded px-1">
          {t("default")}
        </span>
      )}
      <input
        type="text"
        value={draft}
        placeholder={t("secondaryPoolDescPlaceholder")}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            (e.currentTarget as HTMLInputElement).blur();
          } else if (e.key === "Escape") {
            setDraft(description);
            (e.currentTarget as HTMLInputElement).blur();
          }
        }}
        className="flex-1 min-w-0 bg-input border border-border rounded px-2 py-1 text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none"
      />
      {canRemove && (
        <button
          type="button"
          onClick={() => onRemove(alias)}
          className="shrink-0 px-2 py-1 text-xs border border-border rounded hover:bg-hover-2 text-content-muted focus:ring-2 focus:ring-blue-500 focus:outline-none"
        >
          {t("secondaryPoolRemove")}
        </button>
      )}
    </div>
  );
}

export function SubagentSettingsPage({
  rawOther,
  models,
  onChange,
  onBack,
}: SubagentSettingsPageProps) {
  const { t } = useTranslation();
  const [env, setEnv] = useState<ExperimentalEnvStatus | null>(null);
  /** Pre-write validation failures (fallback guard; normal flows stay clear). */
  const [poolErrors, setPoolErrors] = useState<PoolValidationError[]>([]);
  /** Local draft for the "add pool entry" select (reset after each pick). */
  const [addSelection, setAddSelection] = useState("");

  useEffect(() => {
    invoke<ExperimentalEnvStatus>("get_experimental_env_status")
      .then(setEnv)
      .catch(() => setEnv({}));
  }, []);

  const flags = getExperimentalFlags(rawOther);
  const pool = getSubagentModelPool(rawOther);
  const poolKeys = pool ? Object.keys(pool.models) : [];
  // View selection: no/empty section or a bare legacy `model` → simple view;
  // a `models` table or `default_model` → pool management view.
  const isPoolView =
    !!pool && (poolKeys.length > 0 || pool.defaultModel !== undefined);
  // Effective default: v2 pool key first, legacy v1 recipe key as fallback.
  const effectiveDefault = pool ? pool.defaultModel ?? pool.model : undefined;
  // "Upgrade" only makes sense for the bare legacy form and when `force` is
  // off — upgrading with force would create an invalid force+pool-table combo.
  const canUpgrade = !!pool && !isPoolView && pool.model !== undefined && !pool.force;
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

  const aliasLabel = (alias: string): string =>
    models[alias]?.display_name
      ? `${alias}（${models[alias].display_name}）`
      : alias;

  // Rows of the pool view: every `models` table key plus the effective default
  // when it is not already in the table (the implicit single-entry form).
  const implicitDefault =
    pool && effectiveDefault && !(effectiveDefault in pool.models)
      ? [effectiveDefault]
      : [];
  const poolEntries = [...poolKeys, ...implicitDefault];
  // Aliases that can still be added to the pool (not already in the table).
  const addableAliases = aliasList.filter((a) => !(a in (pool?.models ?? {})));

  // Inherited settings shown for the picked model: subagents bind the pointed
  // entry directly (no patch fields), so context size and effort come from the
  // model entry / global [thinking], not from a `[secondary_model]` patch.
  const selectedEntry = effectiveDefault ? models[effectiveDefault] : undefined;
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
    // Stored "max" tiers from old configs are shown as "high" (upstream
    // removed the tier; it auto-migrates to "high").
    const key = EFFORT_LABELS[e === "max" ? "high" : (e as (typeof EFFORTS)[number])];
    return key ? t(key) : e;
  };

  /**
   * Fallback guard before any pool-related write: validate the *target* state
   * against the engine rules (mirrored by `validateSubagentPool`) and block the
   * write when it would produce an invalid config. Normal UI flows never trip
   * this — it protects against stale/divergent configs.
   */
  const validateWrite = (nextRaw: unknown): boolean => {
    const nextPool = getSubagentModelPool(nextRaw);
    const errors = nextPool ? validateSubagentPool(nextPool, aliasList) : [];
    setPoolErrors(errors);
    return errors.length === 0;
  };

  const handleUpgrade = () => {
    if (!effectiveDefault) return;
    const nextRaw = setSubagentDefault(rawOther, effectiveDefault);
    if (validateWrite(nextRaw)) onChange(nextRaw);
  };

  const handleSetDefault = (alias: string) => {
    if (alias === effectiveDefault) return;
    const nextRaw = setSubagentDefault(rawOther, alias);
    if (validateWrite(nextRaw)) onChange(nextRaw);
  };

  const handleSaveDescription = (alias: string, description: string) => {
    const nextRaw = upsertSubagentPoolEntry(rawOther, alias, description);
    if (validateWrite(nextRaw)) onChange(nextRaw);
  };

  const handleRemoveEntry = (alias: string) => {
    const nextRaw = removeSubagentPoolEntry(rawOther, alias);
    if (validateWrite(nextRaw)) onChange(nextRaw);
  };

  const handleAddEntry = (alias: string) => {
    const nextRaw = upsertSubagentPoolEntry(rawOther, alias, "");
    if (validateWrite(nextRaw)) onChange(nextRaw);
  };

  const handleForceChange = (next: boolean) => {
    if (!pool) return;
    // Turning force on drops the `models` table — confirm when it is non-empty.
    if (next && Object.keys(pool.models).length > 0) {
      if (!confirm(t("secondaryPoolForceConfirm"))) return;
    }
    const nextRaw = setSubagentForce(rawOther, next);
    if (validateWrite(nextRaw)) onChange(nextRaw);
  };

  const handleClear = () => {
    setPoolErrors([]);
    onChange(clearSecondaryModel(rawOther));
  };

  const renderFlagRow = (flag: ExperimentalFlagDef) => {
    const labels = FLAG_LABELS[flag.id];
    const locked = masterOn || isFlagLockedByEnv(env, flag);
    // An explicitly written flag (true or false) wins; an absent flag falls
    // back to the upstream default (`defaultEnabled`).
    const explicitlySet = isExperimentalFlagSet(rawOther, flag.id);
    const on = masterOn
      ? true
      : isFlagLockedByEnv(env, flag)
        ? forcedEnvValue(env, flag)
        : explicitlySet
          ? flags[flag.id] === true
          : (flag.defaultEnabled ?? false);
    return (
      <div key={flag.id} className="flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 text-sm text-content-primary">
            {t(labels.name)}
            {!locked && !explicitlySet && flag.defaultEnabled && (
              <span className="shrink-0 text-xs text-blue-600 dark:text-blue-400 border border-blue-500/30 rounded px-1">
                {t("flagDefaultOn")}
              </span>
            )}
          </div>
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

        {/* Kimi Code WebUI quick open */}
        <Card title={t("webuiSection")}>
          <p className="text-xs text-content-muted">{t("webuiDesc")}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={async () => {
                try {
                  await invoke("open_kimi_web_embedded");
                } catch (err) {
                  alert(err instanceof Error ? err.message : String(err));
                }
              }}
              className="px-3 py-1.5 text-sm rounded bg-blue-600 text-white hover:bg-blue-500 focus:ring-2 focus:ring-blue-500 focus:outline-none"
            >
              {t("openWebUIEmbedded")}
            </button>
            <button
              type="button"
              onClick={async () => {
                try {
                  await invoke("open_kimi_web");
                } catch (err) {
                  alert(err instanceof Error ? err.message : String(err));
                }
              }}
              className="px-3 py-1.5 text-sm border border-border rounded hover:bg-hover-2 focus:ring-2 focus:ring-blue-500 focus:outline-none"
            >
              {t("openWebUIBrowser")}
            </button>
          </div>
        </Card>

        {/* Subagent: secondary model picker / pool + inherited settings */}
        <Card title={t("secondaryModelSection")}>
          {isPoolView && pool ? (
            <>
              {pool.force ? (
                /* Force on: the `models` table was dropped — only the pinned
                   default is shown, entries and "add" are hidden. */
                <div className="rounded-lg border border-border bg-input/40 px-3 py-2.5">
                  <div className="text-sm font-medium text-content-primary">
                    🔒{" "}
                    {t("secondaryPoolForceOn", {
                      alias: aliasLabel(effectiveDefault ?? ""),
                    })}
                  </div>
                </div>
              ) : (
                <>
                  <div className="space-y-2">
                    {poolEntries.map((alias) => (
                      <PoolEntryRow
                        key={alias}
                        alias={alias}
                        displayName={models[alias]?.display_name ?? null}
                        description={pool.models[alias] ?? ""}
                        isDefault={alias === effectiveDefault}
                        canRemove={alias in pool.models}
                        onSetDefault={handleSetDefault}
                        onSave={handleSaveDescription}
                        onRemove={handleRemoveEntry}
                      />
                    ))}
                  </div>
                  <p className="text-xs text-content-muted">
                    {t("secondaryPoolDescHint")}
                  </p>
                  <label className="flex items-center gap-3 text-sm text-content-primary">
                    <span className="shrink-0 text-content-muted">
                      {t("secondaryPoolAddLabel")}
                    </span>
                    <select
                      className="flex-1 max-w-md bg-input border border-border rounded px-2 py-1 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
                      value={addSelection}
                      onChange={(e) => {
                        const alias = e.target.value;
                        setAddSelection("");
                        if (alias) handleAddEntry(alias);
                      }}
                    >
                      <option value="">{t("secondaryPoolAddPlaceholder")}</option>
                      {addableAliases.map((alias) => (
                        <option key={alias} value={alias}>
                          {aliasLabel(alias)}
                        </option>
                      ))}
                    </select>
                  </label>
                </>
              )}

              <div className="flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-content-primary">
                    {t("secondaryPoolForce")}
                  </div>
                  <div className="text-xs text-content-muted">
                    {t("secondaryPoolForceDesc")}
                  </div>
                </div>
                <Toggle
                  checked={pool.force}
                  ariaLabel={t("secondaryPoolForce")}
                  onChange={handleForceChange}
                />
              </div>

              <button
                type="button"
                onClick={handleClear}
                className="px-3 py-1.5 text-sm border border-border rounded hover:bg-hover-2 focus:ring-2 focus:ring-blue-500 focus:outline-none"
              >
                {t("secondaryModelClear")}
              </button>
            </>
          ) : (
            <>
              <label className="flex items-center gap-3 text-sm text-content-primary">
                <span className="shrink-0 text-content-muted">
                  {t("secondaryModelLabel")}
                </span>
                <select
                  className="flex-1 max-w-md bg-input border border-border rounded px-2 py-1 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  value={effectiveDefault ?? ""}
                  onChange={(e) => {
                    const alias = e.target.value;
                    if (alias === "") {
                      setPoolErrors([]);
                      onChange(clearSecondaryModel(rawOther));
                    } else {
                      // Only the model reference is persisted — no patch fields.
                      // Subagents bind the pointed entry directly and inherit
                      // its settings; usage records stay keyed on the real
                      // alias instead of the synthesized `__secondary__` entry.
                      const nextRaw = setSecondaryModelOnly(rawOther, alias);
                      if (validateWrite(nextRaw)) onChange(nextRaw);
                    }
                  }}
                >
                  <option value="">{t("secondaryModelUnset")}</option>
                  {aliasList.map((alias) => (
                    <option key={alias} value={alias}>
                      {aliasLabel(alias)}
                    </option>
                  ))}
                </select>
                {pool?.force && (
                  <span className="shrink-0 text-xs text-content-muted">
                    🔒 {t("secondaryModelForceBadge")}
                  </span>
                )}
              </label>

              {canUpgrade && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleUpgrade}
                    className="px-3 py-1.5 text-sm border border-border rounded hover:bg-hover-2 focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  >
                    {t("secondaryPoolUpgrade")}
                  </button>
                  <span className="text-xs text-content-muted">
                    {t("secondaryPoolUpgradeDesc")}
                  </span>
                </div>
              )}
            </>
          )}

          {poolErrors.length > 0 && (
            <div
              role="alert"
              className="bg-red-100 dark:bg-red-900/20 border border-red-300 dark:border-red-500/30 rounded-lg px-3 py-2 text-sm text-red-700 dark:text-red-400 space-y-1"
            >
              {poolErrors.map((err, i) => (
                <div key={i}>{t(POOL_ERROR_KEYS[err.key], err.params)}</div>
              ))}
            </div>
          )}

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

          {effectiveDefault !== undefined && (
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
