import { NavLink, Outlet } from "react-router-dom";
import { Download, Printer, Radio, Rewind, Settings } from "lucide-react";
import { useLiveStore } from "./store.js";
import { useEffect } from "react";
import { connectClientWs } from "./api/ws.js";
import { useEdges } from "./api/queries.js";

const navItems = [
  { to: "/", icon: Radio, label: "Live", end: true },
  { to: "/rewind", icon: Rewind, label: "Rewind" },
  { to: "/export", icon: Download, label: "Export" },
  { to: "/printer", icon: Printer, label: "Printer" },
  { to: "/settings", icon: Settings, label: "Settings" }
];

export default function App() {
  const title = useLiveStore((s) => s.title);
  const wsEdges = useLiveStore((s) => s.edges);
  const printer = useLiveStore((s) => s.printer);
  const { data: edgeData } = useEdges();
  const edges = edgeData?.edges ?? wsEdges;

  useEffect(() => {
    const close = connectClientWs();
    return close;
  }, []);

  return (
    <div className="min-h-full flex">
      <aside className="hidden md:flex w-56 border-r border-border bg-surface-1/60 flex-col">
        <div className="px-5 py-5 border-b border-border">
          <h1 className="text-base font-semibold tracking-tight">{title}</h1>
          <p className="text-xs text-zinc-500 mt-0.5">{edges.length} edge{edges.length === 1 ? "" : "s"} online</p>
        </div>
        <nav className="flex-1 p-2 space-y-0.5">
          {navItems.map(({ to, icon: Icon, label, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition ${
                  isActive ? "bg-surface-2 text-zinc-100" : "text-zinc-400 hover:bg-surface-2/60 hover:text-zinc-200"
                }`
              }
            >
              <Icon size={16} strokeWidth={1.75} />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="p-3 border-t border-border space-y-2">
          {edges.length > 0 && (
            <ul className="space-y-1">
              {edges.map((e) => (
                <li key={e.id} className="text-xs text-zinc-500 flex items-center gap-2">
                  <span className="size-1.5 rounded-full bg-emerald-500" />
                  <span className="truncate">{e.hostname || "edge"}</span>
                </li>
              ))}
            </ul>
          )}
          {printer && (
            <NavLink to="/printer" className="flex items-center gap-2 text-xs text-zinc-500 hover:text-zinc-300 transition">
              <Printer size={12} />
              <span className="truncate">
                {printer.state || "offline"}
                {printer.hotend != null && ` · ${printer.hotend.toFixed(0)}°`}
                {printer.state === "printing" && printer.progress != null && ` · ${(printer.progress * 100).toFixed(0)}%`}
              </span>
            </NavLink>
          )}
        </div>
      </aside>

      <main className="flex-1 min-w-0 overflow-auto pb-[calc(3.75rem+env(safe-area-inset-bottom))] md:pb-0">
        <Outlet />
      </main>

      {/* Mobile bottom tabs */}
      <nav
        className="md:hidden fixed inset-x-0 bottom-0 border-t border-border bg-surface-1/80 backdrop-blur supports-[backdrop-filter]:bg-surface-1/60"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="h-[3.75rem] px-2 flex items-stretch justify-around">
          {navItems.map(({ to, icon: Icon, label, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `flex flex-1 flex-col items-center justify-center gap-1 rounded-md mx-0.5 my-1 text-[11px] transition ${
                  isActive ? "text-zinc-100 bg-surface-2/70" : "text-zinc-400 hover:bg-surface-2/50 hover:text-zinc-200"
                }`
              }
            >
              <Icon size={18} strokeWidth={1.75} />
              <span className="leading-none">{label}</span>
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}
