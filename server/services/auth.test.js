import assert from "node:assert/strict";
import test from "node:test";

import { login, logoutCookie } from "./auth.js";

test("production session cookies are Secure by default", (t) => {
  withEnv(t, {
    NODE_ENV: "production",
    FINANCE_KNOWLEDGE_AUTH_PASSWORD: "test-password",
    FINANCE_KNOWLEDGE_AUTH_SECRET: "test-secret",
    FINANCE_KNOWLEDGE_COOKIE_SECURE: undefined
  });

  const result = login({ username: "admin", password: "test-password" });
  assert.equal(result.ok, true);
  assert.match(result.cookie, /; Secure(?:;|$)/);
});

test("HTTP deployments can opt out of Secure session cookies", (t) => {
  withEnv(t, {
    NODE_ENV: "production",
    FINANCE_KNOWLEDGE_AUTH_PASSWORD: "test-password",
    FINANCE_KNOWLEDGE_AUTH_SECRET: "test-secret",
    FINANCE_KNOWLEDGE_COOKIE_SECURE: "false"
  });

  const result = login({ username: "admin", password: "test-password" });
  assert.equal(result.ok, true);
  assert.doesNotMatch(result.cookie, /; Secure(?:;|$)/);
  assert.doesNotMatch(logoutCookie(), /; Secure(?:;|$)/);
});

function withEnv(t, values) {
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}
