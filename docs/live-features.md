# Live map and live view of a player's screen

Two panel features that need the server resource to report back to txAdmin. Neither has been run in a real FXServer yet, only in the test setups listed at the end.

## Live map (`/map`)

Shows where every player is on the satellite map, refreshed every 1.5 to 5 seconds while the page is open.

- **Needs OneSync.** Without it the server does not know where the players are, and the page says so.
- **Needs the `players.spectate` permission**, as knowing where everybody is goes with being able to spectate them.
- How it works: the page joins the `playermap` websocket room. While someone is in that room the core asks the server resource every 5 seconds (`txAdmin:events:playerPositionsWanted`, valid for 20 seconds), and `sv_playerlist.lua` answers with `[netid, x, y, vehicleType]` per player through `PrintStructuredTrace`. When nobody watches, nothing is reported. The core checks the report (at most 4096 players, 4 numbers per player, finite coordinates inside the map) and drops an entry that is not valid without losing the others, and only the `monitor` resource of the current server run can send it. If the reports stop, the positions are cleared after 15 seconds.
- The player modal opens when you click a player. Players that would overlap are merged into a numbered cluster, a click on it lists them.

## Live view of a player's screen ("Screen" in the player modal)

Shows the game screen of a player as a smooth stream of images, up to 20 per second. It is **not a video of the desktop and has no sound**: the player's game draws its own screen into small jpeg images and sends them, and the panel shows them as an image that never ends.

If the player's game cannot stream, or the stream never starts, the viewer falls back by itself to one screenshot about every 1.5 seconds (see below).

### Setup
Nothing to install: the live view is part of the `monitor` resource. Give the admins that should use it the `players.spectate` permission (seeing the screen shows what spectating shows).

### How it works
1. The admin opens "Screen". The panel asks the core to start a live view (`POST /player/screenStreamStart`, with the usual CSRF header) and gets a session id and a secret **view token**.
2. The core tells the server resource (`txAdmin:events:screenStreamStart`), which gives the player's game an **upload token** (`txcl:screenStreamStart`, `cl_stream.lua`). The game builds the address itself from its own server endpoint (`http://<endpoint>/monitor/stream/<token>`): a different address sent by anyone is never used.
3. The menu page of the game (`nui/`, loaded for every player) draws the game texture on a canvas of the stream size with a WebGL pass (up to 4x4 samples per pixel, the downscale is done by the graphics card), encodes a jpeg and posts it to `sv_stream.lua`, which forwards it to the core (`/intercom/screenstream`). It sends the next frame without waiting for the answer to the last one (two at most), so the frame rate is not capped by the round trip.
4. The core relays the frames to the panel as `multipart/x-mixed-replace`, which an `<img>` plays. The image request uses the session cookie plus the view token, because an `<img>` cannot send the CSRF header: only the admin who started the view can watch it, and the token only exists in the answer of the CSRF protected start request.

Quality presets in the panel: light (8 fps, 480 px), smooth (12 fps, 640 px, the default), sharp (20 fps, 960 px). A 640 px frame of a busy picture is about 30 KB, so a smooth stream is about 0.4 MB/s from the player and to the admin, a sharp one about 1 MB/s.

