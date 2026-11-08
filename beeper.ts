import { z } from "zod";
import type { Unread } from "./contract.js";

const pageSchema = z.object({
  items: z.array(z.object({ id: z.string() })).max(200),
  hasMore: z.boolean(),
  oldestCursor: z.string().nullable(),
});

// Keep credentials, chat IDs and any discarded previews on the selected host.
export async function readUnread(token: string, signal: AbortSignal): Promise<Unread> {
  try {
    const ids = new Set<string>();
    const cursors = new Set<string>();
    let cursor: string | null = null;
    for (let pageNumber = 0; pageNumber < 1000; pageNumber++) {
      const url = new URL("http://localhost:23373/v1/chats/search");
      url.searchParams.set("limit", "200");
      url.searchParams.set("inbox", "primary");
      url.searchParams.set("unreadOnly", "true");
      url.searchParams.set("includeMuted", "true");
      if (cursor) {
        url.searchParams.set("cursor", cursor);
        url.searchParams.set("direction", "before");
      }
      const response = await fetch(url, {
        method: "GET",
        headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
        redirect: "error",
        cache: "no-store",
        signal,
      });
      if (response.status === 401 || response.status === 403)
        return {
          status: "disconnected",
          count: null,
          message: "Reconnect Beeper on the selected machine",
        };
      if (!response.ok) throw new Error("Beeper request failed");
      const page = pageSchema.parse(await response.json());
      for (const chat of page.items) ids.add(chat.id);
      if (!page.hasMore) return { status: "connected", count: ids.size, message: null };
      if (!page.oldestCursor || cursors.has(page.oldestCursor))
        throw new Error("Invalid pagination");
      cursor = page.oldestCursor;
      cursors.add(cursor);
    }
    throw new Error("Pagination limit exceeded");
  } catch {
    return {
      status: "error",
      count: null,
      message: "Beeper unavailable; check that its Desktop API is running",
    };
  }
}
