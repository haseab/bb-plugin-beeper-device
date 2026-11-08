import { createFakePluginHost, makeHostResponse } from "@get-bb/plugin-sdk/testing";
import { afterEach, expect, it, vi } from "vitest";
import plugin from "./server.js";

afterEach(() => vi.useRealTimers());
function setup() {
  let connected = true;
  const call = vi.fn(async () => ({ status: "connected", count: 4, message: null }));
  const fake = createFakePluginHost({
    pluginId: "beeper-device",
    settings: { hostId: "host_book" },
    sdk: {
      hosts: {
        list: async () => [
          makeHostResponse({
            id: "host_book",
            name: "MacBook",
            status: connected ? "connected" : "disconnected",
          }),
        ],
      },
    },
    experimental_callHostRpc: call,
  });
  plugin(fake.bb);
  return {
    ...fake,
    call,
    offline: () => {
      connected = false;
    },
  };
}
it("routes to the explicit host, coalesces clients and keeps stale counts out of fresh badges", async () => {
  vi.useFakeTimers();
  const { harness, call, offline } = setup();
  try {
    const [one, two] = await Promise.all([
      harness.behavior.callRpc("snapshot", null),
      harness.behavior.callRpc("snapshot", null),
    ]);
    expect(one).toEqual(two);
    expect(one).toMatchObject({ hostId: "host_book", count: 4, lastCount: 4, status: "connected" });
    expect(call).toHaveBeenCalledTimes(1);
    expect(harness.experimental_hostRpcCalls[0]).toMatchObject({
      hostId: "host_book",
      method: "unread",
      input: null,
    });
    offline();
    vi.advanceTimersByTime(2000);
    expect(await harness.behavior.callRpc("snapshot", null)).toMatchObject({
      status: "offline",
      count: null,
      lastCount: 4,
    });
    expect(call).toHaveBeenCalledTimes(1);
  } finally {
    await harness.lifecycle.dispose();
  }
});
it("does not carry a previous machine's count across source changes", async () => {
  const { harness } = setup();
  try {
    await harness.behavior.callRpc("snapshot", null);
    await harness.behavior.setSettings({ hostId: "host_other" });
    expect(await harness.behavior.callRpc("snapshot", null)).toMatchObject({
      hostId: "host_other",
      status: "offline",
      count: null,
      lastCount: null,
      checkedAt: null,
    });
  } finally {
    await harness.lifecycle.dispose();
  }
});
it("aborts active host work on disposal without exposing upstream details", async () => {
  const { harness, call } = setup();
  call.mockImplementationOnce(async () => {
    throw new Error("private upstream details");
  });
  const state = await harness.behavior.callRpc("snapshot", null);
  expect(state).toMatchObject({ status: "error", count: null });
  expect(JSON.stringify(state)).not.toContain("private upstream");
  const signal = harness.experimental_hostRpcCalls[0]!.signal;
  await harness.lifecycle.dispose();
  expect(signal?.aborted).toBe(true);
});
