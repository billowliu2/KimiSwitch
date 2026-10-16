import { useTranslation } from "../i18n";
import type { Model } from "../types";
import { SettingsAdvancedTab } from "./settings/SettingsAdvancedTab";
import { SettingsGlobalTab } from "./settings/SettingsGlobalTab";

interface SubagentSettingsPageProps {
  /** config.raw_other — hosts the `[experimental]` and `[secondary_model]` sections. */
  rawOther: unknown;
  /** All configured models (alias → entry) for the secondary-model picker. */
  models: Record<string, Model>;
  /** Alias of the model the effort tier actually applies to. */
  defaultModel?: string | null;
  onChange: (nextRawOther: unknown) => void;
  onBack: () => void;
}

/**
 * Standalone full-page shell around the global + advanced settings tabs; kept
 * for the legacy route into the subagent settings. The settings page renders
 * both tabs separately instead.
 */
export function SubagentSettingsPage({
  rawOther,
  models,
  defaultModel,
  onChange,
  onBack,
}: SubagentSettingsPageProps) {
  const { t } = useTranslation();

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
        <SettingsGlobalTab
          rawOther={rawOther}
          models={models}
          defaultModel={defaultModel ?? null}
          onChange={onChange}
        />
        <SettingsAdvancedTab
          rawOther={rawOther}
          models={models}
          onChange={onChange}
        />
      </div>
    </div>
  );
}
