import { afterEach, expect, test, vi } from "vitest";
import { api } from "@/api/client";

afterEach(() => {
  vi.unstubAllGlobals();
  document.cookie = "fk_csrf=; Max-Age=0; path=/";
});

test("写请求自动携带 CSRF 且保持同源 cookie", async () => {
  document.cookie = "fk_csrf=csrf-token; path=/";
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } }),
  );
  vi.stubGlobal("fetch", fetchMock);

  await api.post("/debates", { instrument_id: "i1" });
  const [url, options] = fetchMock.mock.calls[0];
  expect(url).toBe("/api/v1/debates");
  expect(options.credentials).toBe("same-origin");
  expect(options.headers["X-CSRF-Token"]).toBe("csrf-token");
});

test("写请求缺少 CSRF cookie 时先续签再发送", async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ csrf_token: "fresh-token" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    )
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  vi.stubGlobal("fetch", fetchMock);

  await api.post("/debates", { instrument_id: "i1" });

  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(fetchMock.mock.calls[0][0]).toBe("/api/v1/auth/csrf");
  expect(fetchMock.mock.calls[1][1].headers["X-CSRF-Token"]).toBe("fresh-token");
});

test("写请求遇到过期 CSRF 时续签并仅重试一次", async () => {
  document.cookie = "fk_csrf=expired-token; path=/";
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ detail: "CSRF 校验失败" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      }),
    )
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ csrf_token: "fresh-token" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    )
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  vi.stubGlobal("fetch", fetchMock);

  await api.post("/debates", { instrument_id: "i1" });

  expect(fetchMock).toHaveBeenCalledTimes(3);
  expect(fetchMock.mock.calls[0][1].headers["X-CSRF-Token"]).toBe("expired-token");
  expect(fetchMock.mock.calls[1][0]).toBe("/api/v1/auth/csrf");
  expect(fetchMock.mock.calls[2][1].headers["X-CSRF-Token"]).toBe("fresh-token");
});

test("保留后端结构化错误 detail", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ detail: "duplicate_active" }), {
      status: 409,
      headers: { "Content-Type": "application/json" },
    }),
  ));
  await expect(api.post("/debates", {})).rejects.toEqual(expect.objectContaining({
    status: 409,
    detail: "duplicate_active",
  }));
});
