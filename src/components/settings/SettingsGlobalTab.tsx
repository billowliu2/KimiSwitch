import { AgentSettingsPanel } from "../AgentSettingsPanel";
import type { Model } from "../../types";

interface SettingsGlobalTabProps {
  rawOther: unknown;
  models: Record<string, Model>;
  defaultModel: string | null;
  onChange: (nextRawOther: unknown) => void;
}

/**
 * Global agent settings (thinking / loop control / permission rules / hooks),
 * which live in the shared `config.raw_other` and therefore apply to every
 * provider rather than to a single one.
 */
export function SettingsGlobalTab({
  rawOther,
  models,
  defaultModel,
  onChange,
}: SettingsGlobalTabProps) {
  return (
    <div className="space-y-4">
      <AgentSettingsPanel
        rawOther={rawOther}
        onChange={onChange}
        models={models}
        defaultModel={defaultModel}
      />
    </div>
  );
}
