import db from "../services/db.js";
import { getMarketData } from "../services/market-data.js";

export function getIndices() {
  const rows = db.prepare("SELECT * FROM market_indices").all();
  const live = getMarketData();
  return rows.map(row => {
    const liveItem = live.data.find(d => row.code.includes(d.code));
    return {
      code: row.code, region: row.region, name: row.name,
      level: liveItem?.level || row.level || "待接入",
      changePct: liveItem?.changePct || row.change_pct || "待接入",
      volume: liveItem?.volume || row.volume || null,
      relatedEtfs: JSON.parse(row.related_etfs || "[]"),
      updatedAt: live.updatedAt || row.updated_at
    };
  });
}

export function getMarketSnapshot() {
  const live = getMarketData();
  return { indices: live.data, updatedAt: live.updatedAt };
}
