import { lazy, Suspense, useEffect, useState } from "react";
import { Shell } from "./components/Shell";
import { RuntimeProvider } from "./hooks/useRuntime";

const Evidence = lazy(() => import("./pages/Evidence").then((module) => ({ default: module.Evidence })));
const Landing = lazy(() => import("./pages/Landing").then((module) => ({ default: module.Landing })));
const Maker = lazy(() => import("./pages/Maker").then((module) => ({ default: module.Maker })));
const Trade = lazy(() => import("./pages/Trade").then((module) => ({ default: module.Trade })));
const NotFound = lazy(() => import("./pages/NotFound").then((module) => ({ default: module.NotFound })));

const knownRoutes = ["/", "/trade", "/evidence", "/maker"];

function usePathname() {
  const [path, setPath] = useState(window.location.pathname);
  useEffect(() => {
    const navigate = (event: MouseEvent) => {
      const anchor = (event.target as Element | null)?.closest("a");
      if (!(anchor instanceof HTMLAnchorElement) || anchor.origin !== window.location.origin || anchor.target || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      if (!knownRoutes.includes(anchor.pathname)) return;
      event.preventDefault();
      window.history.pushState({}, "", anchor.href);
      setPath(anchor.pathname);
      window.scrollTo({ top: 0, behavior: "instant" });
    };
    const pop = () => setPath(window.location.pathname);
    document.addEventListener("click", navigate);
    window.addEventListener("popstate", pop);
    return () => { document.removeEventListener("click", navigate); window.removeEventListener("popstate", pop); };
  }, []);
  return path;
}

export default function App() {
  const route = usePathname();
  const page = route === "/" ? <Landing /> : route === "/trade" ? <Trade /> : route === "/evidence" ? <Evidence /> : route === "/maker" ? <Maker /> : <NotFound />;
  return <RuntimeProvider><Shell route={route}><Suspense fallback={<div className="route-loading" role="status">Loading FirmDepth…</div>}>{page}</Suspense></Shell></RuntimeProvider>;
}
