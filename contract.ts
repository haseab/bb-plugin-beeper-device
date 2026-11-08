import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const unreadSchema = z
  .object({
    status: z.enum(["connected", "disconnected", "error"]),
    count: z.number().int().nonnegative().nullable(),
    message: z.string().max(500).nullable(),
  })
  .strict();
export type Unread = z.infer<typeof unreadSchema>;
export const actionSchema = z.object({ ok: z.boolean(), message: z.string().max(500) }).strict();
export const hostContract = defineRpcContract({
  unread: { input: z.null(), output: unreadSchema, experimental_retryable: true },
  connect: { input: z.null(), output: actionSchema },
  disconnect: { input: z.null(), output: actionSchema },
});
export const snapshotSchema = z
  .object({
    status: z.enum(["connected", "disconnected", "error", "offline"]),
    hostId: z.string().nullable(),
    hostName: z.string().nullable(),
    count: z.number().int().nonnegative().nullable(),
    lastCount: z.number().int().nonnegative().nullable(),
    checkedAt: z.number().nullable(),
    message: z.string().max(500).nullable(),
  })
  .strict();
export type Snapshot = z.infer<typeof snapshotSchema>;
export const rpcContract = defineRpcContract({
  snapshot: { input: z.null(), output: snapshotSchema },
  connect: { input: z.null(), output: actionSchema },
  disconnect: { input: z.null(), output: actionSchema },
});
