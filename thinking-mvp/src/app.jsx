import { useState, useEffect } from "preact/hooks";
import { Layout } from "./components/Layout.jsx";
import { Today } from "./pages/Today.jsx";
import { Knowledge } from "./pages/Knowledge.jsx";
import { Portfolio } from "./pages/Portfolio.jsx";
import { Market } from "./pages/Market.jsx";
import { Decisions } from "./pages/Decisions.jsx";
import { Tasks } from "./pages/Tasks.jsx";
import { Settings } from "./pages/Settings.jsx";
import { ReportReader } from "./pages/ReportReader.jsx";
import { refresh } from "./store.js";

export function App() {
  const [route, setRoute] = useState(location.hash || "#today");

  useEffect(() => {
    refresh();
    const onChange = () => setRoute(location.hash || "#today");
    window.addEventListener("hashchange", onChange);
    const timer = setInterval(() => { if (!route.startsWith("#report/")) refresh(); }, 15000);
    return () => { window.removeEventListener("hashchange", onChange); clearInterval(timer); };
  }, []);

  const page = () => {
    if (route.startsWith("#report/")) return <ReportReader id={decodeURIComponent(route.replace("#report/", ""))} />;
    switch (route) {
      case "#knowledge": return <Knowledge />;
      case "#portfolio": return <Portfolio />;
      case "#market": return <Market />;
      case "#decisions": return <Decisions />;
      case "#tasks": return <Tasks />;
      case "#settings": return <Settings />;
      default: return <Today />;
    }
  };

  return <Layout route={route}>{page()}</Layout>;
}
