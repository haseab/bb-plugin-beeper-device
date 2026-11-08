import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";

const credentialsSchema = z
  .object({
    accessToken: z.string().min(1).max(16384),
    expiresAt: z.number().nullable(),
  })
  .strict();
export type Credentials = z.infer<typeof credentialsSchema>;
const filename = "beeper-oauth.json";

export async function loadCredentials(dataDir: string): Promise<Credentials | null> {
  try {
    const parsed = credentialsSchema.parse(
      JSON.parse(await readFile(join(dataDir, filename), "utf8")),
    );
    return parsed.expiresAt !== null && parsed.expiresAt <= Date.now() ? null : parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new Error("Beeper credentials could not be read; reconnect Beeper");
  }
}

export async function saveCredentials(dataDir: string, credentials: Credentials) {
  const parsed = credentialsSchema.parse(credentials);
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  const temporary = join(dataDir, `${filename}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, JSON.stringify(parsed), { mode: 0o600, flag: "wx" });
    await rename(temporary, join(dataDir, filename));
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function clearCredentials(dataDir: string) {
  await rm(join(dataDir, filename), { force: true });
}
