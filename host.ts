import { experimental_defineHostEntry } from "@get-bb/plugin-sdk";
import { Authorization } from "./authorization.js";
import { readUnread } from "./beeper.js";
import { hostContract } from "./contract.js";
import { clearCredentials, loadCredentials } from "./credentials.js";

const authorization = new Authorization();
export default experimental_defineHostEntry({
  contract: hostContract,
  handlers: {
    unread: async (_input, context) => {
      try {
        const credentials = await loadCredentials(context.experimental_paths.dataDir);
        if (!credentials)
          return {
            status: "disconnected" as const,
            count: null,
            message:
              authorization.message === "Beeper connected"
                ? "Reconnect Beeper on the selected machine"
                : authorization.message,
          };
        return readUnread(
          credentials.accessToken,
          AbortSignal.any([context.signal, context.lifecycle.signal, AbortSignal.timeout(10_000)]),
        );
      } catch {
        return {
          status: "error" as const,
          count: null,
          message: "Could not read Beeper credentials; reconnect on this machine",
        };
      }
    },
    connect: (_input, context) => authorization.start(context),
    disconnect: async (_input, context) => {
      await authorization.stop();
      await clearCredentials(context.experimental_paths.dataDir);
      authorization.message = "Connect Beeper on the selected machine";
      return { ok: true, message: "Local Beeper credentials removed" };
    },
  },
  dispose: () => authorization.stop(),
});
