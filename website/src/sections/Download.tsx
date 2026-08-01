import SectionShell from "../components/SectionShell";
import { WindowsLogo, AppleLogo, LinuxLogo, DownloadSimple, type Icon } from "@phosphor-icons/react";
import { useLang } from "../i18n";

const icons: Record<string, Icon> = {
  windows: WindowsLogo,
  macos: AppleLogo,
  linux: LinuxLogo,
};

const GITHUB_RELEASES = "https://github.com/billowliu2/KimiSwitch/releases";
const MIRROR_RELEASES = "https://git.codingplan.site/admin/KimiCodeSwitch/releases";

export default function Download() {
  const { t } = useLang();
  return (
    <SectionShell
      id="download"
      title={t.download.title}
      subtitle={t.download.subtitle}
    >
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {t.download.items.map((p) => {
          const Icon = icons[p.id] ?? WindowsLogo;
          return (
            <div key={p.id} className="card flex flex-col">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-primary/25 bg-primary/10 text-primary">
                  <Icon className="h-5 w-5" weight="duotone" />
                </div>
                <span
                  className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                    p.ready
                      ? "bg-primary/10 text-primary border border-primary/25"
                      : "bg-muted text-muted-foreground border border-border"
                  }`}
                >
                  {p.ready ? t.download.ready : t.download.wip}
                </span>
              </div>
              <h3 className="mb-2 text-lg font-semibold">{p.name}</h3>
              <p className="text-sm text-muted-foreground">{p.note}</p>
              {p.ready && (
                <div className="mt-4 flex flex-wrap gap-2">
                  <a
                    href={GITHUB_RELEASES}
                    target="_blank"
                    rel="noreferrer"
                    className="btn-primary text-xs"
                  >
                    {t.download.githubBtn}
                  </a>
                  <a
                    href={MIRROR_RELEASES}
                    target="_blank"
                    rel="noreferrer"
                    className="btn-ghost text-xs"
                  >
                    {t.download.mirrorBtn}
                  </a>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <p className="mt-6 flex items-center gap-2 text-sm text-muted-foreground">
        <DownloadSimple className="h-4 w-4 text-primary" weight="duotone" />
        {t.download.autoUpdate}
      </p>
    </SectionShell>
  );
}
