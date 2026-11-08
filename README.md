# Beeper Device

Reads Beeper's primary Inbox unread conversation count on one explicitly selected
BB machine. BB manages the host worker. No LaunchAgent, terminal process, public
port, app rebuild, or desktop restart is needed. Switching viewing devices does
not change the source machine.

This plugin provides a CLI and a typed RPC endpoint. It does **not** add a badge
to BB's stock sidebar. The sidebar integration described below is optional and
requires a separate custom Sidebar plugin that supports `beeperSource`.

## Requirements

- BB with Plugin SDK 0.6.132 or later and support for managed host entries.
- An enrolled, connected macOS machine running Beeper Desktop with Desktop API
  enabled at `http://localhost:23373`.
- Beeper authorization on that machine. It must remain awake and connected for
  checks to work.

## Setup

1. Enable Beeper Desktop API on the source Mac in Beeper Settings → Developers.
2. Install the release:

   ```sh
   bb plugin install git:https://github.com/haseab/bb-plugin-beeper-device.git@v0.1.0
   ```
3. Find the source ID with `bb machine list --json`, then run
   `bb plugin config beeper-device set hostId host_...`.
4. Run `bb beeper-device connect`. Approve **BB Beeper Device** in the browser
   opened on the selected Mac. Authorization times out after three minutes.
5. Verify `bb beeper-device status`. This is sufficient to use the standalone
   plugin. If you have a custom Sidebar plugin with Beeper source selection,
   select **Selected machine (Beeper Device)** in that plugin's settings (CLI:
   `bb plugin config sidebar set beeperSource device`).

For automatic compatible updates, install with `@^0.1.0` instead of `@v0.1.0`.
Use `bb plugin outdated` and `bb plugin update beeper-device` to check and update.

Tokens are saved atomically with mode 0600 in the plugin's host-local data
directory (`beeper-oauth.json`). They never cross host RPC. The source API stays
on localhost. OAuth uses PKCE and a state-validated temporary 127.0.0.1 callback;
it requests `read` scope (Beeper may grant broader scopes). Checking uses GET
only, deduplicates chat IDs across pages and discards message previews locally.
It never marks messages read or sends messages.

## Operation

Checks run when the CLI or an integration requests a snapshot. An optional
sidebar can request it at a two-second cadence; concurrent clients share one
request and a two-second server cache. There is no autonomous checker when nobody
requests a count. BB lazily starts and reuses the host worker.
No polling timer or retained worker lease is needed except while authorizing.
Timeouts, sleep and network disconnects yield unavailable status, never a fresh
zero. The plugin retains the last successful count/time in memory; the sidebar
hides a stale badge and includes the last result in its status message. A later
request automatically recovers after the source Mac reconnects. Tokens that
expire require `bb beeper-device connect` again.

## Undo

Disable the standalone plugin:

```sh
bb plugin disable beeper-device
```

If you also enabled the optional custom Sidebar integration, first switch it
back to its local source, leaving its local credentials unchanged:

```sh
bb plugin config sidebar set beeperSource local
bb plugin disable beeper-device
```

Disable/reload/removal aborts host calls, closes pending authorization sockets and
timers, releases the authorization lease and stops BB's host worker. There are no
OS services to clean up. If the source is offline, the disconnected daemon cannot
perform checks and BB reconciles the disabled generation on reconnect.

For full removal, while the selected source is online:

```sh
bb beeper-device disconnect
bb plugin remove beeper-device
```

`disconnect` must succeed before removal if you want the host-local token deleted;
removing a server plugin alone may leave its host data on an offline machine.
Delete the approved connection named **BB Beeper Device** in Beeper too if you
want the grant revoked. Disconnect removes this plugin's stored token, rather
than modifying Beeper's approved connections. To clean multiple previously
selected hosts, select each host and disconnect before removing the plugin.

The custom Sidebar code is not included in this repository. Its integration can
call this plugin's `snapshot` RPC and map the result to its own UI. The plugin is
also usable entirely through `bb beeper-device status`.

## RPC integration

From another loaded BB plugin, call:

```ts
await bb.sdk.plugins.callRpc({
  pluginId: "beeper-device",
  method: "snapshot",
  input: null,
  outputSchema: snapshotSchema,
});
```

Define a compatible validator using the `snapshotSchema` in `contract.ts` as the
reference. Its fields are `status` (`connected`, `disconnected`, `error`, or
`offline`), `hostId`, `hostName`, `count`, `lastCount`, `checkedAt` (Unix milliseconds),
and `message`. Unavailable values are `null`. Treat `lastCount` as stale whenever
the status is not `connected`; never display it as a fresh count. Returned host
names and IDs are the installing user's local configuration, not hardcoded here.

## Development

With BB's CLI and a supported Node.js LTS version installed:

```sh
npm ci
npm test
npm run typecheck
npm run lint
npm run format:check
bb plugin build .
```

Only published public SDK APIs are used. The server and host share their typed
RPC contract; no sibling plugin or BB source imports are required.

## License

MIT. See [LICENSE](LICENSE).
