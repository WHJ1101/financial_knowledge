const SECIDS = {
  "000001.SH": "1.000001",
  "399001.SZ": "0.399001",
  "399006.SZ": "0.399006",
  "000688.SH": "1.000688",
  "HSI.HK": "100.HSI",
  "IXIC.US": "100.NDX",
  "SPX.US": "100.SPX"
};

let cache = { data: [], updatedAt: null };
let timer = null;

export function getMarketData() {
  return cache;
}

export async function fetchMarketData() {
  const secids = Object.values(SECIDS).join(",");
  const url = `https://push2.eastmoney.com/api/qt/ulist.np/get?fields=f1,f2,f3,f4,f6,f12,f14&secids=${secids}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    const json = await res.json();
    if (json.data?.diff) {
      cache.data = json.data.diff.map((item) => ({
        code: item.f12,
        name: item.f14,
        level: item.f2 === "-" ? null : (item.f2 / 100).toFixed(2),
        changePct: item.f3 === "-" ? null : (item.f3 / 100).toFixed(2),
        volume: item.f6 === "-" ? null : item.f6
      }));
      cache.updatedAt = new Date().toISOString();
    }
  } catch (e) {
    console.error("Market data fetch failed:", e.message);
  }
}

function isTradingHours() {
  const now = new Date();
  const hour = Number(new Intl.DateTimeFormat("en", { timeZone: "Asia/Shanghai", hour: "numeric", hour12: false }).format(now));
  const day = now.getDay();
  return day >= 1 && day <= 5 && hour >= 9 && hour <= 15;
}

export function startMarketPoller() {
  fetchMarketData();
  timer = setInterval(() => {
    if (isTradingHours()) fetchMarketData();
  }, 30_000);
}

export function stopMarketPoller() {
  if (timer) clearInterval(timer);
}
