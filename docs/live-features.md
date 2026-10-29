# Live map and player screen viewer

Two panel features that need the server resource to report back to txAdmin. Neither has been run in a real FXServer yet, only in the test setups listed at the end.

## Live map (`/map`)

Shows where every player is on the satellite map, refreshed every 1.5 to 5 seconds while the page is open.

- **Needs OneSync.** Without it the server does not know where the players are, and the page says so.
- **Needs the `players.spectate` permission**, as knowing where everybody is goes with being able to spectate them.
- How it works: the page joins the `playermap` websocket room. While someone is in that room the core asks the server resource every 5 seconds (`txAdmin:events:playerPositionsWanted`, valid for 20 seconds), and `sv_playerlist.lua` answers with `[netid, x, y, vehicleType]` per player through `PrintStructuredTrace`. When nobody watches, nothing is reported. The core checks the report as a whole (4 numbers per player, finite coordinates, at most 4096 players) and ignores anything else, and only the `monitor` resource of the current server run can send it.
- The player modal opens when you click a player. Players that would overlap are merged into a numbered cluster, a click on it lists them.

## Player screen viewer ("Screen" in the player modal)

Shows the game screen of a player, as one screenshot after another about every 1.5 seconds. It is **not a video**: FiveM has no way to stream the screen, the viewer asks for a screenshot, shows it, and asks again.

### Setup
1. Install the [`screenshot-basic`](https://github.com/citizenfx/screenshot-basic) resource on the server and add `ensure screenshot-basic` to the `server.cfg`. txAdmin does not bundle it.
2. Give the admins that should use it the `players.spectate` permission (seeing the screen shows what spectating shows).

Without the resource the viewer says it is missing and stops.

### What txAdmin does and limits
- The core asks the server resource, which asks `screenshot-basic` to capture the player's game (jpg, quality 0.4 by default), and the image comes back through the intercom route, behind the intercom token.
- One capture per player at a time and at most one per second, at most five waiting at once, 8 seconds to answer.
- Every viewing is written to the admin log when it starts and when it stops (closed, paused, 15 seconds without a request, 10 minutes, server closed), with the number of screenshots. A viewing ends after 10 minutes and the admin has to choose "Keep watching".
- The image is checked before it is shown: a jpeg or png data URI, base64 only, 600000 characters at most. An error text from the server is never relayed, only known codes.

### Things to know
- The screenshot is made by **the player's game client**. A modified client can send any picture or none, so it is a way to look, not a proof of what the player does.
- It captures the game view, not the desktop.
- Watching players' screens is personal data processing. Say it in the server rules (and, in the EU, in your privacy information) before using it. There is no notice shown to the player in game.

## Tested how
- Core: unit tests for the positions module, the room permission, the fd3 dispatch (only the monitor resource of the current run), the screenshot manager (limits, validation, audit log, expiry), the routes and the intercom scope.
- Lua: `scripts/lua-tests/luatest.py` runs `sv_playerlist.lua` and `sv_screenshot.lua` in an embedded Lua with stubbed natives (53 checks in total).
- Panel: unit tests for the map geometry, clustering, zoom math and the viewer loop decisions, and headless Chromium against `scripts/dev/panel-harness.cjs`, a stand-in core (`SHOT=ok|missing|expire|flaky` plays the viewer cases).
- Not tested: any of it inside a real FXServer, including `screenshot-basic` itself.
