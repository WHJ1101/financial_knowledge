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

export async function searchStocks(keyword) {
  const url = `https://searchapi.eastmoney.com/api/suggest/get?input=${encodeURIComponent(keyword)}&type=14&count=8`;
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
  const json = await res.json();
  const items = json.QuotationCodeTable?.Data || [];
  return items.map(d => ({
    code: d.Code,
    name: d.Name,
    market: classifySecurity(d),
    secid: d.QuoteID
  }));
}

export async function getStockQuote(secid) {
  const normalized = String(secid || "").trim();
  if (isOtcFundSecid(normalized)) return getFundQuote(extractSecurityCode(normalized));

  const quote = await getExchangeQuote(normalized).catch(() => null);
  if (quote) return quote;

  const code = extractSecurityCode(normalized);
  return code ? getFundQuote(code).catch(() => null) : null;
}

async function getExchangeQuote(secid) {
  const [mkt, code] = secid.split(".");
  if (!code) return null;

  let prefix = "";
  if (mkt === "1") prefix = "sh";
  else if (mkt === "0") prefix = "sz";
  else if (mkt === "116") prefix = "hk";
  else if (mkt === "105" || mkt === "106") prefix = "us";
  else return null;

  const url = `https://qt.gtimg.cn/q=${prefix}${code}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
  const buf = await res.arrayBuffer();
  const text = new TextDecoder("gbk").decode(buf);
  const parts = text.split("~");
  if (parts.length < 35) return null;
  const price = parseFloat(parts[3]);
  const prevClose = parseFloat(parts[4]);
  if (!price) return null;
  const changePct = prevClose ? (((price - prevClose) / prevClose) * 100).toFixed(2) : "0.00";
  return {
    name: parts[1],
    price,
    market: classifyMarketFromSecid(mkt, code),
    high: parseFloat(parts[33]) || price,
    low: parseFloat(parts[34]) || price,
    open: parseFloat(parts[5]) || price,
    changePct,
    source: "exchange",
    sourceLabel: "交易所行情"
  };
}

async function getFundQuote(code) {
  if (!/^\d{6}$/.test(code)) return null;

  const url = `https://fundgz.1234567.com.cn/js/${code}.js?rt=${Date.now()}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) return null;

  const text = await res.text();
  const match = text.match(/jsonpgz\((.*)\);?$/);
  if (!match) return null;

  const data = JSON.parse(match[1]);
  const estimatedNav = toNumber(data.gsz);
  const latestNav = toNumber(data.dwjz);
  const price = estimatedNav || latestNav;
  if (!price) return null;

  const changePct = toNumber(data.gszzl);
  return {
    name: data.name,
    price,
    market: "基金",
    high: price,
    low: price,
    open: latestNav || price,
    changePct: Number.isFinite(changePct) ? changePct.toFixed(2) : "0.00",
    source: estimatedNav ? "fund-estimate" : "fund-nav",
    sourceLabel: estimatedNav ? "基金估算净值" : "基金最新净值",
    nav: latestNav || null,
    navDate: data.jzrq || "",
    updatedAt: data.gztime || data.jzrq || ""
  };
}

function classifySecurity(item) {
  const classify = String(item.Classify || "");
  const securityType = String(item.SecurityType || "");
  const securityTypeName = String(item.SecurityTypeName || "");
  const jys = String(item.JYS || "");
  const mktNum = String(item.MktNum || "");

  if (classify === "AStock") return "A股";
  if (classify === "HKStock") return "港股";
  if (classify === "USStock" || classify === "UsStock") return "美股";
  if (jys === "OTCFUND" || classify === "OTCFUND" || mktNum === "150" || securityType === "17") return "基金";
  if (classify === "Fund" || securityTypeName.includes("基金")) return isExchangeFundCode(item.Code) ? "ETF" : "基金";
  return "美股";
}

function classifyMarketFromSecid(mkt, code) {
  if (isExchangeFundCode(code)) return "ETF";
  if (mkt === "116") return "港股";
  if (mkt === "105" || mkt === "106") return "美股";
  return "A股";
}

function isOtcFundSecid(secid) {
  return secid.split(".")[0] === "150";
}

function extractSecurityCode(value) {
  const match = String(value || "").match(/\b\d{6}\b/);
  return match ? match[0] : "";
}

function isExchangeFundCode(code) {
  return /^(15|16|50|51|52|56|58)\d{4}$/.test(String(code || ""));
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
