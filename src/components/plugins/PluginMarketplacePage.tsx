import { useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "../../i18n";
import type { TranslationKey } from "../../i18n/zh";
import { fmtTime } from "../../lib/dashboard-format";
import type { InstalledPluginInfo } from "../../types";
import { usePlugins } from "./usePlugins";

/**
 * Plugin marketplace page. Sections:
 *   已安装 (installed, incl. non-marketplace "自定义安装" entries),
 *   官方 (tier === "official"), 社区 (any other tier).
 * Catalog failures fall back to the local installed list; cached catalog
 * responses surface a yellow banner (fromCache + fetchedAt).
 */
export function PluginMarketplacePage() {
  const { t, lang } = useTranslation();
  const locale = lang === "zh" ? "zh" : "en";
  const {
    catalog,
    installed,
    catalogLoading,
    installedLoading,
    catalogError,
    installedError,
    loadCatalog,
    loadInstalled,
    installPlugin,
    setPluginEnabled,
    removePlugin,
  } = usePlugins();

  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<{ id: string; action: PluginAction } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: PluginNoticeKind; name: string } | null>(null);
  const [copiedReload, setCopiedReload] = useState(false);
  const [trustEntry, setTrustEntry] = useState<PluginCard | null>(null);
  const [removeEntry, setRemoveEntry] = useState<PluginCard | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);

  // Fresh installed state wins over the (possibly stale) catalog snapshot.
  const installedById = useMemo(
    () => new Map(installed.map((i) => [i.id, i])),
    [installed]
  );

  const catalogCards = useMemo<PluginCard[]>(() => {
    return (catalog?.entries ?? []).map((e) => {
      const fresh = installedById.get(e.id) ?? null;
      return {
        id: e.id,
        displayName: e.displayName,
        version: (fresh ?? e.installed)?.version ?? e.version,
        description: e.description,
        keywords: e.keywords,
        homepage: e.homepage,
        tier: e.tier,
        source: e.source,
        capabilityId: e.capabilityId,
        updateAvailable: e.updateAvailable,
        installed: fresh ?? e.installed,
        customInstall: false,
      };
    });
  }, [catalog, installedById]);

  // Installed plugins with no catalog entry (catalog failed, or a manual
  // install) are shown in the installed section from the local list.
  const fallbackCards = useMemo<PluginCard[]>(
    () =>
      installed
        .filter((i) => !catalogCards.some((c) => c.id === i.id))
        .map((i) => ({
          id: i.id,
          displayName: i.id,
          version: i.version,
          description: null,
          keywords: [],
          homepage: null,
          tier: i.isMarketplace ? "unknown" : "custom",
          source: i.source,
          capabilityId: null,
          updateAvailable: false,
          installed: i,
          customInstall: !i.isMarketplace,
        })),
    [installed, catalogCards]
  );

  const q = query.trim().toLowerCase();
  const matchesQuery = (c: PluginCard) =>
    q === "" ||
    c.displayName.toLowerCase().includes(q) ||
    c.id.toLowerCase().includes(q) ||
    (c.description ?? "").toLowerCase().includes(q) ||
    c.keywords.some((k) => k.toLowerCase().includes(q));

  const installedCards = useMemo(
    () => [...catalogCards.filter((c) => c.installed), ...fallbackCards].filter(matchesQuery),
    [catalogCards, fallbackCards, q]
  );
  const officialCards = useMemo(
    () => catalogCards.filter((c) => !c.installed && c.tier === "official" && matchesQuery(c)),
    [catalogCards, q]
  );
  const communityCards = useMemo(
    () => catalogCards.filter((c) => !c.installed && c.tier !== "official" && matchesQuery(c)),
    [catalogCards, q]
  );

  const initialLoading =
    (catalogLoading || installedLoading) && !catalog && installed.length === 0;

  const copyReload = async () => {
    try {
      await navigator.clipboard.writeText("/reload");
      setCopiedReload(true);
      setTimeout(() => setCopiedReload(false), 2000);
    } catch {
      // Clipboard may be unavailable; ignore silently.
    }
  };

  /** Shared post-mutation refresh: local list is cheap, catalog force-fetch
   *  brings fresh updateAvailable / installed flags. */
  const afterMutation = async () => {
    await loadInstalled();
    await loadCatalog(true);
  };

  const doInstall = async (card: PluginCard) => {
    const isUpdate = card.updateAvailable;
    setBusy({ id: card.id, action: isUpdate ? "update" : "install" });
    setActionError(null);
    try {
      await installPlugin(card.source, card.id);
      setNotice({ kind: isUpdate ? "updated" : "installed", name: card.displayName });
      await afterMutation();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const handleInstall = (card: PluginCard) => {
    if (card.capabilityId) return;
    if (card.tier !== "official") {
      // Third-party plugin: require explicit trust confirmation first.
      setTrustEntry(card);
      return;
    }
    void doInstall(card);
  };

  const confirmTrust = async () => {
    if (!trustEntry) return;
    setConfirmBusy(true);
    try {
      await doInstall(trustEntry);
      setTrustEntry(null);
    } finally {
      setConfirmBusy(false);
    }
  };

  const handleToggle = async (card: PluginCard) => {
    if (!card.installed) return;
    const enabled = !card.installed.enabled;
    setBusy({ id: card.id, action: enabled ? "enable" : "disable" });
    setActionError(null);
    try {
      await setPluginEnabled(card.id, enabled);
      setNotice({ kind: enabled ? "enabled" : "disabled", name: card.displayName });
      await afterMutation();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const confirmRemove = async () => {
    if (!removeEntry) return;
    setConfirmBusy(true);
    try {
      await removePlugin(removeEntry.id);
      setNotice({ kind: "removed", name: removeEntry.displayName });
      setRemoveEntry(null);
      await afterMutation();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
      setRemoveEntry(null);
    } finally {
      setConfirmBusy(false);
    }
  };

  const sectionData = [
    { key: "installed", title: t("pluginSectionInstalled"), cards: installedCards },
    { key: "official", title: t("pluginSectionOfficial"), cards: officialCards },
    { key: "community", title: t("pluginSectionCommunity"), cards: communityCards },
  ].filter((s) => s.cards.length > 0);

  const showEmpty =
    !initialLoading && !catalogError && !installedError && sectionData.length === 0;

  return (
    <div className="flex h-full flex-col overflow-hidden p-4 space-y-3">
      <div className="flex shrink-0 flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-content-primary">{t("pluginMarketplace")}</h2>
          <p className="mt-1 max-w-[60ch] text-sm text-content-muted">{t("pluginMarketplaceSubtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("pluginSearchPlaceholder")}
            aria-label={t("pluginSearchPlaceholder")}
            className="w-56 bg-input border border-border rounded px-2.5 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none sm:w-64"
          />
          <button
            type="button"
            onClick={() => void loadCatalog(true)}
            disabled={catalogLoading}
            className="px-3 py-1.5 text-sm rounded border border-border hover:bg-hover-2 disabled:opacity-50"
          >
            {catalogLoading ? t("refreshing") : t("refresh")}
          </button>
        </div>
      </div>

      {catalogError && (
        <div className="shrink-0 rounded-lg border border-red-500/40 bg-red-900/20 px-4 py-3 text-sm text-red-300">
          <div className="font-semibold">{t("pluginCatalogFailed")}</div>
          <div className="mt-0.5 break-all opacity-90">{catalogError}</div>
        </div>
      )}
      {installedError && (
        <div className="shrink-0 rounded-lg border border-red-500/40 bg-red-900/20 px-4 py-3 text-sm text-red-300">
          <div className="font-semibold">{t("pluginInstalledListFailed")}</div>
          <div className="mt-0.5 break-all opacity-90">{installedError}</div>
        </div>
      )}
      {actionError && (
        <div className="shrink-0 rounded-lg border border-red-500/40 bg-red-900/20 px-4 py-3 text-sm text-red-300">
          <div className="break-all">{actionError}</div>
        </div>
      )}
      {catalog?.fromCache && (
        <div className="shrink-0 rounded-lg border border-amber-500/40 bg-amber-900/20 px-4 py-2.5 text-sm text-amber-300">
          {t("pluginCacheNotice", { time: fmtTime(parseTime(catalog.fetchedAt), locale) })}
        </div>
      )}
      {notice && (
        <div className="flex shrink-0 items-center justify-between gap-3 rounded-lg border border-green-300 dark:border-green-500/20 bg-green-100 dark:bg-green-900/20 px-4 py-2.5 text-sm text-green-600 dark:text-green-400">
          <span>{t(NOTICE_KEYS[notice.kind], { name: notice.name })}</span>
          <button
            type="button"
            onClick={copyReload}
            className="shrink-0 px-2.5 py-1 text-xs rounded border border-green-400/50 hover:bg-green-900/20"
          >
            {copiedReload ? t("pluginReloadCopied") : t("pluginCopyReload")}
          </button>
        </div>
      )}

      {initialLoading ? (
        <div className="flex min-h-0 flex-1 items-center justify-center">
          <div className="animate-spin h-8 w-8 border-2 border-blue-500 border-t-transparent rounded-full" />
        </div>
      ) : (
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto">
          {sectionData.map((section) => (
            <section key={section.key}>
              <h3 className="mb-2 flex items-center gap-2 text-sm font-medium text-content-primary">
                {section.title}
                <span className="rounded border border-border bg-input px-1.5 py-0 text-[10px] text-content-muted tabular-nums">
                  {section.cards.length}
                </span>
              </h3>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                {section.cards.map((card) => (
                  <PluginCardView
                    key={`${section.key}:${card.id}`}
                    card={card}
                    busy={busy?.id === card.id ? busy.action : null}
                    onInstall={handleInstall}
                    onUpdate={doInstall}
                    onToggle={(c) => void handleToggle(c)}
                    onRemove={setRemoveEntry}
                  />
                ))}
              </div>
            </section>
          ))}
          {showEmpty && (
            <div className="py-16 text-center text-sm text-content-muted">
              {q ? t("pluginEmptyResults") : t("pluginNoPlugins")}
            </div>
          )}
        </div>
      )}

      {/* Third-party trust confirm */}
      {trustEntry && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-xl border border-border bg-panel shadow-xl">
            <div className="space-y-3 p-5">
              <h3 className="text-base font-semibold text-content-primary">{t("pluginTrustTitle")}</h3>
              <p className="text-sm text-content-muted">
                {t("pluginTrustDesc", { source: trustEntry.source })}
              </p>
              <div className="rounded-md border border-border bg-input px-3 py-2.5">
                <div className="truncate text-sm font-medium">{trustEntry.displayName}</div>
                <div className="mt-1 break-all font-mono text-[11px] text-content-muted">
                  {trustEntry.source}
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-border bg-footer px-5 py-3">
              <button
                type="button"
                disabled={confirmBusy}
                onClick={() => setTrustEntry(null)}
                className="px-3 py-1.5 text-sm rounded border border-border hover:bg-hover-2 disabled:opacity-50"
              >
                {t("cancel")}
              </button>
              <button
                type="button"
                disabled={confirmBusy}
                onClick={() => void confirmTrust()}
                className="px-3 py-1.5 text-sm rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {confirmBusy ? t("pluginInstalling") : t("pluginTrustInstall")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Remove confirm */}
      {removeEntry && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-xl border border-border bg-panel shadow-xl">
            <div className="space-y-3 p-5">
              <h3 className="text-base font-semibold text-content-primary">{t("pluginRemoveTitle")}</h3>
              <p className="text-sm text-content-muted">
                {t("pluginRemoveConfirm", { name: removeEntry.displayName })}
              </p>
              <div className="rounded-md border border-border bg-input px-3 py-2.5">
                <div className="truncate text-sm font-medium">{removeEntry.displayName}</div>
                <div className="mt-1 break-all font-mono text-[11px] text-content-muted">
                  {removeEntry.id}
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-border bg-footer px-5 py-3">
              <button
                type="button"
                disabled={confirmBusy}
                onClick={() => setRemoveEntry(null)}
                className="px-3 py-1.5 text-sm rounded border border-border hover:bg-hover-2 disabled:opacity-50"
              >
                {t("cancel")}
              </button>
              <button
                type="button"
                disabled={confirmBusy}
                onClick={() => void confirmRemove()}
                className="px-3 py-1.5 text-sm rounded bg-red-600 text-white hover:bg-red-500 disabled:opacity-50"
              >
                {confirmBusy ? t("pluginRemoving") : t("pluginRemove")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

type PluginAction = "install" | "update" | "enable" | "disable" | "remove";
type PluginNoticeKind = "installed" | "updated" | "enabled" | "disabled" | "removed";

const NOTICE_KEYS: Record<PluginNoticeKind, TranslationKey> = {
  installed: "pluginInstalledMsg",
  updated: "pluginUpdatedMsg",
  enabled: "pluginEnabledMsg",
  disabled: "pluginDisabledMsg",
  removed: "pluginRemovedMsg",
};

/** Normalized card data: catalog metadata merged with fresh installed state. */
interface PluginCard {
  id: string;
  displayName: string;
  version: string | null;
  description: string | null;
  keywords: string[];
  homepage: string | null;
  tier: string;
  source: string;
  capabilityId: string | null;
  updateAvailable: boolean;
  installed: InstalledPluginInfo | null;
  /** Card synthesized from the local installed list (not in the catalog). */
  customInstall: boolean;
}

function parseTime(value: string | null | undefined): number {
  if (value == null || value === "") return 0;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : 0;
}

function PluginCardView({
  card,
  busy,
  onInstall,
  onUpdate,
  onToggle,
  onRemove,
}: {
  card: PluginCard;
  busy: PluginAction | null;
  onInstall: (card: PluginCard) => void;
  onUpdate: (card: PluginCard) => void;
  onToggle: (card: PluginCard) => void;
  onRemove: (card: PluginCard) => void;
}) {
  const { t } = useTranslation();
  const { installed } = card;
  const busyLabel =
    busy === "install"
      ? t("pluginInstalling")
      : busy === "update"
        ? t("pluginUpdating")
        : busy === "enable" || busy === "disable"
          ? t("pluginToggling")
          : busy === "remove"
            ? t("pluginRemoving")
            : null;

  return (
    <div className="flex flex-col gap-2.5 rounded-xl border border-border bg-panel p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <h4 className="truncate text-sm font-semibold text-content-primary" title={card.displayName}>
              {card.displayName}
            </h4>
            {card.updateAvailable && (
              <span className="rounded-md bg-amber-100 dark:bg-amber-900/30 px-2 py-0.5 text-[10px] text-amber-700 dark:text-amber-300">
                {t("pluginUpdateAvailable")}
              </span>
            )}
            {card.customInstall && (
              <span className="rounded-md bg-blue-100 dark:bg-blue-900/30 px-2 py-0.5 text-[10px] text-blue-700 dark:text-blue-300">
                {t("pluginCustomInstall")}
              </span>
            )}
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-[11px] text-content-muted">
            <span className="truncate font-mono">{card.id}</span>
            {card.version && <span className="shrink-0">v{card.version}</span>}
          </div>
        </div>
        {installed && (
          <span
            className={`shrink-0 rounded-md px-2 py-0.5 text-xs ${
              installed.enabled
                ? "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300"
                : "bg-zinc-200 dark:bg-zinc-700/40 text-zinc-600 dark:text-zinc-300"
            }`}
          >
            {installed.enabled ? t("activated") : t("disabled")}
          </span>
        )}
      </div>

      {card.description && (
        <p className="line-clamp-2 text-sm leading-relaxed text-content-muted">{card.description}</p>
      )}
      {card.keywords.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {card.keywords.slice(0, 6).map((k) => (
            <span
              key={k}
              className="rounded border border-border bg-input px-1.5 py-0.5 text-[10px] text-content-muted"
            >
              {k}
            </span>
          ))}
        </div>
      )}

      <div className="mt-auto flex items-center justify-between gap-2 border-t border-border/50 pt-2.5">
        <div className="flex min-w-0 items-center gap-2">
          {card.homepage && (
            <button
              type="button"
              onClick={() => openUrl(card.homepage!)}
              title={card.homepage}
              className="shrink-0 text-xs text-blue-600 hover:underline dark:text-blue-400"
            >
              {t("pluginHomepage")}
            </button>
          )}
          {card.source && !card.customInstall && (
            <span className="truncate font-mono text-[10px] text-content-muted" title={card.source}>
              {card.source}
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {installed ? (
            <>
              {card.updateAvailable && (
                <button
                  type="button"
                  disabled={busy != null || !!card.capabilityId}
                  onClick={() => onUpdate(card)}
                  title={card.capabilityId ? t("pluginCapabilityRequired") : undefined}
                  className="px-2.5 py-1 text-xs rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {busy === "update" ? busyLabel : t("pluginUpdate")}
                </button>
              )}
              <button
                type="button"
                disabled={busy != null}
                onClick={() => onToggle(card)}
                className="px-2.5 py-1 text-xs rounded border border-border hover:bg-hover-2 disabled:opacity-50"
              >
                {busy === "enable" || busy === "disable"
                  ? busyLabel
                  : installed.enabled
                    ? t("pluginDisable")
                    : t("pluginEnable")}
              </button>
              <button
                type="button"
                disabled={busy != null}
                onClick={() => onRemove(card)}
                className="px-2.5 py-1 text-xs rounded border border-red-500/30 text-red-300 hover:bg-red-900/20 disabled:opacity-50"
              >
                {busy === "remove" ? busyLabel : t("pluginRemove")}
              </button>
            </>
          ) : (
            <span title={card.capabilityId ? t("pluginCapabilityRequired") : undefined}>
              <button
                type="button"
                disabled={busy != null || !!card.capabilityId}
                onClick={() => onInstall(card)}
                className="px-2.5 py-1 text-xs rounded bg-blue-600 text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy === "install" ? busyLabel : t("pluginInstall")}
              </button>
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function openUrl(url: string) {
  invoke("open_external_url", { url }).catch(() => {
    const w = window.open(url, "_blank");
    if (!w) console.error(`failed to open ${url}`);
  });
}
