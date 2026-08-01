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
const CACHE_KEY = "kimi-switch-changelog";
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

/** Parse a GitHub release body into bullet items. */
function parseBody(body: string): string[] {
  return body
    .split("\n")
    .map((l) => l.replace(/^\s*[-*]\s+/, "").trim())
    .filter((l) => l.length > 0 && l !== "---");
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

function readCache(): ChangelogEntry[] | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const { ts, data } = JSON.parse(raw) as { ts: number; data: ChangelogEntry[] };
    if (Date.now() - ts > CACHE_TTL) return null;
    return data;
  } catch {
    return null;
  }
}

function writeCache(data: ChangelogEntry[]) {
  try {
    localStorage.setItem(
      CACHE_KEY,
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
    const cached = readCache();
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
        writeCache(data);
      })
      .catch(() => {
        /* 网络不通时使用内置列表兜底 */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // 远端拉到的版本优先显示（含未翻译的新版本），内置列表补齐缺失版本。
  const entries: ChangelogEntry[] = [
    ...(remote ?? []).filter(
      (r) => !embedded.some((e) => e.version === r.version),
    ),
    ...embedded,
  ];

  return (
    <SectionShell
      id="changelog"
      title={t.changelog.title}
      subtitle={t.changelog.subtitle}
    >
      <ol className="relative space-y-8 border-l border-border pl-8">
        {entries.map((e) => (
          <li key={e.version} className="relative">
            <span className="absolute -left-[37px] top-1.5 h-2.5 w-2.5 rounded-full bg-primary" />
            <div className="flex flex-wrap items-baseline gap-3">
              <h3 className="font-mono text-lg font-semibold">{e.version}</h3>
              <time className="text-xs text-muted-foreground">{e.date}</time>
            </div>
            {e.items.length > 0 && (
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
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
