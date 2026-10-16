import { useTranslation } from "../../i18n";
import type { UpdateInfo } from "../../hooks/useUpdateCheck";
import type { Model } from "../../types";
import { SettingsGeneralTab } from "./SettingsGeneralTab";
import { SettingsGlobalTab } from "./SettingsGlobalTab";
import { SettingsAdvancedTab } from "./SettingsAdvancedTab";

type SettingsTab = "general" | "global" | "advanced";

interface SettingsPageProps {
  activeTab: SettingsTab;
  onTabChange: (tab: SettingsTab) => void;
  updateInfo: UpdateInfo | null;
  checking: boolean;
  onCheckUpdate: () => void;
  lastChecked: number | null;
  rawOther: unknown;
  models: Record<string, Model>;
  defaultModel: string | null;
  onRawOtherChange: (nextRawOther: unknown) => void;
}

/**
 * Full-page settings shell: a tab bar and three tab panels. No back header —
 * the top nav group already offers peer-level switching. Every panel stays
 * mounted — the inactive ones are only hidden — so the update download state
 * (progress + installer path) survives tab switches.
 */
export function SettingsPage({
  activeTab,
  onTabChange,
  updateInfo,
  checking,
  onCheckUpdate,
  lastChecked,
  rawOther,
  models,
  defaultModel,
  onRawOtherChange,
}: SettingsPageProps) {
  const { t } = useTranslation();

  const tabs: { id: SettingsTab; label: string }[] = [
    { id: "global", label: t("settingsTabGlobal") },
    { id: "advanced", label: t("subagentSettings") },
    { id: "general", label: t("settingsAbout") },
  ];

  return (
    <div className="h-full flex flex-col bg-app">
      {/* Tab bar —— 无返回头：顶部导航组已可平级切换，设置页是平级视图 */}
      <div className="flex items-center px-4 py-2 border-b border-border bg-panel">
        <div className="flex items-center bg-input border border-border rounded p-0.5">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => onTabChange(tab.id)}
              className={`px-3 py-1 text-sm rounded transition-colors ${
                activeTab === tab.id
                  ? "bg-blue-600 text-white"
                  : "text-content-muted hover:text-content-primary"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6 space-y-5">
        <div className={activeTab === "general" ? "" : "hidden"}>
          <SettingsGeneralTab
            updateInfo={updateInfo}
            checking={checking}
            onCheckUpdate={onCheckUpdate}
            lastChecked={lastChecked}
          />
        </div>
        <div className={activeTab === "global" ? "" : "hidden"}>
          <SettingsGlobalTab
            rawOther={rawOther}
            models={models}
            defaultModel={defaultModel}
            onChange={onRawOtherChange}
          />
        </div>
        <div className={activeTab === "advanced" ? "" : "hidden"}>
          <SettingsAdvancedTab
            rawOther={rawOther}
            models={models}
            onChange={onRawOtherChange}
          />
        </div>
      </div>
    </div>
  );
}
