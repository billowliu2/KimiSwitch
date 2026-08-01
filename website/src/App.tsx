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

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
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
