import SectionShell from "../components/SectionShell";
import { WindowsLogo, AppleLogo, LinuxLogo, DownloadSimple, type Icon } from "@phosphor-icons/react";
import { useLang } from "../i18n";

const icons: Record<string, Icon> = {
  windows: WindowsLogo,
  macos: AppleLogo,
  linux: LinuxLogo,
};

const VERSION = "0.7.12";
const GITHUB = "https://github.com/billowliu2/KimiSwitch";
const MIRROR_RELEASES = "https://git.codingplan.site/admin/KimiCodeSwitch/releases";
const dl = (file: string) => `${GITHUB}/releases/download/v${VERSION}/${file}`;

/** Per-platform download assets for the current release (names match the CI
 *  release workflow exactly — verified against the published v0.7.12 assets:
 *  tauri-bundler on CI produces `Kimi.Switch_…` (dots) on every platform,
 *  except the rpm which uses `Kimi.Switch-<version>-1` (hyphens).
 *  Filenames interpolate VERSION, so a release bump only changes the
 *  constant above. */
const assets: Record<string, { label: string; href: string }[]> = {
  windows: [
    { label: "MSI", href: dl(`Kimi.Switch_${VERSION}_x64_en-US.msi`) },
    { label: "镜像", href: MIRROR_RELEASES },
  ],
  macos: [
    { label: "Apple Silicon (.dmg)", href: dl(`Kimi.Switch_${VERSION}_aarch64.dmg`) },
    { label: "安装脚本", href: dl("install-macos.sh") },
  ],
  linux: [
    { label: ".deb", href: dl(`Kimi.Switch_${VERSION}_amd64.deb`) },
    { label: ".AppImage", href: dl(`Kimi.Switch_${VERSION}_amd64.AppImage`) },
    { label: ".rpm", href: dl(`Kimi.Switch-${VERSION}-1.x86_64.rpm`) },
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
      {/* 不对称：Windows 为主推平台，横跨整行；macOS / Linux 两列在下方 */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {t.download.items.map((p) => {
          const Icon = icons[p.id] ?? WindowsLogo;
          const links = assets[p.id] ?? [];
          const featured = p.id === "windows";
          return (
            <div
              key={p.id}
              className={`card flex flex-col ${
                featured
                  ? "md:col-span-2 md:flex-row md:items-center md:justify-between md:gap-10"
                  : ""
              }`}
            >
              <div className="min-w-0">
                <div className="mb-3 flex items-center gap-3">
                  <div className="icon-chip shrink-0">
                    <Icon className="h-5 w-5" weight="duotone" />
                  </div>
                  <h3 className="text-lg font-semibold tracking-tight">{p.name}</h3>
                  <span className="ml-auto rounded-md border border-primary/20 bg-primary/10 px-2 py-0.5 text-[11px] font-medium tracking-wide text-primary">
                    {t.download.ready}
                  </span>
                </div>
                <p className={`text-sm text-muted-foreground ${featured ? "max-w-[65ch]" : ""}`}>
                  {p.note}
                </p>
              </div>
              <div className="mt-4 flex shrink-0 flex-wrap items-start gap-2 md:mt-0">
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

      <p className="mt-6 flex max-w-[65ch] items-center gap-2 text-sm text-muted-foreground">
        <DownloadSimple className="h-4 w-4 text-primary" weight="duotone" />
        {t.download.autoUpdate}
      </p>
    </SectionShell>
  );
}
