# Arcade: a personal platform for offline browser games

A static, dependency-free site that hosts every browser game you build, behind one launcher.
Everything is plain HTML, CSS and JavaScript. There is no backend, no build step to deploy and no network
request once the files are present, so it works from a folder on your disk **and** from any static host.

Games today:

| Game | Folder | What it is |
| --- | --- | --- |
| **Touge Drift** | `games/touge-drift/` | Top-down mountain-pass racing and drifting with real vehicle physics, a garage, a six-region career, AI rivals and ghosts |
| **Claude Ball** | `games/claudeball/` | 8-ball pool: vs the computer, local two-player, or encrypted online |

## Layout

```
index.html            the launcher (home page)          launcher.css / launcher.js
games.json            THE game list: edit this to add or change a game
registry.js           generated from games.json (works from file://)   <- do not edit
sw.js, sw-files.js    offline cache for the whole site (sw-files.js is generated)
manifest.webmanifest  installable launcher
assets/               covers/, icons/, back-to-library.js (shared control for games)
games/<id>/           each game is a self-contained folder with its own index.html
tools/                build-platform.js, new-game.js
tests/                headless + browser tests (see "Tests")
```

`index.html` must stay at the repository root: GitHub Pages and Cloudflare Pages serve the root.

## Running it

**From local files:** double-click `index.html`. The launcher and both games run with no server.
Each game also opens on its own (`games/touge-drift/index.html`, `games/claudeball/index.html`).
Chromium-based browsers and Firefox work; Safari works too but is the strictest about `file://` storage.

**From a static server** (needed for the offline cache / "install"): any server will do, for example
`python3 -m http.server` in this folder, then open `http://localhost:8000/`.

### Hosting

The repository root is the site. There is nothing to build.

* **GitHub Pages:** Settings, Pages, "Deploy from a branch", branch `main`, folder `/ (root)`.
* **Cloudflare Pages:** framework preset "None", build command empty, output directory `/` (the repository root).
* Do not hard-code a domain anywhere; all links are relative, so the same files work on `*.github.io/<repo>/`,
  `*.pages.dev` and a custom domain.
* Direct game URLs work: `/games/touge-drift/` and `/games/claudeball/`.

**Migrating the live site.** Before this change the repo root *was* Claude Ball. After it, the root is the
launcher and Claude Ball lives at `/games/claudeball/`. Things to expect when you merge to the production branch:
old bookmarks to the site root now show the launcher (one tap to Claude Ball); an already-installed Claude Ball
home-screen icon opens the launcher until it is re-added from `/games/claudeball/` (the in-game "Install" tip
still works there); saves are kept (see below). Nothing in this repository changes DNS or deploys by itself.

## The game registry

`games.json` is the single source of truth (title, genre, description, controls, features, cover, accent colour,
and which `localStorage` prefixes belong to the game). After editing it run:

```
node tools/build-platform.js          # writes registry.js and sw-files.js
node tools/build-platform.js --check  # fails if they are out of date (use in CI / before committing)
```

`registry.js` is a generated script (`window.ARCADE_GAMES = [...]`) rather than a `fetch()` of the JSON,
because browsers block `fetch()` of local files. The launcher therefore works from `file://` without any network
request. The tool also validates every entry (required fields, entry file and cover exist, no absolute URLs).

## Adding a third game

```
node tools/new-game.js my-game "My Game" "Puzzle" "One-line tagline"
```

This creates `games/my-game/index.html` (a working starter with the Back to Library control), a placeholder cover
and the registry entry, then regenerates the generated files. Then:

1. Replace the starter code in `games/my-game/`. Keep everything relative (no leading `/`, no domains) and keep
   the game offline-capable (no CDN scripts, no remote fonts).
2. Fill in `description`, `modes`, `controls` and `features` in `games.json`; drop a real cover in `assets/covers/`
   (SVG or PNG) and point `cover` at it.
3. Give every `localStorage` key the prefix you registered (`storage.prefixes`, default `my-game.`). That is what
   makes the game's data appear in the launcher's storage table and in export / import.
4. Add the Back to Library control: `<script src="../../assets/back-to-library.js"></script>`. If leaving would lose
   progress, define `window.ArcadeLibrary = { needsConfirm: () => ..., message: '...' }` so it asks first.
5. `node tools/build-platform.js`, open `index.html`, and the game is in the library and in the offline cache.

The launcher itself needs no code change for a new game (tested: `tests/platform.e2e.js`, "Adding a third game").

## Saves and storage

Everything is in the browser's `localStorage`, under prefixes so games never touch each other's data:

| Prefix | Owner |
| --- | --- |
| `arcade.` | launcher: preferences (`arcade.v1`), play history |
| `td.` | Touge Drift: `td.save.v1`, `td.settings.v1`, `td.ghost.v1.<course>`; damaged or newer-version saves are kept as `td.save.corrupt.*` / `td.save.backup.*` |
| `cb-`, `pool-` | Claude Ball: name, tutorial flag, volume |

* Saves are versioned (`v: 1`). Loading sanitises values; a damaged save is set aside, never silently deleted.
* **Export / import:** Launcher, Settings, "Export all data" writes one JSON file with every registered prefix; import
  validates it and asks before overwriting. Touge Drift has its own export / import in its Settings, which keeps a
  backup copy of the current save before importing.
