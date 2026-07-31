import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "../i18n";
import type { TranslationKey } from "../i18n/zh";
import {
  providerPresets,
  type BillingMode,
  type PresetCategory,
  type ProviderPreset,
} from "../config/providerPresets";
import { ProviderIcon } from "./ProviderIcon";

interface PresetPickerModalProps {
  open: boolean;
  onClose: () => void;
  onSelect: (preset: ProviderPreset) => void;
  onCustom: () => void;
}

const CATEGORY_BADGE: Record<Exclude<PresetCategory, "custom">, string> = {
  official: "bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-400",
  cn_official: "bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-400",
  third_party: "bg-gray-200 text-gray-600 dark:bg-gray-500/15 dark:text-gray-400",
  aggregator: "bg-purple-100 text-purple-700 dark:bg-purple-500/15 dark:text-purple-400",
};

const CATEGORY_LABEL: Record<Exclude<PresetCategory, "custom">, TranslationKey> = {
  official: "presetCategoryOfficial",
  cn_official: "presetCategoryCnOfficial",
  third_party: "presetCategoryThirdParty",
  aggregator: "presetCategoryAggregator",
};

const BILLING_BADGE: Record<BillingMode, string> = {
  subscription: "bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-400",
  pay_as_you_go: "bg-slate-200 text-slate-600 dark:bg-slate-500/15 dark:text-slate-400",
};

const BILLING_LABEL: Record<BillingMode, TranslationKey> = {
  subscription: "billingBadgeSubscription",
  pay_as_you_go: "billingBadgePayAsYouGo",
};

type SortMode = "original" | "alpha";
type BillingTab = "all" | BillingMode;

const BILLING_TAB_ORDER: BillingTab[] = ["subscription", "pay_as_you_go", "all"];

export function PresetPickerModal({ open, onClose, onSelect, onCustom }: PresetPickerModalProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortMode>("original");
  const [billingTab, setBillingTab] = useState<BillingTab>("all");

  // Esc to close
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Scroll lock while open
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // Reset transient state each time the modal opens
  useEffect(() => {
    if (open) {
      setQuery("");
      setSort("original");
      setBillingTab("all");
    }
  }, [open]);

  // Counts per billing tab — shown in the tab labels so users see how many
  // presets are in each bucket without having to click through.
  const billingCounts = useMemo(() => {
    let sub = 0;
    let payg = 0;
    for (const p of providerPresets) {
      if (p.billingMode === "subscription") sub++;
      else payg++;
    }
    return { subscription: sub, pay_as_you_go: payg, all: sub + payg };
  }, []);

  const presetName = (p: ProviderPreset) =>
    p.nameKey ? t(p.nameKey as TranslationKey) : p.name;

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = providerPresets;
    if (billingTab !== "all") {
      list = list.filter((p) => p.billingMode === billingTab);
    }
    if (q) {
      list = list.filter(
        (p) => p.id.toLowerCase().includes(q) || presetName(p).toLowerCase().includes(q)
      );
    }
    if (sort === "alpha") {
      list = [...list].sort((a, b) => presetName(a).localeCompare(presetName(b)));
    }
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, sort, billingTab, t]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={t("presetPickerTitle")}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-xl border border-border bg-panel shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
          <div className="text-lg font-semibold text-content-primary">
            {t("presetPickerTitle")}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("close")}
            className="rounded-md p-1 text-content-muted hover:bg-border hover:text-content-primary transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Billing-mode tabs + search + sort */}
        <div className="flex flex-col gap-2 border-b border-border px-5 py-3">
          <div className="flex items-center bg-input border border-border rounded p-0.5 self-start">
            {BILLING_TAB_ORDER.map((tab) => {
              const labelKey: TranslationKey =
                tab === "all"
                  ? "billingTabAll"
                  : tab === "subscription"
                    ? "billingTabSubscription"
                    : "billingTabPayAsYouGo";
              const count = billingCounts[tab];
              const active = billingTab === tab;
              return (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setBillingTab(tab)}
                  className={`px-2.5 py-1 text-xs rounded transition-colors ${
                    active
                      ? "bg-blue-600 text-white"
                      : "text-content-muted hover:text-content-primary"
                  }`}
                >
                  {t(labelKey)} ({count})
                </button>
              );
            })}
          </div>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("presetSearchPlaceholder")}
              autoFocus
              className="h-8 flex-1 rounded border border-border bg-input px-2 text-sm text-content-primary focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <div className="flex items-center rounded border border-border bg-input p-0.5">
              <button
                type="button"
                onClick={() => setSort("original")}
                className={`px-2 py-1 text-xs rounded transition-colors ${
                  sort === "original"
                    ? "bg-blue-600 text-white"
                    : "text-content-muted hover:text-content-primary"
                }`}
              >
                {t("presetSortOriginal")}
              </button>
              <button
                type="button"
                onClick={() => setSort("alpha")}
                className={`px-2 py-1 text-xs rounded transition-colors ${
                  sort === "alpha"
                    ? "bg-blue-600 text-white"
                    : "text-content-muted hover:text-content-primary"
                }`}
              >
                {t("presetSortAlpha")}
              </button>
            </div>
          </div>
        </div>

        {/* Preset grid */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {visible.length === 0 ? (
            <div className="py-8 text-center text-sm text-content-muted">
              {t("presetNoResults")}
            </div>
          ) : (
            <div
              className="grid gap-2"
              style={{ gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))" }}
            >
              {visible.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => onSelect(p)}
                  className="flex flex-col items-start gap-2 rounded-lg border border-border bg-input p-3 text-left transition-colors hover:border-blue-500 hover:bg-hover-2"
                >
                  <ProviderIcon name={presetName(p)} icon={p.icon ?? null} color={p.iconColor ?? null} size={32} />
                  <div className="w-full truncate text-sm font-medium text-content-primary">
                    {presetName(p)}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {p.category !== "custom" && (
                      <span
                        className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${CATEGORY_BADGE[p.category]}`}
                      >
                        {t(CATEGORY_LABEL[p.category])}
                      </span>
                    )}
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${BILLING_BADGE[p.billingMode]}`}
                    >
                      {t(BILLING_LABEL[p.billingMode])}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}

          {/* Custom (empty form) entry */}
          <button
            type="button"
            onClick={onCustom}
            className="mt-3 flex w-full items-center justify-center gap-1 rounded-lg border border-dashed border-border px-3 py-2.5 text-sm text-content-muted transition-colors hover:border-blue-500 hover:text-content-primary"
          >
            {t("presetCustomConfig")}
          </button>
        </div>

        {/* Footer hint */}
        <div className="border-t border-border px-5 py-2.5 text-xs text-content-muted">
          {t("presetFooterHint")}
        </div>
      </div>
    </div>,
    document.body
  );
}
