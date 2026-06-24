const NAV = [
  { key: "#today", icon: "◉", label: "今日" },
  { key: "#knowledge", icon: "◎", label: "知识库" },
  { key: "#portfolio", icon: "◈", label: "投资组合" },
  { key: "#market", icon: "◇", label: "行情" },
  { key: "#decisions", icon: "◆", label: "决策" },
  { key: "#tasks", icon: "⚙", label: "任务" },
  { key: "#settings", icon: "☰", label: "设置" }
];

export function Sidebar({ route }) {
  const activeKey = route.startsWith("#report/") ? "#today" : (route || "#today");
  return (
    <aside class="sidebar">
      <div class="brand">
        <div class="brand-mark">研</div>
        <div>
          <strong>投研助手</strong>
          <span>本地优先</span>
        </div>
      </div>
      <nav class="nav">
        {NAV.map(item => (
          <a key={item.key} class={`nav-item ${activeKey === item.key ? "active" : ""}`} href={item.key}>
            <span class="nav-icon">{item.icon}</span>
            {item.label}
          </a>
        ))}
      </nav>
    </aside>
  );
}