### What txAdmin does and limits
- One live view per player (another admin gets "already watching", unless the netid now belongs to another player, in which case the old view of the player who left ends), 3 at once on the server, 3 browser tabs per view.
- A view ends: when the admin closes it or starts another, 15 seconds after the last image request went away, 12 seconds after the start if the game sent nothing (the viewer then switches to screenshots), 20 seconds after the game stopped sending, after 10 minutes (starting again is a new view and is logged), when the admin is deleted, loses `players.spectate`, changes password or changes the linked cfx.re account (checked every second), when the server stops and when txAdmin shuts down. A browser connection that stops reading for 5 seconds is cut (its frames were already dropped), and when the last viewer is gone the view ends 15 seconds later. A logout alone is not noticed: the page closing the image ends the view 15 seconds later.
- Every view is written to the admin log when it starts and when it stops, with the frames, the duration, the average fps and why it ended.
- On the server resource: tokens live for the time the core gave them and at most 11 minutes (the game timer is read as a difference modulo 2^32, so its wrap after about 24.8 days does not matter), 8 streams at most, frames above 400000 characters are refused (the content length is checked before the body is read), at most two frames are being forwarded for a stream and they must be 30 ms apart, anything else is dropped. The event that carries the upload token is not broadcast to the other resources of the server (`txAdmin:events:screenStreamStart` is never triggered), they could otherwise read it and feed pictures to the admin. The session id the core receives comes from the server's own table, never from the request.
- In the core a frame is only relayed when it is strict base64, at most 400000 characters, starts and ends like a jpeg, and **declares a size that fits the view that was asked for**: at most the requested width (the game scales to it) and twice that in height, and in any case 4096 pixels per side and 8.5 megapixels (the player's game could declare 30000x30000 and make the browser of the admin allocate gigabytes, or send 4K frames to make it work harder). Frames that come faster than 1.5 times the requested rate are dropped, and so are frames for a connection that is slow, never queued. The image has `X-Content-Type-Options: nosniff`.
- The commands that carry the live view and screenshot requests are not written to the console and the log (the live view start carries the upload token).
- The status the panel polls reports 0 fps when the player stopped sending. The in-game menu (NUI) keeps using screenshots: an image cannot send the CSRF header and there is no cookie there.

### Screenshots (the fallback, and "Screenshots" in the viewer)
One screenshot after another about every 1.5 seconds, taken by the [`screenshot-basic`](https://github.com/citizenfx/screenshot-basic) resource, which txAdmin does not bundle: install it and add `ensure screenshot-basic` to the `server.cfg`. Without it the viewer says it is missing.
- One capture per player at a time and at most once a second. Two admins on the same player share the capture that is on its way or the frame that just came back. At most five captures wait at once, two per admin, 8 seconds to answer.
- Written to the admin log like the live view. It ends after 10 minutes and the viewer offers "Keep watching"; closing it and opening it again starts a new, logged, viewing, so the limit is a reminder and not a lock.
- The image is checked before it is shown: a jpeg or png data URI, base64 only, 600000 characters at most, and the same size limit as above.

### Things to know
- The images are made by **the player's game client**. A modified client can send any picture or none, so it is a way to look, not a proof of what the player does.
- It shows the game view, not the desktop. A browser tab in the background keeps its stream until the view ends or the tab closes.
- Watching players' screens is personal data processing. Say it in the server rules (and, in the EU, in your privacy information) before using it. **There is no notice shown to the player in game.**
- A reverse proxy in front of the panel can buffer the image and make it jerky. Turn buffering off for `/player/screenStream/` (the response sends `X-Accel-Buffering: no`).

## Tested how
- Core: unit tests for the positions module (per entry validation, stale positions), the room permission, the fd3 dispatch (only the monitor resource of the current run), the live view manager (limits, validation, how it ends, revoked permission, audit log), the image size reader, the screenshot manager (sharing, limits, validation, audit log, expiry), the routes and the intercom scopes. The view route is also tested over real HTTP with the real session and top level middlewares.
- Lua: `scripts/lua-tests/luatest.py` runs `sv_playerlist.lua`, `sv_screenshot.lua`, `sv_stream.lua` and `cl_stream.lua` in an embedded Lua with stubbed natives (109 checks), 19 hand made mutations of the stream guards are all caught.
- NUI: `npm run test -w nui` for the frame loop (pacing, two frames in flight, stop, failures, restart) and the message filter.
- Panel: unit tests for the map geometry, clustering, zoom math, the screenshot loop and the live view status logic, and headless Chromium against `scripts/dev/panel-harness.cjs`, a stand-in core (`SHOT=ok|missing|expire|flaky` plays the screenshot cases).
- Browser, whole chain except the game: a second page runs the real NUI code on a drawn picture, the real core modules relay it, and the panel shows it moving; changing the preset restarts the view at 960 px, closing stops the game side and writes the log, and a game that never answers makes the viewer fall back to screenshots. In headless Chromium with a software GL and 30 ms of simulated latency a busy 640 px picture reaches about 18.6 fps for 20 asked.
- **Not tested: any of it inside a real FXServer and a real game.** In particular the game texture handshake (the one of the CitizenFX build of three.js, `CfxTexture`), the real frame rate with the game running, that `SetHttpHandler` gives `req.path` without `/monitor`, the header names and an asynchronous `res.send`, and that the endpoint `GetCurrentServerEndpoint()` gives is reachable over plain http from the menu page (it is what `screenshot-basic` does).
