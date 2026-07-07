import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

const root = await mkdtemp(join(tmpdir(), "financial-knowledge-api-routes-"));
process.env.FINANCE_KNOWLEDGE_DATA_DIR = root;

const { apiRoutes, matchApiRoute } = await import("./api-routes.js");

test("route table declares exactly four public endpoints (A2-2)", () => {
  const publicRoutes = apiRoutes.filter((r) => r.public).map((r) => `${r.method} ${r.path}`).sort();
  assert.deepEqual(publicRoutes, [
    "GET /api/auth/session",
    "POST /api/auth/login",
    "POST /api/auth/logout",
    "POST /api/reports/import"
  ]);
});

test("every route has method, handler and path or pattern", () => {
  for (const route of apiRoutes) {
    assert.ok(["GET", "POST", "PUT", "DELETE"].includes(route.method), `bad method: ${route.method}`);
    assert.equal(typeof route.handler, "function");
    assert.ok(route.path || route.pattern, "route needs path or pattern");
  }
});

test("matchApiRoute matches exact paths and extracts pattern params", () => {
  assert.ok(matchApiRoute("GET", "/api/status"));
  assert.equal(matchApiRoute("POST", "/api/status"), null);
  assert.equal(matchApiRoute("GET", "/api/does-not-exist"), null);

  const detail = matchApiRoute("GET", "/api/reports/2026-07-06-abc");
  assert.ok(detail);
  assert.deepEqual(detail.params, ["2026-07-06-abc"]);

  const encoded = matchApiRoute("GET", "/api/quote/%E6%B2%AA%E6%B7%B1300");
  assert.ok(encoded);
  assert.deepEqual(encoded.params, ["沪深300"]);

  const exportRoute = matchApiRoute("GET", "/api/export/positions.csv");
  assert.ok(exportRoute);
  assert.deepEqual(exportRoute.params, ["positions", "csv"]);
});

test("protected route handlers are dispatchable in isolation (A2-3)", async () => {
  const { route } = matchApiRoute("GET", "/api/status");
  assert.equal(route.public, undefined);
  const result = await route.handler({ req: {}, url: new URL("http://x/api/status"), params: [], body: {} });
  assert.equal(result.status, 200);
  assert.equal(result.body.app, "financial_knowledge");
});

test("public auth session handler responds without session cookie", async () => {
  const { route } = matchApiRoute("GET", "/api/auth/session");
  assert.equal(route.public, true);
  const result = await route.handler({ req: { headers: {} }, url: new URL("http://x/api/auth/session"), params: [], body: {} });
  assert.equal(result.status, 200);
  assert.equal(typeof result.body.authenticated, "boolean");
});

test("report import handler rejects requests without import token when auth enabled", async (t) => {
  process.env.FINANCE_KNOWLEDGE_AUTH_PASSWORD = "test-password";
  process.env.FINANCE_KNOWLEDGE_IMPORT_TOKEN = "test-token";
  t.after(() => {
    delete process.env.FINANCE_KNOWLEDGE_AUTH_PASSWORD;
    delete process.env.FINANCE_KNOWLEDGE_IMPORT_TOKEN;
  });

  const { route } = matchApiRoute("POST", "/api/reports/import");
  assert.equal(route.public, true);
  const denied = await route.handler({ req: { headers: {} }, url: new URL("http://x/api/reports/import"), params: [], body: { title: "t" } });
  assert.equal(denied.status, 401);
});

test("GET /api/pressure is protected and returns two themes (P4-1, P4-4)", async () => {
  const matched = matchApiRoute("GET", "/api/pressure");
  assert.ok(matched, "route registered in table");
  assert.equal(matched.route.public, undefined, "pressure route is protected");
  const result = await matched.route.handler({ req: {}, url: new URL("http://x/api/pressure"), params: [], body: {} });
  assert.equal(result.status, 200);
  assert.ok(Array.isArray(result.body.themes));
  assert.equal(result.body.themes.length, 2);
  // 新库无 daily_bars → 降级但结构完整（P4-2）
  for (const theme of result.body.themes) {
    assert.ok(theme.id && theme.name);
    assert.ok("composite" in theme && "subScores" in theme && Array.isArray(theme.series30));
  }
});

