import test from "node:test";
import assert from "node:assert/strict";
import { loginRedirect } from "../../src/auth/login.js";

test("keeps local redirect paths", () => {
  assert.equal(loginRedirect("/settings"), "/settings");
});

test("rejects external redirect values", () => {
  assert.equal(loginRedirect("https://example.com"), "/dashboard");
});
