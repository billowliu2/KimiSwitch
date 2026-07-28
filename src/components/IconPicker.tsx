import { useMemo, useState } from "react";
import { useTranslation } from "../i18n";
import { ProviderIcon } from "./ProviderIcon";
import { iconList } from "../icons/extracted";
import { searchIcons, getIconMetadata } from "../icons/extracted/metadata";

interface IconPickerProps {
  value?: string | null;
  onValueChange: (icon: string) => void;
}

export function IconPicker({ value, onValueChange }: IconPickerProps) {
  const { t } = useTranslation();
  const [searchQuery, setSearchQuery] = useState("");

  const filteredIcons = useMemo(() => {
    if (!searchQuery.trim()) return iconList;
    return searchIcons(searchQuery);
  }, [searchQuery]);

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm text-content-muted mb-2">
          {t("iconPickerSearch")}
        </label>
        <input
          type="text"
          className="w-full bg-input border border-border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
          placeholder={t("iconPickerSearchPlaceholder")}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      <div className="max-h-[60vh] overflow-y-auto pr-1">
        <div className="grid grid-cols-6 sm:grid-cols-8 lg:grid-cols-10 gap-2">
          {filteredIcons.map((iconName) => {
            const meta = getIconMetadata(iconName);
            const isSelected = value === iconName;
            return (
              <button
                key={iconName}
                type="button"
                onClick={() => onValueChange(iconName)}
                className={`flex flex-col items-center gap-1 p-2 rounded-lg border-2 transition-all duration-150 hover:bg-hover ${
                  isSelected
                    ? "border-blue-500 bg-blue-500/10"
                    : "border-transparent hover:border-border"
                }`}
                title={meta?.displayName || iconName}
              >
                <ProviderIcon name={iconName} icon={iconName} size={32} />
                <span className="text-xs text-content-muted truncate w-full text-center">
                  {meta?.displayName || iconName}
                </span>
              </button>
            );
          })}
        </div>

        {filteredIcons.length === 0 && (
          <div className="text-center py-8 text-content-muted text-sm">
            {t("iconPickerNoResults")}
          </div>
        )}
      </div>
    </div>
  );
}
