import { useEffect, useState } from "react";
import { Shell } from "./components/Shell";
import { RuntimeProvider } from "./hooks/useRuntime";
import { Evidence } from "./pages/Evidence";
import { Landing } from "./pages/Landing";
import { Maker } from "./pages/Maker";
import { Trade } from "./pages/Trade";

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
  return knownRoutes.includes(path) ? path : "/";
}

export default function App() {
  const route = usePathname();
  return <RuntimeProvider><Shell route={route}>{route === "/trade" ? <Trade /> : route === "/evidence" ? <Evidence /> : route === "/maker" ? <Maker /> : <Landing />}</Shell></RuntimeProvider>;
}
