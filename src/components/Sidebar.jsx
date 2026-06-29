const NAV = [
  { key: "#today", icon: "today", label: "今日" },
  { key: "#knowledge", icon: "knowledge", label: "知识库" },
  { key: "#portfolio", icon: "portfolio", label: "投资组合" },
  { key: "#decisions", icon: "decisions", label: "决策" },
  { key: "#tasks", icon: "tasks", label: "任务" },
  { key: "#settings", icon: "settings", label: "设置" }
];

export function Sidebar({ route }) {
  const activeKey = route.startsWith("#report/") ? "#today" : (route || "#today");
  return (
    <aside class="sidebar">
      <div class="brand">
        <div class="brand-mark"><img src="/brand-icon.png" alt="" /></div>
        <div>
          <strong>投研助手</strong>
          <span>本地优先</span>
        </div>
      </div>
      <nav class="nav">
        {NAV.map(item => (
          <a key={item.key} class={`nav-item ${activeKey === item.key ? "active" : ""}`} href={item.key}>
            <span class="nav-icon" aria-hidden="true"><NavIcon name={item.icon} /></span>
            {item.label}
          </a>
        ))}
      </nav>
    </aside>
  );
}

function NavIcon({ name }) {
  const common = { fill: "none", stroke: "currentColor", "stroke-linecap": "round", "stroke-linejoin": "round" };
  if (name === "today") return (
    <svg viewBox="0 0 24 24" {...common}>
      <path d="M7 3v3M17 3v3M4.5 9.5h15" />
      <rect x="4.5" y="5.5" width="15" height="15" rx="3" />
      <path d="M8 14h3M8 17h6" />
    </svg>
  );
  if (name === "knowledge") return (
    <svg viewBox="0 0 24 24" {...common}>
      <path d="M5 5.5c2.7-.9 4.9-.5 7 1.3v13c-2.1-1.8-4.3-2.2-7-1.3z" />
      <path d="M12 6.8c2.1-1.8 4.3-2.2 7-1.3v13c-2.7-.9-4.9-.5-7 1.3" />
      <path d="M8 9.5h1.5M15 9.5h2" />
    </svg>
  );
  if (name === "portfolio") return (
    <svg viewBox="0 0 24 24" {...common}>
      <path d="M4.5 18.5h15" />
      <path d="M7 16V9M12 16V5.5M17 16v-4" />
      <path d="M5.5 12.5l4-3.5 4 2.5 4.8-5.2" />
    </svg>
  );
  if (name === "decisions") return (
    <svg viewBox="0 0 24 24" {...common}>
      <circle cx="12" cy="12" r="7.5" />
      <circle cx="12" cy="12" r="3.2" />
      <path d="M14.2 9.8l3.6-3.6M17.8 6.2h-2.7M17.8 6.2v2.7" />
    </svg>
  );
  if (name === "tasks") return (
    <svg viewBox="0 0 24 24" {...common}>
      <path d="M7.5 7.5h9M7.5 12h5.5M7.5 16.5h4" />
      <rect x="4.5" y="4.5" width="15" height="15" rx="3.5" />
      <path d="M15.2 15.8l1.4 1.4 2.5-3" />
    </svg>
  );
  return (
    <svg viewBox="0 0 24 24" {...common}>
      <path d="M4.5 7.5h15M4.5 16.5h15" />
      <circle cx="9" cy="7.5" r="2" />
      <circle cx="15" cy="16.5" r="2" />
    </svg>
  );
}
