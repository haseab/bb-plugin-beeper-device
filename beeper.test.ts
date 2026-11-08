import { afterEach, expect, it, vi } from "vitest";
import { readUnread } from "./beeper.js";

afterEach(() => vi.unstubAllGlobals());
it("checks only the local primary Inbox and deduplicates all pages without returning chats", async () => {
  const fetch = vi.fn(async (url: URL, init: RequestInit) => {
    expect(url.origin).toBe("http://localhost:23373");
    expect(url.searchParams.get("inbox")).toBe("primary");
    expect(url.searchParams.get("unreadOnly")).toBe("true");
    expect(init.method).toBe("GET");
    expect(init.redirect).toBe("error");
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer private-token");
    return Response.json(
      url.searchParams.has("cursor")
        ? {
            items: [{ id: "one" }, { id: "two", preview: "private" }],
            hasMore: false,
            oldestCursor: null,
          }
        : { items: [{ id: "one" }], hasMore: true, oldestCursor: "cursor-1" },
    );
  });
  vi.stubGlobal("fetch", fetch);
  expect(await readUnread("private-token", new AbortController().signal)).toEqual({
    status: "connected",
    count: 2,
    message: null,
  });
  expect(fetch).toHaveBeenCalledTimes(2);
});
it.each([401, 403])("handles expired credentials (%i) without a false zero", async (status) => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("private error", { status })),
  );
  expect(await readUnread("secret", new AbortController().signal)).toMatchObject({
    status: "disconnected",
    count: null,
  });
});
it("bounds cyclic pagination and sanitizes network errors", async () => {
  const fetch = vi.fn(async () =>
    Response.json({ items: [], hasMore: true, oldestCursor: "same" }),
  );
  vi.stubGlobal("fetch", fetch);
  const result = await readUnread("secret", new AbortController().signal);
  expect(result).toMatchObject({ status: "error", count: null });
  expect(fetch).toHaveBeenCalledTimes(2);
  fetch.mockRejectedValueOnce(new Error("token-secret"));
  expect(JSON.stringify(await readUnread("secret", new AbortController().signal))).not.toContain(
    "token-secret",
  );
});
