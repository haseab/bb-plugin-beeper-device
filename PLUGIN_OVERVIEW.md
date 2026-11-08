## Beeper on a connected Mac

Check the unread conversation count in Beeper's primary Inbox on a selected
BB machine, even when BB's server runs elsewhere. The source Mac is selected
explicitly; opening BB on another device does not change it.

## What you get

- `bb beeper-device status` returns connection status, unread count and the last
  successful check time.
- `bb beeper-device connect` opens authorization on the source Mac.
- `bb beeper-device disconnect` removes this plugin's token on that Mac.
- A typed snapshot RPC lets other plugins display the result. A sidebar badge
  requires a separate compatible integration; the stock sidebar is not modified.

## How it works

BB manages the host worker and stops it when the plugin is disabled or removed.
The token stays on the source Mac in a private file. Only counts and connection
status return to BB. Checks run on demand; there is no installed macOS service,
public Beeper endpoint, message sending or marking messages read.

## Requirements

Requires BB with managed host entries, an enrolled macOS machine running Beeper
Desktop, Desktop API enabled, and user authorization on that Mac. The Mac must
be awake and connected. No separate service subscription is introduced by this
plugin. Expired tokens need authorization again. Disable the plugin to stop it;
disconnect before uninstalling to remove the token from an online source Mac.