* `localStorage` is per **origin**, not per folder, so moving Claude Ball from `/` into `/games/claudeball/` on a
  hosted site keeps its saves (tested). From `file://` browsers differ (some share local-file storage between files, some isolate each file or folder), so local-file saves can be
  missing or not shared between browsers. Treat them as temporary and export now and then. If storage is blocked the games still run (progress
  is kept for the session and Touge Drift says so in Settings).
* Launcher preferences that games honour: **Start games muted** and **Reduce motion** (Touge Drift turns off camera
  shake and heavy effects; so does the operating system's reduced-motion setting).

## Offline

* Nothing is loaded from the network. The games are fully playable from local files with no service worker.
* Over `http(s)` the launcher registers `sw.js`, which precaches every file listed in `sw-files.js` (a content hash
  gives every deploy a fresh cache, old ones are deleted) and serves network-first with a cache fallback, so updates
  appear on the next load while offline still works. It is never registered from `file://`.
* Claude Ball keeps its own service worker (`games/claudeball/sw.js`, scoped to its folder).

## Touge Drift

Controls: **W / Up** accelerate, **S / Down** brake and reverse, **A D / Left Right** steer, **Space** handbrake,
**Shift** clutch kick, **R** reset (+5 s), **C** camera, **+ / -** zoom, **M** mute, **Esc** pause. A gamepad works too
(left stick, triggers, A = handbrake, X = kick; implemented, not yet tried with real hardware).

* **Physics** (`physics.js`): fixed 120 Hz step; a bicycle model in the car's body frame with weight transfer,
  per-axle tyre slip curves that peak then fall to sliding grip, a shared friction circle for drive / brake / cornering,
  RWD / FWD / AWD drive split, differential coupling, handbrake, clutch kick, wall impulses. Drifts are not scripted:
  they appear when rear grip is exceeded. A **Driving assist** setting (see below)
  controls how much the game helps hold a slide, because binary keyboard steering cannot do it unaided.
* **Driving assist** (Settings, pre-race and pause menus): **Beginner** (default for new players: speed-sensitive
  steering, strong countersteer help, a forgiving handbrake with a gentle fade, soft yaw limit, throttle eased while
  sliding, light road-keeping nudge), **Standard** (balanced; the previous "Medium" feel) and **Expert** (almost no help:
  quick steering, snappy handbrake, the car can spin). Players with an older save keep an equivalent mode
  (old assist 3 -> Beginner, 2 -> Standard, 0-1 -> Expert); existing players with a save but no stored setting get Standard.
  Rivals always drive with Standard physics. You still have to steer, brake and use throttle: the assist shapes
  the response, it does not drive.
* **Courses** (`tracks.js`): six deterministic mountain roads built from smooth curvature profiles (roads are about 40%
  wider than the first version, 10.6-13 m, and the outside of every bend flares up to 3.4 m wider), with hairpins,
  checkpoints, drift zones, guardrails and generated scenery. One set of per-sample edge arrays (`hl hr railL railR`)
  feeds rendering, collision, scenery placement, gates and AI lane limits, so they cannot disagree. The generator refuses any layout in which the road comes
  close to itself, so every course is finishable.
* **Modes:** Career (6 regions x 4 events, medals, unlocks), Drift Attack, Time Attack (checkpoint-validated, with a
  ghost of your best), Rival Battle (AI drivers on the same physics; the finishing order is simulated, not scripted).
* **Garage:** 8 cars, engine / suspension / weight stages, 4 tyre compounds, differential lock, paint and wheels. Each
  upgrade shows its measured effect before you buy and changes the physics parameters used in races.
* Files: `physics.js vehicles.js tracks.js drift.js ai.js race.js progression.js` hold the logic (no DOM, so they run in
  Node for tests); `render.js audio.js ui.js game.js index.html styles.css` are the browser layer.

## Tests

```
node tests/touge-drift.unit.js     # 216 headless checks: physics, tracks, scoring, AI, race rules, progression, saves
node tests/platform.e2e.js         # launcher, registry, navigation, settings, hosted + sub-path + offline, adding a game
node tests/claudeball.smoke.e2e.js # Claude Ball at its new location: starts, plays, saves, pauses, goes back to the Library
node tests/touge-drift.e2e.js      # the game in a real browser: keyboard, menus, whole races, garage, saves
node tests/balance.sim.js 0.5 2    # career balance: an AI player of a given skill plays the campaign (prints medals, unlocks, credits)
node tools/build-platform.js --check
```

The two `e2e` files need the `playwright` package (dev-only; the site itself has no dependencies). They run
Chromium; they cannot prove behaviour in Safari or Firefox, or on a real GPU / phone.

Claude Ball's own regression suites live with its source (the `zk-nxid/op` repository: `tests/browser-test.js`,
`tests/mobile-test.js`, `tests/online-test.js`). The built game in `games/claudeball/` is a copy of that repository's
`dist/webapp` (built with `node tools/build-single.js --min --webapp --platform`).

## Known limitations

* Touge Drift is keyboard-first (gamepad works); there are no touch controls yet, so it is a desktop game.
* The drift medal thresholds are derived from course length and drift zones and calibrated against scripted drivers,
  not against many human players. Expect to tune them (`DRIFT_MEDAL` / `driftPar` in `progression.js`).
* Time-attack medals are multiples of the time an AI driver (skill 0.85, stock Kazan RZ-1) needs; they are a guide to
  pace, not a measure of human play.
* Rendering speed was only measured in a software-rendered headless browser (about 30 fps there). Real GPUs should be
  much faster, but this has not been measured.
* Audio is procedural Web Audio; it has been exercised for crashes but not listened to by a person in this project.
