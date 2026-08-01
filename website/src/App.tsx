import { useEffect } from "react";
import { Route, Routes, useLocation } from "react-router-dom";
import Nav from "./components/Nav";
import Hero from "./sections/Hero";
import Features from "./sections/Features";
import Changelog from "./sections/Changelog";
import Download from "./sections/Download";
import Privacy from "./sections/Privacy";
import CTA from "./sections/CTA";
import Footer from "./components/Footer";
import { useLang, type Dict } from "./i18n";

const SITE_URL = "https://billowliu2.github.io/KimiSwitch";
type SeoKey = keyof Dict["seo"];

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

/** Update per-page title / description / OG / canonical for SEO. */
function RouteMeta() {
  const { pathname } = useLocation();
  const { t } = useLang();

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
    setMeta("name", "twitter:title", m.title);
    setMeta("name", "twitter:description", m.description);

    const canon = document.querySelector('link[rel="canonical"]');
    if (canon) canon.setAttribute("href", url);
  }, [pathname, t]);

  return null;
}

function setMeta(attr: "name" | "property", key: string, content: string) {
  let el = document.head.querySelector<HTMLMetaElement>(
    `meta[${attr}="${key}"]`,
  );
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
    <CTA />
  </>
);

export default function App() {
  return (
    <div className="flex min-h-screen flex-col">
      <Nav />
      <main className="flex-1">
        <ScrollToTop />
        <RouteMeta />
        <Routes>
          <Route path="/" element={homePage} />
          <Route
            path="/features"
            element={
              <>
                <Features />
                <Privacy />
              </>
            }
          />
          <Route path="/changelog" element={<Changelog />} />
          <Route path="/download" element={<Download />} />
          <Route path="*" element={homePage} />
        </Routes>
      </main>
      <Footer />
    </div>
  );
}
