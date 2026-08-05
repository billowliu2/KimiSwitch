import type { ReactNode } from "react";

/** Shared small form controls used by settings panels (Agent settings,
 *  Subagent settings, ...). Extracted from AgentSettingsPanel.tsx so new
 *  panels can reuse the same look without duplicating code. */

export function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="bg-panel border border-border rounded-xl p-4 space-y-3">
      <h4 className="text-content-muted text-sm font-medium">{title}</h4>
      {children}
    </div>
  );
}

export function Checkbox({
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
        disabled ? "text-content-muted" : "text-content-primary"
      }`}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="rounded border-border bg-input text-blue-600 focus:ring-blue-500"
      />
      {label}
    </label>
  );
}

export function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value?: number;
  onChange: (value: number | undefined) => void;
}) {
  return (
    <label className="flex items-center gap-3 text-sm text-content-primary">
      <span className="text-content-muted">{label}</span>
      <input
        type="number"
        value={value ?? ""}
        onChange={(e) => {
          const raw = e.target.value;
          onChange(raw === "" ? undefined : Number(raw));
        }}
        className="w-32 bg-input border border-border rounded px-2 py-1 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
      />
    </label>
  );
}

export function Segmented({
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
      className={`flex items-center rounded overflow-hidden border border-border ${
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
              : "bg-input text-content-muted hover:bg-hover-2"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
