import { mkdtemp, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, it } from "vitest";
import { clearCredentials, loadCredentials, saveCredentials } from "./credentials.js";

it("persists tokens privately, expires them, and removes only its own credential file", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bb-beeper-test-"));
  try {
    expect(await loadCredentials(directory)).toBeNull();
    await saveCredentials(directory, { accessToken: "secret", expiresAt: null });
    expect((await stat(join(directory, "beeper-oauth.json"))).mode & 0o777).toBe(0o600);
    expect(await loadCredentials(directory)).toEqual({ accessToken: "secret", expiresAt: null });
    await saveCredentials(directory, { accessToken: "expired", expiresAt: Date.now() - 1 });
    expect(await loadCredentials(directory)).toBeNull();
    await clearCredentials(directory);
    await clearCredentials(directory);
    expect(await loadCredentials(directory)).toBeNull();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
