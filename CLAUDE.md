# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for human
contributors.

## What this is

A Gladys Assistant **external integration** for Magic Home Wi-Fi lights and
sockets (Zengge firmwares: Magic Home Pro, Zengge, Surplife apps): a Node.js
service (Node 22+, ESM, no build step, no dependency but the SDK) in its own
sandboxed Docker container, talking to Gladys through
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js)
and to the devices **on the local network only** (`transports: ["local"]`).

A **device integration** (`type: "device"`, Gladys 5.1.1+). The protocol is
implemented in `src/magichome/` from the documentation of the open-source
[flux_led](https://github.com/lightinglibs/flux_led) library (LGPL: used as a
reference only, never copy its code). When a device misbehaves, compare with
flux_led first (`protocol.py`, `models_db.py`, `base_device.py`).

## Commands

```bash
npm install
npm test                                  # node --test, never touches the network
node --test test/app.test.js              # one file
node --test --test-name-pattern "scene"   # tests whose name matches
UPDATE_BASELINE=1 npm test                # rewrite test/fixtures/discovery.baseline.json (on purpose only)
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npm run format                            # Prettier, fix in place
npx github:GladysAssistant/integration-store . --skip-image-check
docs/illustrations/render.sh              # widget illustrations (Chrome, ImageMagick, Pillow)
scripts/build-cover.sh                    # cover.jpg from cover.svg (Inkscape, ImageMagick)
```

## Architecture

```
index.js                     SDK wiring only: createApp(gladys) + connect + start
src/app.js                   every handler: discovery, poll, commands, scenes, widgets, buttons
src/config.js                config_schema -> { hosts, pollMs, rescanMs, language }
src/devices.js               entry -> Gladys device (features), values, commands
src/states.js                state publication: created devices only, coalesced, 240/min, 429 pause
src/scenes.js                trigger / action keys, reachability events (30 s grace), event limiter
src/widgets.js               the `lights` and `light` widgets (pure, reused by docs/illustrations)
src/i18n.js                  runtime texts in en / fr / de / es (effect names included)
src/storage.js               JSON files in /data (devices.json: MAC -> address, model, capabilities)
src/magichome/constants.js   ports, power bytes, patterns, effect codes
src/magichome/models.js      model number -> description, protocol by firmware, colour modes
src/magichome/protocol.js    frames: builders (query, power, levels, effects) and parsers
src/magichome/light.js       raw state -> logical channels, view; command -> levels
src/magichome/color.js       RGB/HSV, white levels, Kelvin/mired
src/magichome/client.js      one TCP connection (5577): framing, requests, pushed frames
src/magichome/device.js      one device: protocol probe, state, serialized commands
src/magichome/discovery.js   UDP 48899: broadcast through Gladys, unicast probe of typed addresses
.github/scripts/release.mjs  version, changelog, version files, PR title checks
```

## Rules

- **External ids are forever**: `ext:{selector}:device:{MAC}` (12 lowercase
  hex digits; `ip-a-b-c-d` for a typed address that never answered the UDP
  search) and `…:<feature key>` (`power`, `brightness`, `color`,
  `temperature`). Config, action, field, widget, setting, trigger, variable
  and effect keys too (`EFFECTS` in src/magichome/constants.js).
- **Feature fields** compared by the Discover tab "Update" (category, type,
  unit, min, max, step, features added or removed): changing them forces users
  to delete and recreate their devices. `test/fixtures/discovery.baseline.json`
  pins them per model; update it only on purpose, with a migration note.
  `min`, `max`, `read_only` and `has_feedback` on EVERY feature.
- **Capabilities only grow** (`learnDevice`): a controller rewired in the
  app keeps the features of its device.
- **One TCP connection per device**, commands serialized (`device.serial`):
  the devices accept few connections and the Magic Home app holds one too.
- **Colour temperature in MIRED** (154-370), no unit: the scale of the Gladys
  slider. Brightness in %, colour as 0xRRGGBB at full value.
- **States**: only for the devices the user created, through
  `src/states.js` (300 states a minute at most on the Gladys side). Republish
  everything known in `onDeviceCreated`.
- **Scene events** on transitions only (offline after a 30 s grace, online
  only after an offline), flat scalar data, at most 250 a minute. Scene
  actions never change reachability, so they cannot loop.
- **The container rootfs is read-only**: the only writable folder is /data.
- **Widget content**: after any change, run `docs/illustrations/render.sh` and
  look at the four images. Respect the SDK text bounds (caption 80, button
  label 24, list of 8 cards).
- **User-facing text** exists in en, fr, de and es: manifest, `src/i18n.js`,
  `docs/*.md`, `README*.md`. `test/i18n.test.js` checks it. Effect names are
  the same in the manifest options and in `src/i18n.js`
  (test/manifest.test.js). Use the words of the Gladys UI (Discover /
  Découverte / Entdecken / Descubrir…).
- **Versions belong to the Release workflow**: never edit `version` in
  `package.json`, `package-lock.json` or the manifest, nor the `docker_image`
  tag.
- **Changelog**: Ne jamais éditer CHANGELOG.md à la main, il est généré à la
  release. Écris le titre de PR comme la ligne que l'utilisateur lira.
- **Style**: Prettier formats, ESLint catches mistakes. Comments explain why,
  in English. Tests never touch the network (fake devices on fake sockets in
  test/helpers.js).

## Pitfalls

- The container is behind the Docker bridge: a UDP broadcast from it never
  reaches the LAN. Discovery goes through `scanNetwork('udp-active-broadcast')`
  (one datagram, port 48899, declared in `network_discovery`; one active scan
  per 10 s). Unicast UDP and TCP from the container do cross the bridge.
- Legacy modules (MAC prefix `ACCF23`) speak the original protocol (no
  checksum) and only answer a discovery sent from port 48899.
- The protocol is chosen from the model number (byte 1 of the state) AND the
  firmware version (byte 10): the 0x35 bulb has four protocols.
- Some models carry their whites in the red / green slots (`channels`), CCT
  bulbs send temperature and brightness 0-100 instead of levels, the 25-byte
  firmware sets colours in HSV inside a version 2 envelope whose inner frame
  has NO checksum.
- `requiresTurnOn` protocols ignore levels and effects while off: power on
  first. The devices fade: a state read within ~2 s of a levels command shows
  values in between (`fadeUntil`).
- A power command may be answered by a power frame, a full state, or nothing:
  query the state, retry up to 3 times.
- Gladys does not send the user's language with a scan or a command: feature
  names and scene errors use the `language` setting.
