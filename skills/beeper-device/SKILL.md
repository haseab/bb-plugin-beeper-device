---
name: beeper-device
description: Check or authorize Beeper unread counts on a selected connected BB machine, or roll back to the sidebar's local Beeper checker.
---

# Beeper Device

`bb beeper-device status` returns only count, source machine, status and last
successful check time. It does not expose credentials or messages.

Configure the explicit host using `bb machine list --json` and
`bb plugin config beeper-device set hostId <host-id>`. Never silently change the
source based on which device is viewing BB. Selecting a different host does not
delete the old host's credentials.

`bb beeper-device connect` opens Beeper authorization on that host. The user
approves BB Beeper Device there within three minutes. The token stays in the
plugin's host-local data directory, mode 0600. Never print or transfer it.

This standalone plugin adds a CLI and RPC, not a stock sidebar badge. If a
separately installed custom Sidebar plugin supports `beeperSource`, enable its
bridge with `bb plugin config sidebar set beeperSource device`. Its default
`local` source preserves its original server-side checker. Do not set Sidebar
settings if no compatible integration is installed. The remote source needs the
source Mac awake, connected and running Beeper Desktop API.

Rollback: `bb plugin disable beeper-device`. If using the optional Sidebar bridge,
first run `bb plugin config sidebar set beeperSource local`. BB disposes the
worker; no OS startup service exists. Full cleanup: while the selected host is online, use
`bb beeper-device disconnect` before `bb plugin remove beeper-device`. Disconnect
must succeed to confirm host-local credential removal. Select and disconnect
each previously configured host if needed. Removing the plugin while a host is
offline does not guarantee deletion of that host's stored token. Beeper's approved
connection can separately be revoked in Beeper Settings → Developers.

This plugin checks unread conversations only; it does not implement Slack's own
API or send/read/mark messages. Checks happen on demand through the visible
sidebar's existing polling and are coalesced across clients.
