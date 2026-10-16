import { Link } from "react-router-dom";
import {
  AppleLogo,
  ArrowUpRight,
  DownloadSimple,
  LinuxLogo,
  WindowsLogo,
  type Icon,
} from "@phosphor-icons/react";
import SectionShell from "../components/SectionShell";
import { useInView } from "../hooks";
import { useLang, VERSION_TAG } from "../i18n";

const GITHUB = "https://github.com/billowliu2/KimiSwitch";
const MIRROR = "https://git.codingplan.site/admin/KimiCodeSwitch";
const GITHUB_RELEASES = `${GITHUB}/releases`;
const MIRROR_RELEASES = `${MIRROR}/releases`;

/** Direct asset download URLs. GitHub carries every platform build; the Gitea
 *  mirror is uploaded by scripts/publish-gitea.sh and only carries the Windows
 *  artefacts (verified against the v0.8.5 release on both hosts), so anything
 *  else links to the mirror's release page instead of guessing a URL. */
const ghAsset = (file: string) => `${GITHUB}/releases/download/${VERSION_TAG}/${file}`;
const mirrorAsset = (file: string) => `${MIRROR}/releases/download/${VERSION_TAG}/${file}`;

const icons: Record<string, Icon> = {
  windows: WindowsLogo,
  macos: AppleLogo,
  linux: LinuxLogo,
};

interface DownloadAsset {
  label: string;
  kind: string;
  file?: string;
  mirrorFile?: string;
}

export default function Download() {
  const { t } = useLang();
  const [ref, inView] = useInView<HTMLDivElement>();
  const [windows, macos, linux] = t.download.items;

  return (
    <SectionShell id="download" title={t.download.title} subtitle={t.download.subtitle}>
      <div
        ref={ref}
        className={`reveal grid grid-cols-1 gap-4 lg:grid-cols-3 ${
          inView ? "reveal-on" : "reveal-off"
        }`}
      >
        <PlatformCard
          id={windows.id}
          name={windows.name}
          note={windows.note}
          assets={windows.assets as DownloadAsset[]}
          featured
          readyLabel={t.download.ready}
          mirrorName={t.download.mirrorName}
        />
        {[macos, linux].map((p, i) => (
          <PlatformCard
            key={p.id}
            id={p.id}
            name={p.name}
            note={p.note}
            assets={p.assets as DownloadAsset[]}
            delay={(i + 1) * 70}
            readyLabel={t.download.ready}
            mirrorName={t.download.mirrorName}
          />
        ))}
      </div>

      <div className="mt-10 flex flex-col gap-5 border-t border-border pt-8 md:flex-row md:items-start md:justify-between md:gap-12">
        <dl className="flex flex-wrap items-baseline gap-x-10 gap-y-4">
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">
              {t.download.versionLabel}
            </dt>
            <dd className="mt-1 font-mono text-lg font-semibold">{VERSION_TAG}</dd>
          </div>
          <div className="max-w-prose">
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">
              {t.download.mirrorName}
            </dt>
            <dd className="mt-1 text-sm text-muted-foreground">{t.download.mirrorNote}</dd>
          </div>
        </dl>
        <div className="flex shrink-0 flex-wrap gap-2">
          <a href={GITHUB_RELEASES} target="_blank" rel="noreferrer" className="btn-ghost text-xs">
            {t.download.githubAll}
            <ArrowUpRight className="h-3.5 w-3.5" />
          </a>
          <a href={MIRROR_RELEASES} target="_blank" rel="noreferrer" className="btn-ghost text-xs">
            {t.download.mirrorAll}
            <ArrowUpRight className="h-3.5 w-3.5" />
          </a>
        </div>
      </div>

      <p className="mt-6 max-w-prose text-sm leading-relaxed text-muted-foreground">
        {t.download.msiNote}
      </p>

      <div className="mt-12 grid grid-cols-1 gap-10 border-t border-border pt-10 md:grid-cols-[minmax(0,16rem)_minmax(0,1fr)] md:gap-14">
        <h3 className="text-lg font-semibold tracking-tight">{t.download.installTitle}</h3>
        <ol className="space-y-4">
          {t.download.installSteps.map((s, i) => (
            <li key={s} className="flex items-start gap-4">
              <span className="mt-px font-mono text-sm text-primary" aria-hidden="true">
                {String(i + 1).padStart(2, "0")}
              </span>
              <span className="max-w-prose text-sm leading-relaxed text-muted-foreground">{s}</span>
            </li>
          ))}
        </ol>
      </div>

      <p className="mt-10 flex items-start gap-2 text-sm text-muted-foreground">
        <DownloadSimple
          className="mt-0.5 h-4 w-4 shrink-0 text-primary"
          weight="duotone"
          aria-hidden="true"
        />
        <span className="max-w-prose">
          {t.download.autoUpdate}{" "}
          <Link
            to="/changelog"
            className="underline decoration-border underline-offset-4 hover:text-foreground"
          >
            {t.nav.changelog}
          </Link>
        </span>
      </p>
    </SectionShell>
  );
}

