import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { experimental_defineHostEntry } from "@get-bb/plugin-sdk";
import { experimental_createHostEntryHarness } from "@get-bb/plugin-sdk/testing/host";
import { afterEach, expect, it, vi } from "vitest";
import { Authorization } from "./authorization.js";
import { hostContract } from "./contract.js";
import { loadCredentials } from "./credentials.js";

const realFetch = globalThis.fetch;
afterEach(() => vi.unstubAllGlobals());
async function setup() {
  const dataDir = await mkdtemp(join(tmpdir(), "bb-beeper-auth-"));
  const open = vi.fn(async (_url: string) => {});
  const auth = new Authorization(open);
  const entry = experimental_defineHostEntry({
    contract: hostContract,
    handlers: {
      connect: (_input, context) => auth.start(context),
      unread: () => ({ status: "disconnected" as const, count: null, message: null }),
      disconnect: async () => {
        await auth.stop();
        return { ok: true, message: "Stopped" };
      },
    },
    dispose: () => auth.stop(),
  });
  const harness = experimental_createHostEntryHarness(entry, {
    experimental_paths: { dataDir, tempDir: dataDir },
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL, init?: RequestInit) => {
      if (String(url).endsWith("/oauth/register")) {
        const body = JSON.parse(String(init?.body));
        expect(body).toMatchObject({
          client_name: "BB Beeper Device",
          scope: "read",
          token_endpoint_auth_method: "none",
        });
        expect(body.redirect_uris[0]).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/);
        return Response.json({ client_id: "client-1" });
      }
      if (String(url).endsWith("/oauth/token")) {
        const body = init?.body as URLSearchParams;
        const verifier = body.get("code_verifier")!;
        const authorization = new URL(open.mock.calls[0]![0]);
        expect(createHash("sha256").update(verifier).digest("base64url")).toBe(
          authorization.searchParams.get("code_challenge"),
        );
        return Response.json({ access_token: "local-secret", expires_in: 3600 });
      }
      throw new Error("Unexpected external request");
    }),
  );
  return {
    harness,
    open,
    dataDir,
    cleanup: async () => {
      await harness.experimental_dispose();
      await rm(dataDir, { recursive: true, force: true });
    },
  };
}

it("uses PKCE, rejects an invalid state, saves only on the host and releases the authorization lease", async () => {
  const { harness, open, dataDir, cleanup } = await setup();
  try {
    expect(await harness.experimental_call("connect", null)).toMatchObject({ ok: true });
    expect(harness.experimental_getRetainedWorkerLeaseCount()).toBe(1);
    const authorization = new URL(open.mock.calls[0]![0]);
    expect(authorization.searchParams.get("scope")).toBe("read");
    const callback = new URL(authorization.searchParams.get("redirect_uri")!);
    callback.search = new URLSearchParams({
      code: "private-code",
      state: "wrong-state",
    }).toString();
    expect((await realFetch(callback)).status).toBe(400);
    expect(await loadCredentials(dataDir)).toBeNull();
    callback.searchParams.set("state", authorization.searchParams.get("state")!);
    const response = await realFetch(callback);
    expect(response.status).toBe(200);
    expect(await response.text()).not.toContain("local-secret");
    expect(await loadCredentials(dataDir)).toMatchObject({ accessToken: "local-secret" });
    expect(harness.experimental_getRetainedWorkerLeaseCount()).toBe(0);
  } finally {
    await cleanup();
  }
});

it("closes its callback and releases retained work when disabled during authorization", async () => {
  const { harness, open, dataDir, cleanup } = await setup();
  try {
    await harness.experimental_call("connect", null);
    await harness.experimental_call("connect", null);
    expect(open).toHaveBeenCalledTimes(1);
    const callback = new URL(new URL(open.mock.calls[0]![0]).searchParams.get("redirect_uri")!);
    await harness.experimental_dispose();
    expect(harness.experimental_getRetainedWorkerLeaseCount()).toBe(0);
    await expect(realFetch(callback)).rejects.toThrow();
    expect(await loadCredentials(dataDir)).toBeNull();
  } finally {
    await cleanup();
  }
});
