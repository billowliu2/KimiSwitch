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

const PROVIDER_ICONS: Record<string, string> = {
  kimi: "K",
  anthropic: "A",
  openai: "O",
  openai_responses: "R",
  "google-genai": "G",
  vertexai: "V",
};

function getInitial(provider: Provider): string {
  return (
    PROVIDER_ICONS[provider.provider_type] ||
    provider.name.charAt(0).toUpperCase()
  );
}

function getProviderColor(type: string): string {
  switch (type) {
    case "kimi":
      return "from-blue-500 to-cyan-400";
    case "anthropic":
      return "from-orange-500 to-red-400";
    case "openai":
      return "from-green-500 to-emerald-400";
    case "openai_responses":
      return "from-teal-500 to-green-400";
    case "google-genai":
      return "from-purple-500 to-pink-400";
    case "vertexai":
      return "from-indigo-500 to-purple-400";
    default:
      return "from-gray-500 to-gray-400";
  }
}

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
  const { t } = useTranslation();
  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#2a2a2e]">
        <h2 className="font-medium text-[#e5e5e7]">{t("providers")}</h2>
        <button
          type="button"
          onClick={onAdd}
          title={t("addProvider")}
          className="w-9 h-9 flex items-center justify-center rounded-full bg-orange-500 hover:bg-orange-600 text-white text-xl shadow-lg focus:ring-2 focus:ring-orange-400 focus:outline-none transition-colors"
        >
          +
        </button>
      </div>

      <div className="flex-1 overflow-auto p-4">
        {providers.length === 0 ? (
          <div className="text-center py-12 text-gray-400">
            <div className="text-4xl mb-3 opacity-30">⊘</div>
            <div>{t("noProviders")}</div>
            <button
              type="button"
              onClick={onAdd}
              className="mt-4 w-12 h-12 rounded-full bg-orange-500 hover:bg-orange-600 text-white text-2xl shadow-lg flex items-center justify-center mx-auto"
            >
              +
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 w-full">
            {providers.map((provider) => {
              const providerModels = Object.values(models).filter(
                (m) => m.provider === provider.name
              );
              const defaultModelName = defaultModel
                ? models[defaultModel]?.display_name || defaultModel
                : null;
              const isKimiNative = provider.managed === true;
              const isActive = !isKimiNative && provider.active === true;

              return (
                <div
                  key={provider.name}
                  className={`group relative flex items-center gap-4 p-4 rounded-xl border transition-colors cursor-pointer w-full ${
                    isActive
                      ? "bg-green-900/10 border-green-500/30 hover:border-green-500/50 hover:bg-green-900/20"
                      : "bg-[#16161a] border-[#2a2a2e] hover:border-[#3a3a42] hover:bg-[#1c1c20]"
                  }`}
                  onClick={() => onEdit(provider.name)}
                >
                  <div
                    className={`w-11 h-11 rounded-xl bg-gradient-to-br ${getProviderColor(
                      provider.provider_type
                    )} flex items-center justify-center text-white font-bold text-lg shadow-lg`}
                  >
                    {getInitial(provider)}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-[#e5e5e7] truncate">
                        {provider.name}
                      </h3>
                      {isActive && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-green-900/30 text-green-400 border border-green-500/30">
                          {t("inUse")}
                        </span>
                      )}
                      {provider.note && (
                        <span className="text-xs text-gray-500 truncate max-w-[200px]">
                          {provider.note}
                        </span>
                      )}
                    </div>
                    <div className="mt-1 flex items-center gap-3 text-sm text-gray-400 flex-wrap">
                      <span className="font-mono text-xs">
                        {provider.official_url || provider.base_url || t("noUrl")}
                      </span>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-[#252529] text-gray-400 border border-[#2a2a2e]">
                        {provider.provider_type}
                      </span>
                      <span className="text-xs">
                        {t("modelCount", { count: providerModels.length })}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center flex-wrap justify-end gap-2">
                    {defaultModel &&
                      models[defaultModel]?.provider === provider.name && (
                        <span className="text-xs px-2 py-1 rounded-full bg-green-900/30 text-green-400 border border-green-500/20">
                          {t("defaultModel", { name: defaultModelName ?? "" })}
                        </span>
                      )}
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
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onEdit(provider.name);
                      }}
                      className="px-3 py-1.5 text-sm border border-[#2a2a2e] rounded hover:bg-[#252529] focus:ring-2 focus:ring-blue-500 focus:outline-none"
                    >
                      {t("edit")}
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDelete(provider.name);
                      }}
                      className="px-3 py-1.5 text-sm border border-[#2a2a2e] rounded hover:bg-red-900/30 hover:border-red-500/30 text-red-400 focus:ring-2 focus:ring-red-500 focus:outline-none"
                    >
                      {t("delete")}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
