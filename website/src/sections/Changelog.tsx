import { useEffect, useState } from "react";
import { CaretDown } from "@phosphor-icons/react";
import SectionShell from "../components/SectionShell";
import { useLang } from "../i18n";

interface ChangelogEntry {
  version: string;
  date: string;
  items: string[];
}

const API_URL = "https://api.github.com/repos/billowliu2/KimiSwitch/releases?per_page=20";
const CACHE_TTL = 60 * 60 * 1000; // 1 hour
/** Older releases stay collapsed; the newest few carry the page. */
const EXPANDED_BY_DEFAULT = 3;

/** Cache key is versioned by the newest embedded release so redeploys
 *  invalidate stale caches in the browser immediately. */
function cacheKey(embedded: ChangelogEntry[]) {
  return `kimi-switch-changelog-${embedded[0]?.version ?? "v1"}`;
}

/** Compare semantic versions like "v0.7.1" for descending order. */
function compareVersionsDesc(a: string, b: string): number {
  const parse = (v: string) => v.replace(/^v/, "").split(".").map((n) => Number(n) || 0);
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < 3; i++) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da !== db) return db - da;
  }
  return 0;
}

/** Parse a GitHub release body into bullet items, stripping markdown syntax
 *  and the release-template "Downloads by platform" section. */
function parseBody(body: string): string[] {
  const items: string[] = [];
  for (const raw of body.split("\n")) {
    const line = raw.replace(/^\s*[-*]\s+/, "").trim();
    if (line.length === 0 || line === "---") continue;
    if (/downloads?\s+by\s+platform/i.test(line)) break;
    const cleaned = line
      .replace(/^#{1,6}\s+/, "")
      .replace(/\*\*(.+?)\*\*/g, "$1")
      .replace(/`([^`]+)`/g, "$1")
      .trim();
    if (cleaned.length > 0) items.push(cleaned);
  }
  return items;
}

async function fetchReleases(): Promise<ChangelogEntry[]> {
  const res = await fetch(API_URL);
  if (!res.ok) throw new Error(`GitHub API ${res.status}`);
  const list = (await res.json()) as Array<{
    tag_name: string;
    published_at: string | null;
    body: string | null;
  }>;
  return list.map((r) => ({
    version: r.tag_name,
    date: (r.published_at ?? "").slice(0, 10),
    items: parseBody(r.body ?? ""),
  }));
}

function readCache(embedded: ChangelogEntry[]): ChangelogEntry[] | null {
  try {
    const raw = localStorage.getItem(cacheKey(embedded));
    if (!raw) return null;
    const { ts, data } = JSON.parse(raw) as { ts: number; data: ChangelogEntry[] };
    if (Date.now() - ts > CACHE_TTL) return null;
    return data;
  } catch {
    return null;
  }
}

function writeCache(data: ChangelogEntry[], embedded: ChangelogEntry[]) {
  try {
    localStorage.setItem(cacheKey(embedded), JSON.stringify({ ts: Date.now(), data }));
  } catch {
    /* ignore quota / private-mode errors */
  }
}

export default function Changelog() {
  const { t } = useLang();
  const embedded = t.changelog.entries as ChangelogEntry[];
  const [remote, setRemote] = useState<ChangelogEntry[] | null>(null);
  const [synced, setSynced] = useState(false);
  const [open, setOpen] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let cancelled = false;
    const cached = readCache(embedded);
    if (cached) {
      setRemote(cached);
      setSynced(true);
      return;
    }
    fetchReleases()
      .then((data) => {
        if (cancelled) return;
        setRemote(data);
        setSynced(true);
        writeCache(data, embedded);
      })
      .catch(() => {
        /* 网络不通时使用内置列表兜底 */
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Remote entries win (they include untranslated new versions), the embedded
  // list fills the gaps, and the merged result is sorted newest first.
  const entries: ChangelogEntry[] = [
    ...(remote ?? []).filter((r) => !embedded.some((e) => e.version === r.version)),
    ...embedded,
  ].sort((a, b) => compareVersionsDesc(a.version, b.version));

  const isOpen = (v: string, i: number) => open[v] ?? i < EXPANDED_BY_DEFAULT;

  return (
    <SectionShell
      id="changelog"
      title={t.changelog.title}
      subtitle={t.changelog.subtitle}
    >
      <ol className="border-t border-border">
        {entries.map((e, i) => {
          const expanded = isOpen(e.version, i);
          return (
            <li key={e.version} className="border-b border-border">
              <button
                type="button"
                aria-expanded={expanded}
                onClick={() => setOpen((o) => ({ ...o, [e.version]: !expanded }))}
                className="group flex w-full items-center gap-4 py-5 text-left transition-colors hover:bg-accent/40"
              >
                <span className="font-mono text-base font-semibold tracking-tight md:text-lg">
                  {e.version}
                </span>
                {i === 0 && (
                  <span className="rounded-md border border-primary/25 bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                    latest
                  </span>
                )}
                <time className="text-xs text-muted-foreground">{e.date}</time>
                <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                  {e.items.length}
                </span>
                <CaretDown
                  className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-300 ${
                    expanded ? "rotate-180" : ""
                  }`}
                  aria-hidden="true"
                />
              </button>
              {expanded && e.items.length > 0 && (
                <ul className="animate-fade-in space-y-2 pb-6 pl-1 pr-8">
                  {e.items.map((item) => (
                    <li
                      key={item}
                      className="flex items-start gap-3 text-sm leading-relaxed text-muted-foreground"
                    >
                      <span
                        aria-hidden="true"
                        className="mt-[9px] h-1 w-1 shrink-0 rounded-full bg-primary/70"
                      />
                      <span className="max-w-prose">{item}</span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ol>

      <p className="mt-8 text-xs text-muted-foreground">
        <a
          href="https://github.com/billowliu2/KimiSwitch/releases"
          target="_blank"
          rel="noreferrer"
          className="underline decoration-border underline-offset-4 hover:text-foreground"
        >
          {synced ? t.changelog.syncedNote : t.changelog.fallbackNote}
        </a>
        {" · "}
        <a
          href="https://git.codingplan.site/admin/KimiCodeSwitch/releases"
          target="_blank"
          rel="noreferrer"
          className="underline decoration-border underline-offset-4 hover:text-foreground"
        >
          {t.footer.mirror}
        </a>
      </p>
    </SectionShell>
  );
}
