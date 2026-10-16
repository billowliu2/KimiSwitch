import { useEffect } from "react";
import { Route, Routes, useLocation } from "react-router-dom";
import Nav from "./components/Nav";
import Hero from "./sections/Hero";
import Features from "./sections/Features";
import Showcase from "./sections/Showcase";
import Performance from "./sections/Performance";
import Privacy from "./sections/Privacy";
import Changelog from "./sections/Changelog";
import Download from "./sections/Download";
import CTA from "./sections/CTA";
import Footer from "./components/Footer";
import { useLang, type Dict } from "./i18n";

const SITE_URL = "https://billowliu2.github.io/KimiSwitch";
type SeoKey = keyof Dict["seo"];

function ScrollToTop() {
  const { pathname, hash } = useLocation();
  useEffect(() => {
    // Deep links to a section (e.g. "/#showcase" from anywhere on the site)
    // win over the plain top-of-page reset.
    if (hash) {
      const target = document.getElementById(hash.slice(1));
      if (target) {
        target.scrollIntoView({ block: "start" });
        return;
      }
    }
    window.scrollTo(0, 0);
  }, [pathname, hash]);
  return null;
}

/** Update per-page title / description / OG / canonical for SEO. */
function RouteMeta() {
  const { pathname } = useLocation();
  const { lang, t } = useLang();

  useEffect(() => {
    const page = pathname.replace(/\/+$/, "");
    const seoKey: SeoKey =
      page === "/features" || page === "/changelog" || page === "/download"
        ? (page.slice(1) as SeoKey)
        : "home";
    const m = t.seo[seoKey];
    const url = `${SITE_URL}${page === "" ? "/" : page}`;

    document.title = m.title;
    setMeta("name", "description", m.description);
    setMeta("property", "og:title", m.title);
    setMeta("property", "og:description", m.description);
    setMeta("property", "og:url", url);
    setMeta("property", "og:locale", lang === "zh" ? "zh_CN" : "en_US");
    setMeta("property", "og:locale:alternate", lang === "zh" ? "en_US" : "zh_CN");
    setMeta("name", "twitter:title", m.title);
    setMeta("name", "twitter:description", m.description);

    const canon = document.querySelector('link[rel="canonical"]');
    if (canon) canon.setAttribute("href", url);
  }, [pathname, t, lang]);

  return null;
}

function setMeta(attr: "name" | "property", key: string, content: string) {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}

const homePage = (
  <>
    <Hero />
    <Showcase />
    <Features />
    <Performance />
    <Privacy />
    <CTA />
  </>
);

const featuresPage = (
  <>
    <Hero />
    <Features />
    <Performance />
    <Privacy />
  </>
);

const downloadPage = (
  <>
    <Download />
  </>
);

export default function App() {
  return (
    <div className="flex min-h-[100dvh] flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-card focus:px-4 focus:py-2 focus:text-sm"
      >
        Skip to content / 跳到正文
      </a>
      <Nav />
      <main id="main" className="flex-1">
        <ScrollToTop />
        <RouteMeta />
        <Routes>
          <Route path="/" element={homePage} />
          <Route path="/features" element={featuresPage} />
          <Route path="/changelog" element={<Changelog />} />
          <Route path="/download" element={downloadPage} />
          <Route path="*" element={homePage} />
        </Routes>
      </main>
      <Footer />
    </div>
  );
}
