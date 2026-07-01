import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { importFeishuSignalSource } from "../lib/feishuSource.js";

const args = process.argv.slice(2);
const help = args.includes("--help") || args.includes("-h");

if (help) {
  console.log(`Usage:
  npm run source:feishu -- "https://example.feishu.cn/wiki/..."
  FEISHU_SIGNAL_WIKI_URL=https://example.feishu.cn/wiki/... npm run source:feishu

Environment:
  FEISHU_APP_ID           飞书企业自建应用 App ID
  FEISHU_APP_SECRET       飞书企业自建应用 App Secret
  FEISHU_SIGNAL_WIKI_URL  可选，默认导入的 Wiki/文档链接
  FINANCE_KNOWLEDGE_DATA_DIR  可选，默认 data/

Output:
  data/sources/feishu-signals-YYYY-MM-DD-<token>.json
`);
  process.exit(0);
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.FINANCE_KNOWLEDGE_DATA_DIR || join(__dirname, "../data");
const input = args.find((arg) => !arg.startsWith("-")) || process.env.FEISHU_SIGNAL_WIKI_URL || process.env.FEISHU_SIGNAL_URL;

try {
  const result = await importFeishuSignalSource({ input, dataDir });
  console.log(`已导入飞书信号源：${result.title}`);
  console.log(`输出文件：${result.outputPath}`);
  console.log(`片段数量：${result.itemCount}`);
  console.log(`正文字符：${result.contentLength}`);
} catch (error) {
  console.error(error.message || error);
  process.exit(1);
}
