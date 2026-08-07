import SectionShell from "../components/SectionShell";
import { WindowsLogo, AppleLogo, LinuxLogo, DownloadSimple, type Icon } from "@phosphor-icons/react";
import { useLang } from "../i18n";

const icons: Record<string, Icon> = {
  windows: WindowsLogo,
  macos: AppleLogo,
  linux: LinuxLogo,
};

const VERSION = "0.7.2";
const GITHUB = "https://github.com/billowliu2/KimiSwitch";
const MIRROR_RELEASES = "https://git.codingplan.site/admin/KimiCodeSwitch/releases";
const dl = (file: string) => `${GITHUB}/releases/download/v${VERSION}/${file}`;

/** Per-platform download assets for the current release (names match the CI
 *  release workflow. NOTE: tauri-bundler keeps the productName verbatim, so the
 *  real asset is "Kimi Switch_0.7.2_…" (space), URL-encoded as %20. */
const assets: Record<string, { label: string; href: string }[]> = {
  windows: [
    { label: "MSI", href: dl("Kimi%20Switch_0.7.2_x64_en-US.msi") },
    { label: "镜像", href: MIRROR_RELEASES },
  ],
  macos: [
    { label: "Apple Silicon (.dmg)", href: dl("Kimi%20Switch_0.7.2_aarch64.dmg") },
    { label: "安装脚本", href: dl("install-macos.sh") },
  ],
  linux: [
    { label: ".deb", href: dl("Kimi%20Switch_0.7.2_amd64.deb") },
    { label: ".AppImage", href: dl("Kimi%20Switch_0.7.2_amd64.AppImage") },
    { label: ".rpm", href: dl("Kimi%20Switch-0.7.2-1.x86_64.rpm") },
  ],
};

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
          const links = assets[p.id] ?? [];
          return (
            <div key={p.id} className="card flex flex-col">
              <div className="mb-3 flex items-center justify-between">
                <div className="icon-chip">
                  <Icon className="h-5 w-5" weight="duotone" />
                </div>
                <span className="rounded-md border border-primary/20 bg-primary/10 px-2 py-0.5 text-[11px] font-medium tracking-wide text-primary">
                  {t.download.ready}
                </span>
              </div>
              <h3 className="mb-2 text-lg font-semibold tracking-tight">{p.name}</h3>
              <p className="text-sm text-muted-foreground">{p.note}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                {links.map((l) => (
                  <a
                    key={l.label}
                    href={l.href}
                    target="_blank"
                    rel="noreferrer"
                    className={l.label === "镜像" ? "btn-ghost text-xs" : "btn-primary text-xs"}
                  >
                    {l.label}
                  </a>
                ))}
              </div>
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
