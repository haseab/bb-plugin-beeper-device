import { createHash, randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import { createServer, type Server } from "node:http";
import { promisify } from "node:util";
import type { ExperimentalHostRpcContext } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { saveCredentials } from "./credentials.js";

const runFile = promisify(execFile);
const base = "http://localhost:23373";
const clientSchema = z.object({ client_id: z.string().min(1).max(4096) });
const tokenSchema = z.object({
  access_token: z.string().min(1).max(16384),
  expires_in: z.number().positive().optional(),
});
type Session = {
  controller: AbortController;
  close: () => void;
  work?: Promise<void>;
};

// Only this temporary loopback callback listens on a port. No launch agents,
// public proxy, polling timer or background installation is needed.
export class Authorization {
  private session: Session | null = null;
  private activeWork: Promise<void> | undefined;
  message = "Connect Beeper on the selected machine";
  constructor(
    private readonly openBrowser = async (url: string) => {
      if (process.platform !== "darwin") throw new Error("Automatic authorization requires macOS");
      await runFile("/usr/bin/open", [url], { timeout: 5000 });
    },
  ) {}

  async start(context: ExperimentalHostRpcContext) {
    if (this.session || this.activeWork)
      return { ok: true, message: "Approve the Beeper connection on this machine" };
    const controller = new AbortController();
    const lease = context.experimental_retainWorker();
    let server: Server | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let closed = false;
    const onAbort = () => session.close();
    const session: Session = {
      controller,
      close: () => {
        if (closed) return;
        closed = true;
        controller.abort();
        clearTimeout(timer);
        context.lifecycle.signal.removeEventListener("abort", onAbort);
        server?.close();
        server?.closeAllConnections();
        lease.dispose();
        if (this.session === session) this.session = null;
      },
    };
    this.session = session;
    context.lifecycle.signal.addEventListener("abort", onAbort, { once: true });
    if (context.lifecycle.signal.aborted) session.close();
    const signal = AbortSignal.any([controller.signal, context.signal]);
    try {
      signal.throwIfAborted();
      const verifier = randomBytes(32).toString("base64url");
      const state = randomBytes(32).toString("base64url");
      let clientId = "";
      let redirectUri = "";
      let accepting = true;
      server = createServer((request, response) => {
        const url = new URL(request.url ?? "/", "http://127.0.0.1");
        response.setHeader("Content-Type", "text/plain; charset=utf-8");
        response.setHeader("Cache-Control", "no-store");
        response.setHeader("Referrer-Policy", "no-referrer");
        if (request.method !== "GET" || url.pathname !== "/callback") {
          response.writeHead(404).end("Not found");
          return;
        }
        if (url.searchParams.get("state") !== state) {
          response.writeHead(400).end("Invalid authorization state");
          return;
        }
        if (!accepting || !clientId) {
          response.writeHead(409).end("Authorization already handled");
          return;
        }
        accepting = false;
        const code = url.searchParams.get("code");
        if (!code || code.length > 8192 || url.searchParams.has("error")) {
          this.message = "Beeper authorization was declined; reconnect to try again";
          response
            .writeHead(400)
            .end("Beeper connection was not authorized. You can close this tab.");
          session.close();
          return;
        }
        session.work = (async () => {
          try {
            const result = await fetch(`${base}/oauth/token`, {
              method: "POST",
              headers: { "Content-Type": "application/x-www-form-urlencoded" },
              body: new URLSearchParams({
                grant_type: "authorization_code",
                client_id: clientId,
                code,
                redirect_uri: redirectUri,
                code_verifier: verifier,
              }),
              redirect: "error",
              signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]),
            });
            if (!result.ok) throw new Error("Token exchange failed");
            const token = tokenSchema.parse(await result.json());
            controller.signal.throwIfAborted();
            await saveCredentials(context.experimental_paths.dataDir, {
              accessToken: token.access_token,
              expiresAt: token.expires_in ? Date.now() + token.expires_in * 1000 : null,
            });
            this.message = "Beeper connected";
            response.end("Beeper connected to BB. You can close this tab.");
          } catch {
            this.message = "Beeper authorization failed; reconnect to try again";
            response
              .writeHead(400)
              .end("Beeper connection failed. Reconnect from BB to try again.");
          } finally {
            if (response.writableFinished) session.close();
            else response.once("finish", () => session.close());
          }
        })();
        this.activeWork = session.work;
        const work = session.work;
        void work.then(() => {
          if (this.activeWork === work) this.activeWork = undefined;
        });
      });
      server.requestTimeout = 10_000;
      server.headersTimeout = 5000;
      await new Promise<void>((resolve, reject) => {
        server!.once("error", reject);
        server!.listen(0, "127.0.0.1", () => {
          server!.removeListener("error", reject);
          resolve();
        });
      });
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Callback unavailable");
      redirectUri = `http://127.0.0.1:${address.port}/callback`;
      const registered = await fetch(`${base}/oauth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_name: "BB Beeper Device",
          redirect_uris: [redirectUri],
          grant_types: ["authorization_code"],
          response_types: ["code"],
          token_endpoint_auth_method: "none",
          scope: "read",
        }),
        redirect: "error",
        signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]),
      });
      if (!registered.ok) throw new Error("Registration failed");
      clientId = clientSchema.parse(await registered.json()).client_id;
      const url = new URL(`${base}/oauth/authorize`);
      url.search = new URLSearchParams({
        response_type: "code",
        client_id: clientId,
        redirect_uri: redirectUri,
        scope: "read",
        state,
        code_challenge_method: "S256",
        code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      }).toString();
      signal.throwIfAborted();
      this.message = "Approve the Beeper connection on this machine";
      timer = setTimeout(() => {
        this.message = "Beeper authorization timed out; reconnect to try again";
        session.close();
      }, 180_000);
      await this.openBrowser(url.href);
      signal.throwIfAborted();
      return { ok: true, message: this.message };
    } catch {
      this.message = "Could not open Beeper authorization; check its Desktop API is enabled";
      session.close();
      return { ok: false, message: this.message };
    }
  }

  async stop() {
    const session = this.session;
    session?.close();
    // A timeout may already have closed the session while its atomic token
    // write is finishing. Wait for it before disconnect deletes credentials.
    await this.activeWork;
  }
}
