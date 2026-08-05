import { NavLink } from "react-router-dom";
import { useLang } from "../i18n";
import { asset } from "../lib/asset";

export default function Nav() {
  const { lang, setLang, t } = useLang();
  const links = [
    { to: "/", label: t.nav.home, end: true },
    { to: "/features", label: t.nav.features },
    { to: "/changelog", label: t.nav.changelog },
    { to: "/download", label: t.nav.download },
  ];
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/70 backdrop-blur-md">
      <div className="container-page flex h-14 items-center justify-between gap-4">
        <NavLink
          to="/"
          className="flex shrink-0 items-center gap-2 text-sm font-semibold tracking-tight"
        >
          <img
            src={asset("kimi.svg")}
            alt="Kimi Switch logo"
            className="h-7 w-7 rounded-lg"
          />
          <span>Kimi Switch</span>
        </NavLink>
        <nav className="flex items-center gap-5 overflow-x-auto overflow-y-hidden text-sm text-muted-foreground [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {links.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              end={l.end}
              className={({ isActive }) =>
                `relative shrink-0 pb-1 transition-colors ${
                  isActive ? "text-foreground" : "hover:text-foreground"
                }`
              }
            >
              {({ isActive }) => (
                <>
                  {l.label}
                  <span
                    className={`absolute -bottom-1 left-0 h-0.5 bg-primary transition-all duration-300 ${
                      isActive ? "w-full" : "w-0"
                    }`}
                  />
                </>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => setLang(lang === "zh" ? "en" : "zh")}
            className="rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            aria-label="Switch language / 切换语言"
          >
            {lang === "zh" ? "EN" : "中文"}
          </button>
          <NavLink to="/download" className="btn-primary hidden text-xs sm:inline-flex md:text-sm">
            {t.nav.downloadBtn}
          </NavLink>
        </div>
      </div>
    </header>
  );
}
