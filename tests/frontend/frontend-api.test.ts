import assert from "node:assert/strict";
import test from "node:test";
import { apiRequest, FrontendApiError } from "../../app/lib/frontend-api";
import { formatEth, shortAddress } from "../../app/lib/wallet";

test("wallet display helpers format addresses and wei consistently", () => {
  assert.equal(shortAddress("0x52908400098527886e0f7030069857d2e4169ee7"), "0x5290…9EE7");
  assert.equal(shortAddress(null), "No wallet");
  assert.equal(formatEth("1250000000000000000"), "1.25 ETH");
  assert.equal(formatEth(0n), "0 ETH");
});

test("API client sends bearer authentication and parses successful JSON", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_input, init) => {
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("authorization"), "Bearer signed-token");
    assert.equal(headers.get("accept"), "application/json");
    return Response.json({ projects: [{ id: "project-1" }] });
  };
  try {
    const response = await apiRequest<{ projects: Array<{ id: string }> }>("/api/projects", {
      token: "signed-token",
    });
    assert.equal(response.projects[0].id, "project-1");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("API client preserves server status and error codes", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json({ error: "Wrong wallet", code: "transaction_mismatch" }, { status: 409 });
  try {
    await assert.rejects(
      () => apiRequest("/api/projects/project-1"),
      (error: unknown) =>
        error instanceof FrontendApiError &&
        error.status === 409 &&
        error.code === "transaction_mismatch",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