function PlatformCard({
  id,
  name,
  note,
  assets,
  featured = false,
  delay = 0,
  readyLabel,
  mirrorName,
}: {
  id: string;
  name: string;
  note: string;
  assets: DownloadAsset[];
  featured?: boolean;
  delay?: number;
  readyLabel: string;
  mirrorName: string;
}) {
  const Icon = icons[id] ?? WindowsLogo;
  /** The mirror hosts the Windows artefacts (see scripts/publish-gitea.sh);
   *  for other platforms the mirror link falls back to its release page. */
  const mirrorDirect = assets.find((a) => a.mirrorFile);

  const href = (a: DownloadAsset) => {
    if (a.mirrorFile) return mirrorAsset(a.mirrorFile);
    if (a.file) return ghAsset(a.file);
    return GITHUB_RELEASES;
  };

  return (
    <article
      style={{ transitionDelay: `${delay}ms` }}
      className={`card card-hover flex flex-col p-6 transition-[opacity,transform,box-shadow,border-color] duration-[620ms] ease-reveal md:p-7 ${
        featured ? "sm:col-span-2 lg:col-span-2 lg:row-span-2" : "lg:col-span-1"
      }`}
    >
      <div className="flex items-center gap-3">
        <span className="icon-chip">
          <Icon className="h-5 w-5" weight="duotone" />
        </span>
        <h3 className="text-lg font-semibold tracking-tight">{name}</h3>
        <span className="ml-auto rounded-md border border-primary/25 bg-primary/10 px-2 py-0.5 text-[11px] font-medium tracking-wide text-primary">
          {readyLabel}
        </span>
      </div>

      <p className="mt-4 max-w-prose text-sm leading-relaxed text-muted-foreground">{note}</p>

      <div className="mt-auto flex flex-col gap-2 pt-6">
        <div className="flex flex-wrap gap-2">
          {assets.map((a, i) => (
            <a
              key={a.label}
              href={href(a)}
              target="_blank"
              rel="noreferrer"
              className={
                a.kind === "primary"
                  ? `btn-primary text-xs ${featured ? "" : "flex-1"}`
                  : "btn-ghost text-xs"
              }
            >
              {i > 0 && <DownloadSimple className="h-3.5 w-3.5" />}
              {a.label}
            </a>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
          {featured && (
            <span className="font-mono text-muted-foreground">{VERSION_TAG} · .exe</span>
          )}
          <a
            href={mirrorDirect?.mirrorFile ? mirrorAsset(mirrorDirect.mirrorFile) : MIRROR_RELEASES}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-muted-foreground underline decoration-border underline-offset-4 transition-colors hover:text-foreground"
          >
            {mirrorName}
            <ArrowUpRight className="h-3 w-3" />
          </a>
        </div>
      </div>
    </article>
  );
}
