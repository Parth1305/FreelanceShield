import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

async function loadWorker() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}-${Math.random()}`);
  return (await import(workerUrl.href)).default;
}

function runtimeEnv() {
  return {
    ASSETS: {
      fetch: async () => new Response("Not found", { status: 404 }),
    },
  };
}

function executionContext() {
  return {
    waitUntil() {},
    passThroughOnException() {},
  };
}

test("server-renders the FreelanceShield account entry point", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    runtimeEnv(),
    executionContext(),
  );
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /FreelanceShield/);
  assert.match(html, /Work delivered/);
  assert.match(html, /Payments protected/);
  assert.match(html, /MetaMask signs them/);
  assert.match(html, /Sign in securely/);
  assert.doesNotMatch(html, /Your site is taking shape|Building your site/);
});

test("includes every backend route in the production build", async () => {
  const routeFiles = [
    "../app/api/auth/register/route.ts",
    "../app/api/auth/login/route.ts",
    "../app/api/auth/me/route.ts",
    "../app/api/projects/route.ts",
    "../app/api/projects/[projectId]/route.ts",
    "../app/api/projects/[projectId]/milestones/[milestoneId]/submit/route.ts",
    "../app/api/projects/[projectId]/milestones/[milestoneId]/approve/route.ts",
    "../app/api/projects/[projectId]/milestones/[milestoneId]/reject/route.ts",
    "../app/api/projects/[projectId]/milestones/[milestoneId]/dispute/route.ts",
  ];
  await Promise.all(routeFiles.map((path) => access(new URL(path, import.meta.url))));
  const bundle = await readFile(new URL("../dist/server/index.js", import.meta.url), "utf8");
  for (const route of [
    "/api/auth/register",
    "/api/auth/login",
    "/api/auth/me",
    "/api/projects",
    "/api/projects/:projectId",
    "/api/projects/:projectId/milestones/:milestoneId/submit",
    "/api/projects/:projectId/milestones/:milestoneId/approve",
    "/api/projects/:projectId/milestones/:milestoneId/reject",
    "/api/projects/:projectId/milestones/:milestoneId/dispute",
  ]) {
    assert.match(bundle, new RegExp(route.replaceAll("/", "\\/")));
  }
});
