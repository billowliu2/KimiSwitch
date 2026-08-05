import { useEffect, useState } from "react";
import SectionShell from "../components/SectionShell";
import { useLang } from "../i18n";

interface ChangelogEntry {
  version: string;
  date: string;
  items: string[];
}

const API_URL =
  "https://api.github.com/repos/billowliu2/KimiSwitch/releases?per_page=20";
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

/** Cache key is versioned by the newest embedded release so redeploys
 *  invalidate stale caches in the browser immediately. */
function cacheKey(embedded: ChangelogEntry[]) {
  return `kimi-switch-changelog-${embedded[0]?.version ?? "v1"}`;
}

/** Compare semantic versions like "v0.7.1" for descending order. */
function compareVersionsDesc(a: string, b: string): number {
  const parse = (v: string) =>
    v.replace(/^v/, "").split(".").map((n) => Number(n) || 0);
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
 *  and the release-template "Downloads by platform" section (changelog entries
 *  are about changes, not installers). */
function parseBody(body: string): string[] {
  const items: string[] = [];
  for (const raw of body.split("\n")) {
    const line = raw.replace(/^\s*[-*]\s+/, "").trim();
    if (line.length === 0 || line === "---") continue;
    // Drop the release template's download section and everything after it.
    if (/downloads?\s+by\s+platform/i.test(line)) break;
    const cleaned = line
      .replace(/^#{1,6}\s+/, "") // markdown heading markers
      .replace(/\*\*(.+?)\*\*/g, "$1") // bold
      .replace(/`([^`]+)`/g, "$1") // inline code
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
    localStorage.setItem(
      cacheKey(embedded),
      JSON.stringify({ ts: Date.now(), data }),
    );
  } catch {
    /* ignore quota/private-mode errors */
  }
}

export default function Changelog() {
  const { t } = useLang();
  const embedded = t.changelog.entries as ChangelogEntry[];
  const [remote, setRemote] = useState<ChangelogEntry[] | null>(null);
  const [synced, setSynced] = useState(false);

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
  }, []);

  // 远端拉到的版本优先显示（含未翻译的新版本），内置列表补齐缺失版本。
  // 合并后按版本倒序排序，避免未翻译版本被无脑塞到最前导致时间轴顺序错乱。
  const entries: ChangelogEntry[] = [
    ...(remote ?? []).filter(
      (r) => !embedded.some((e) => e.version === r.version),
    ),
    ...embedded,
  ].sort((a, b) => compareVersionsDesc(a.version, b.version));

  return (
    <SectionShell
      id="changelog"
      title={t.changelog.title}
      subtitle={t.changelog.subtitle}
    >
      <ol className="relative space-y-10 border-l border-border pl-7">
        {entries.map((e) => (
          <li key={e.version} className="relative">
            <span className="absolute -left-[34px] top-[5px] h-3 w-3 rounded-full border-2 border-background bg-primary ring-4 ring-primary/10" />
            <div className="flex flex-wrap items-baseline gap-3">
              <h3 className="font-mono text-lg font-semibold tracking-tight">{e.version}</h3>
              <time className="text-xs text-muted-foreground">{e.date}</time>
            </div>
            {e.items.length > 0 && (
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-relaxed text-muted-foreground">
                {e.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ol>
      <p className="mt-10 text-xs text-muted-foreground">
        <a
          href="https://github.com/billowliu2/KimiSwitch/releases"
          target="_blank"
          rel="noreferrer"
          className="underline hover:text-foreground"
        >
          {synced ? t.changelog.syncedNote : t.changelog.fallbackNote}
        </a>
        {" · "}
        <a
          href="https://git.codingplan.site/admin/KimiCodeSwitch/releases"
          target="_blank"
          rel="noreferrer"
          className="underline hover:text-foreground"
        >
          {t.footer.mirror}
        </a>
      </p>
    </SectionShell>
  );
}
