export function getHashPage(hash = "") {
  const value = String(hash || "#today");
  return value.split("?")[0] || "#today";
}

export function parseHashQuery(hash = "") {
  const query = String(hash || "").split("?")[1] || "";
  return new URLSearchParams(query);
}

export function parseKnowledgeFilters(hash = "") {
  const params = parseHashQuery(hash);
  return {
    q: String(params.get("q") || "").trim(),
    origin: normalizeOption(params.get("origin"), ["automation", "manual"]),
    topic: normalizeTopic(params.get("topic")),
    filter: normalizeOption(params.get("filter"), ["starred", "archived"])
  };
}

export function buildKnowledgeHash(filters = {}) {
  const params = new URLSearchParams();
  const q = String(filters.q || "").trim();
  if (q) params.set("q", q);
  if (filters.origin && filters.origin !== "all") params.set("origin", filters.origin);
  if (filters.topic && filters.topic !== "all") params.set("topic", filters.topic);
  if (filters.filter && filters.filter !== "all") params.set("filter", filters.filter);
  const query = params.toString();
  return query ? `#knowledge?${query}` : "#knowledge";
}

function normalizeOption(value, allowed) {
  const option = String(value || "").trim();
  return allowed.includes(option) ? option : "all";
}

function normalizeTopic(value) {
  return String(value || "").trim() || "all";
}
