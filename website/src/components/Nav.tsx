import { useState } from "react";
import { Link, NavLink } from "react-router-dom";
import { Desktop, Moon, Sun } from "@phosphor-icons/react";
import { useLang } from "../i18n";
import { useTheme, type ThemeMode } from "../theme";
import { asset } from "../lib/asset";

export default function Nav() {
  const { lang, setLang, t } = useLang();
  const { mode, setMode } = useTheme();
  const [menuOpen, setMenuOpen] = useState(false);

  const links = [
    { to: "/", label: t.nav.home, end: true },
    { to: "/features", label: t.nav.features },
    { to: "/changelog", label: t.nav.changelog },
    { to: "/download", label: t.nav.download },
  ];

  const themes: { id: ThemeMode; label: string; Icon: typeof Sun }[] = [
    { id: "light", label: t.nav.themeLight, Icon: Sun },
    { id: "dark", label: t.nav.themeDark, Icon: Moon },
    { id: "auto", label: t.nav.themeAuto, Icon: Desktop },
  ];

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur-xl">
      <div className="container-page flex h-16 items-center gap-3">
        <Link
          to="/"
          className="flex shrink-0 items-center gap-2.5 text-[15px] font-semibold tracking-tight"
          onClick={() => setMenuOpen(false)}
        >
          <img src={asset("kimi.svg")} alt="" className="h-7 w-7 rounded-lg" />
          <span>Kimi Switch</span>
        </Link>

        <nav aria-label="Primary" className="ml-4 hidden items-center gap-1 lg:flex">
          {links.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              end={l.end}
              className={({ isActive }) =>
                `whitespace-nowrap rounded-lg px-3 py-1.5 text-sm transition-colors duration-200 ${
                  isActive
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`
              }
            >
              {l.label}
            </NavLink>
          ))}
          <Link
            to="/#showcase"
            className="whitespace-nowrap rounded-lg px-3 py-1.5 text-sm text-muted-foreground transition-colors duration-200 hover:text-foreground"
          >
            {t.nav.showcase}
          </Link>
        </nav>

        <div className="ml-auto flex shrink-0 items-center gap-2">
          <div
            role="group"
            aria-label={t.nav.theme}
            className="hidden items-center gap-0.5 rounded-lg border border-border bg-card p-0.5 sm:flex"
          >
            {themes.map(({ id, label, Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => setMode(id)}
                aria-label={label}
                aria-pressed={mode === id}
                title={label}
                className={`rounded-[6px] p-1.5 transition-colors duration-200 ${
                  mode === id
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon className="h-4 w-4" weight="duotone" />
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => setLang(lang === "zh" ? "en" : "zh")}
            aria-label={t.nav.langLabel}
            className="rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            {lang === "zh" ? "EN" : "中文"}
          </button>

          <Link to="/download" className="btn-primary hidden text-xs sm:inline-flex">
            {t.nav.downloadBtn}
          </Link>

          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            aria-expanded={menuOpen}
            aria-label={t.nav.menu}
            className="rounded-lg border border-border p-2 text-muted-foreground lg:hidden"
          >
            <span className="block h-[2px] w-4 bg-current" />
            <span className="mt-[3px] block h-[2px] w-4 bg-current" />
          </button>
        </div>
      </div>

      {menuOpen && (
        <nav aria-label="Mobile" className="border-t border-border bg-background lg:hidden">
          <div className="container-page flex flex-wrap items-center gap-x-4 gap-y-2 py-3 text-sm">
            {links.map((l) => (
              <NavLink
                key={l.to}
                to={l.to}
                end={l.end}
                onClick={() => setMenuOpen(false)}
                className={({ isActive }) =>
                  isActive ? "text-foreground" : "text-muted-foreground"
                }
              >
                {l.label}
              </NavLink>
            ))}
            <Link
              to="/#showcase"
              onClick={() => setMenuOpen(false)}
              className="text-muted-foreground"
            >
              {t.nav.showcase}
            </Link>
            <div
              role="group"
              aria-label={t.nav.theme}
              className="ml-auto flex gap-0.5 rounded-lg border border-border bg-card p-0.5"
            >
              {themes.map(({ id, label, Icon }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setMode(id)}
                  aria-label={label}
                  aria-pressed={mode === id}
                  title={label}
                  className={`rounded-[6px] p-1.5 transition-colors ${
                    mode === id ? "bg-accent text-foreground" : "text-muted-foreground"
                  }`}
                >
                  <Icon className="h-4 w-4" weight="duotone" />
                </button>
              ))}
            </div>
          </div>
        </nav>
      )}
    </header>
  );
}
