# affilync-desktop

Electron **remote shell** over https://app.affilync.com for call-center agents (always-available
softphone) and brands. Part of the Affilync platform (see `/home/ninja/codex/CLAUDE.md`).

## Architecture (read before changing anything)

- **No renderer code lives here.** The renderer IS the production web app; this repo only ships a main
  process + preload bridge. The only sanctioned local surfaces are the inline offline retry page and
  the **Relay** device page (src/main/relay.ts) — a static data:-URL popup with no network access,
  fed exclusively by IPC payloads that main validates. Do not add local HTML/React beyond these two,
  and never give a local surface network or auth.
- **Relay (bridge v2):** the incoming-call device — a small frameless always-on-top window that pops
  on inbound ring (caller identity + campaign/queue + Answer/Decline). The softphone in the hidden
  main window stays the single owner of call state; Relay only displays and forwards button presses
  (`relay-action` → `relay-command`). Shown with showInactive (never steals focus), hidden on any
  tray-status transition off `ringing`, destroyed on quit, 75s zombie-ring fallback timer.
- **Remote-shell auth invariant:** loading the real `app.affilync.com` origin is what makes httpOnly
  cookie auth, CSRF double-submit, and CORS work with ZERO api changes. Never switch to a local bundle
  without solving header auth + CORS first (v2 topic — see plan notes in affilync-web history).
- **Tray-resident lifecycle:** window close → hide; app quits only from tray / before-quit. The hidden
  renderer keeps the softphone SIP registration alive — `backgroundThrottling: false` in window.ts is
  load-bearing; removing it silently breaks hidden-window ringing.
- **Bridge contract:** `window.affilyncDesktop` (src/preload/index.ts, channels in
  src/shared/ipc-channels.ts). Consumed by `affilync-web/src/utils/desktopBridge.ts` and
  `Softphone.tsx`. It is versioned (`bridgeVersion`); bump on breaking change and gate new methods in
  the web app by version, never by user-agent sniffing. Keep it tiny — no generic invoke escape hatch;
  validate every payload in src/main/ipc.ts.
- **Security posture:** contextIsolation + sandbox on, nodeIntegration off, permissions granted only to
  `https://app.affilync.com` (mic-audio + notifications), navigation locked to `*.affilync.com`
  (everything else → system browser).

## Commands

```bash
npm run typecheck   # strict tsc, main + preload projects
npm test            # build + node --test (relay payload sanitizer)
npm start           # build + run (AFFILYNC_APP_URL overrides target)
npm run dist:dir    # local unpackaged build
```

## Release

Tag `v<package.json version>` → GitHub Actions (release.yml) matrix-builds win/mac/linux to a DRAFT
release; publishing the draft is the rollout action (electron-updater serves published releases only).
This repo must stay **public** — electron-updater cannot read private-repo releases without embedding a
token. macOS builds are unsigned until the Apple Developer ID lands (see README signing runbook);
unsigned macOS cannot auto-update.

## Gotchas

- `app.setAppUserModelId` + NSIS Start-menu shortcut are required for Windows toast notifications.
- The updater never restarts mid-call (power.ts refcount is the call-presence signal); before-quit also
  guards against quitting during an active call.
- GNOME/Wayland may have no tray → createTray() failure flips close-to-hide into close-to-quit so users
  aren't stranded.
- powerMonitor resume/unlock reloads the page (skipped mid-call) so the softphone re-registers after
  sleep.
