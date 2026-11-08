import { cliCommand, defineCli, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { hostContract, rpcContract, type Snapshot } from "./contract.js";

export default function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    hostId: {
      type: "string",
      label: "Beeper machine ID",
      default: "",
      description: "The connected machine running Beeper. Use bb machine list to find its ID.",
      experimental_schema: z.string().regex(/^(host_[a-z0-9]+)?$/),
    },
  });
  const host = bb.hosts.experimental_client({ contract: hostContract });
  const lifecycle = new AbortController();
  bb.onDispose(() => lifecycle.abort());
  let generation = 0;
  let cached: { at: number; value: Snapshot } | null = null;
  let pending: { generation: number; promise: Promise<Snapshot> } | null = null;
  let last: { count: number; checkedAt: number } | null = null;
  const invalidate = () => {
    generation++;
    cached = null;
  };
  settings.onChange(() => {
    invalidate();
    last = null;
  });

  async function load(): Promise<Snapshot> {
    const current = generation;
    const { hostId } = await settings.get();
    let hostName: string | null = null;
    const state = (
      status: Snapshot["status"],
      message: string | null,
      count: number | null = null,
    ): Snapshot => ({
      status,
      hostId: hostId || null,
      hostName,
      count,
      lastCount: last?.count ?? null,
      checkedAt: last?.checkedAt ?? null,
      message,
    });
    if (!hostId) return state("disconnected", "Select a Beeper machine in Beeper Device settings");
    try {
      const machines = await bb.sdk.hosts.list();
      const machine = machines.find((item) => item.id === hostId);
      hostName = machine?.name ?? null;
      if (!machine || machine.status !== "connected")
        return state("offline", `${hostName ?? "Selected machine"} is offline`);
      const result = await host.call("unread", null, {
        hostId,
        signal: lifecycle.signal,
        timeoutMs: 15_000,
      });
      if (current !== generation) return state("disconnected", "Beeper source changed; refreshing");
      if (result.status === "connected" && result.count !== null)
        last = { count: result.count, checkedAt: Date.now() };
      return state(result.status, result.message, result.count);
    } catch {
      return state("error", `Beeper check unavailable on ${hostName ?? "the selected machine"}`);
    }
  }
  async function snapshot(): Promise<Snapshot> {
    if (cached && Date.now() - cached.at < 2000) return cached.value;
    if (pending?.generation === generation) return pending.promise;
    const current = generation;
    const at = Date.now();
    const promise = load()
      .then((value) => {
        if (generation === current) cached = { at, value };
        return value;
      })
      .finally(() => {
        if (pending?.generation === current) pending = null;
      });
    pending = { generation: current, promise };
    return promise;
  }
  async function action(method: "connect" | "disconnect") {
    const { hostId } = await settings.get();
    if (!hostId) return { ok: false, message: "Select a Beeper machine in Beeper Device settings" };
    // Forget the old count even when the action fails; a failed disconnect
    // must not be presented as successful credential removal.
    invalidate();
    last = null;
    try {
      return await host.call(method, null, { hostId, signal: lifecycle.signal, timeoutMs: 20_000 });
    } catch {
      return {
        ok: false,
        message: `${method === "connect" ? "Connect" : "Disconnect"} failed; the selected machine must be online`,
      };
    } finally {
      invalidate();
    }
  }
  bb.rpc.register(rpcContract, {
    snapshot,
    connect: () => action("connect"),
    disconnect: () => action("disconnect"),
  });
  bb.cli.register(
    defineCli({
      name: "beeper-device",
      summary: "Check or authorize Beeper on a selected connected machine",
      commands: {
        status: cliCommand({
          summary: "Read connection status, count, source machine and last successful check",
          async run() {
            return { exitCode: 0, stdout: JSON.stringify(await snapshot()) };
          },
        }),
        connect: cliCommand({
          summary: "Open Beeper authorization on the selected machine; credentials stay there",
          async run() {
            const result = await action("connect");
            return { exitCode: result.ok ? 0 : 1, stdout: JSON.stringify(result) };
          },
        }),
        disconnect: cliCommand({
          summary: "Cancel authorization and delete this plugin's token on the selected machine",
          async run() {
            const result = await action("disconnect");
            return { exitCode: result.ok ? 0 : 1, stdout: JSON.stringify(result) };
          },
        }),
      },
    }),
  );
}
