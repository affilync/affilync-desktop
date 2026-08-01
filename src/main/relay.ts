/**
 * Relay — Affilync's incoming-call device.
 *
 * A small frameless always-on-top window that pops over everything when an
 * inbound call rings, styled as a physical Affilync device: caller identity,
 * the campaign/queue the call landed on (call-center context), and
 * Answer / Decline. It exists because the main window is usually hidden to
 * the tray — surfacing a 1440px dashboard to answer a phone call is the
 * wrong gesture; a palm-sized device is the right one.
 *
 * Design notes:
 * - Local static HTML via data: URL (same precedent as the offline retry
 *   page) — no network, no auth, fed exclusively by validated IPC from main.
 *   The remote-shell auth invariant is untouched.
 * - Brand: Affilync teal ladder (web tailwind.config.js primary ramp —
 *   500 #00d4aa / 600 #00a887 / 700 #007a62, ink-on-teal #001A14) on the
 *   #0a0e1a app background. Colors are duplicated here by necessity (no
 *   token pipeline in this repo); the source of truth is affilync-web.
 * - Never steals focus: shown with showInactive(); the agent keeps typing
 *   wherever they were until they choose to interact.
 * - The softphone in the main window stays the single owner of call state.
 *   Relay only displays and forwards button presses.
 */

import { BrowserWindow, screen } from 'electron';
import * as path from 'path';

import { IPC, RelayCallPayload } from '../shared/ipc-channels';

const RELAY_WIDTH = 340;
const RELAY_HEIGHT = 236;
const RELAY_MARGIN = 24;

/** Fallback auto-hide if the web app never sends relay-hide (e.g. renderer
 *  crash mid-ring) — a dead ring must not leave a zombie device on screen. */
const RELAY_MAX_VISIBLE_MS = 75_000;

let relayWindow: BrowserWindow | null = null;
let hideTimer: NodeJS.Timeout | null = null;

const RELAY_PAGE = `data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html>
<html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<title>Relay</title>
<style>
  :root {
    --teal-400: #05ffcd; --teal-500: #00d4aa; --teal-600: #00a887;
    --teal-700: #007a62; --ink-on-teal: #001a14;
    --bg: #0a0e1a; --surface: #111827; --text: #e6e9f2; --muted: #8b93a7;
    --danger: #ff3366;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; user-select: none; }
  html, body { background: transparent; height: 100%; overflow: hidden; }
  body {
    font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
    color: var(--text);
    display: flex; align-items: stretch;
  }
  .device {
    -webkit-app-region: drag;
    position: relative; flex: 1; margin: 6px;
    background: linear-gradient(160deg, #0d1322 0%, var(--bg) 55%, #071310 100%);
    border: 1px solid rgba(0, 212, 170, 0.35);
    border-radius: 18px;
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.55), 0 0 0 1px rgba(0, 0, 0, 0.4),
      0 0 24px rgba(0, 212, 170, 0.12);
    padding: 14px 16px 12px;
    display: flex; flex-direction: column; gap: 8px;
    overflow: hidden;
  }
  /* Speaker-grille accent strip — the "device" affordance. */
  .grille {
    position: absolute; top: 10px; left: 50%; transform: translateX(-50%);
    width: 44px; height: 4px; border-radius: 2px;
    background: repeating-linear-gradient(90deg,
      rgba(139, 147, 167, 0.55) 0 3px, transparent 3px 6px);
  }
  .head { display: flex; align-items: center; gap: 8px; margin-top: 8px; }
  .brand {
    font-size: 11px; font-weight: 700; letter-spacing: 0.14em;
    text-transform: uppercase; color: var(--teal-500);
  }
  .brand small { color: var(--muted); font-weight: 500; letter-spacing: 0.08em; }
  .live {
    margin-left: auto; display: inline-flex; align-items: center; gap: 5px;
    font-size: 10px; color: var(--muted); letter-spacing: 0.06em;
  }
  .live i {
    width: 7px; height: 7px; border-radius: 50%; background: var(--teal-400);
    animation: blink 1.1s ease-in-out infinite;
  }
  @keyframes blink { 50% { opacity: 0.25; } }
  .caller { display: flex; align-items: center; gap: 12px; min-height: 56px; }
  .avatar {
    position: relative; width: 52px; height: 52px; border-radius: 50%;
    flex: none;
    background: radial-gradient(circle at 30% 30%, var(--teal-500), var(--teal-700));
    color: var(--ink-on-teal);
    display: flex; align-items: center; justify-content: center;
    font-size: 20px; font-weight: 700;
  }
  .avatar::before, .avatar::after {
    content: ""; position: absolute; inset: -6px; border-radius: 50%;
    border: 2px solid rgba(0, 212, 170, 0.5);
    animation: ring 1.6s ease-out infinite;
  }
  .avatar::after { animation-delay: 0.55s; }
  @keyframes ring {
    from { transform: scale(0.82); opacity: 0.9; }
    to { transform: scale(1.28); opacity: 0; }
  }
  .who { min-width: 0; }
  .name {
    font-size: 16px; font-weight: 650; line-height: 1.25;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .number { font-size: 13px; color: var(--muted); letter-spacing: 0.02em; }
  .context {
    font-size: 11px; color: var(--teal-400);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    min-height: 14px;
  }
  .actions { -webkit-app-region: no-drag; display: flex; gap: 10px; margin-top: 2px; }
  button {
    flex: 1; border: 0; border-radius: 12px; padding: 11px 0;
    font: inherit; font-size: 13.5px; font-weight: 650; cursor: pointer;
    display: inline-flex; align-items: center; justify-content: center; gap: 7px;
    transition: transform 0.06s ease, filter 0.12s ease;
  }
  button:active { transform: scale(0.97); }
  button:hover { filter: brightness(1.1); }
  .answer { background: var(--teal-500); color: var(--ink-on-teal); }
  .decline { background: rgba(255, 51, 102, 0.16); color: var(--danger);
    border: 1px solid rgba(255, 51, 102, 0.45); }
  svg { width: 15px; height: 15px; }
  .open {
    -webkit-app-region: no-drag;
    background: none; border: 0; padding: 4px 0 0; margin: 0;
    font-size: 10.5px; color: var(--muted); cursor: pointer; letter-spacing: 0.04em;
  }
  .open:hover { color: var(--teal-400); filter: none; }
</style></head>
<body>
  <div class="device">
    <div class="grille"></div>
    <div class="head">
      <span class="brand">Relay <small>· Affilync</small></span>
      <span class="live"><i></i>INCOMING</span>
    </div>
    <div class="caller">
      <div class="avatar" id="avatar">?</div>
      <div class="who">
        <div class="name" id="name">Incoming call</div>
        <div class="number" id="number"></div>
        <div class="context" id="context"></div>
      </div>
    </div>
    <div class="actions">
      <button class="answer" id="answer">
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1C10.6 21 3 13.4 3 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.2.2 2.4.6 3.6.1.3 0 .7-.2 1l-2.3 2.2z"/></svg>
        Answer
      </button>
      <button class="decline" id="decline">
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 9c-1.6 0-3.2.3-4.6.7v3.1c0 .4-.2.7-.6.9-.9.5-1.8 1-2.5 1.7-.2.2-.4.3-.7.3-.3 0-.5-.1-.7-.3L.6 13.1c-.2-.2-.3-.4-.3-.7 0-.3.1-.5.3-.7C3.6 8.9 7.6 7.2 12 7.2s8.4 1.7 11.4 4.5c.2.2.3.4.3.7 0 .3-.1.5-.3.7l-2.3 2.3c-.2.2-.4.3-.7.3-.3 0-.5-.1-.7-.3-.8-.7-1.6-1.3-2.5-1.7-.4-.2-.6-.5-.6-.9V9.7C15.2 9.3 13.6 9 12 9z"/></svg>
        Decline
      </button>
    </div>
    <button class="open" id="open">Open Affilync ↗</button>
  </div>
  <script>
    (function () {
      var api = window.affilyncRelay;
      if (!api) return;
      api.onCall(function (call) {
        var name = call.callerName || 'Unknown caller';
        document.getElementById('name').textContent = name;
        document.getElementById('number').textContent = call.callerNumber || '';
        var ctx = [call.queueName, call.campaignName].filter(Boolean).join(' · ');
        document.getElementById('context').textContent = ctx;
        var initial = (call.callerName || call.callerNumber || '?')
          .replace(/[^0-9A-Za-z]/g, '')
          .charAt(0)
          .toUpperCase();
        document.getElementById('avatar').textContent = initial || '?';
      });
      document.getElementById('answer').addEventListener('click', function () {
        api.sendAction('answer');
      });
      document.getElementById('decline').addEventListener('click', function () {
        api.sendAction('decline');
      });
      document.getElementById('open').addEventListener('click', function () {
        api.sendAction('open');
      });
    })();
  </script>
</body></html>`)}`;

export function getRelayWindow(): BrowserWindow | null {
  return relayWindow;
}

function createRelayWindow(): BrowserWindow {
  if (relayWindow && !relayWindow.isDestroyed()) return relayWindow;

  relayWindow = new BrowserWindow({
    width: RELAY_WIDTH,
    height: RELAY_HEIGHT,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    title: 'Relay',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'relay.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });

  // Above fullscreen apps / all workspaces — a ringing phone outranks focus.
  relayWindow.setAlwaysOnTop(true, 'screen-saver');
  relayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  relayWindow.on('closed', () => {
    relayWindow = null;
  });

  void relayWindow.loadURL(RELAY_PAGE);
  return relayWindow;
}

function positionBottomRight(win: BrowserWindow): void {
  const { workArea } = screen.getPrimaryDisplay();
  win.setPosition(
    workArea.x + workArea.width - RELAY_WIDTH - RELAY_MARGIN,
    workArea.y + workArea.height - RELAY_HEIGHT - RELAY_MARGIN,
  );
}

export function showRelay(payload: RelayCallPayload): void {
  const win = createRelayWindow();

  const deliver = () => {
    if (!win.isDestroyed()) win.webContents.send(IPC.RELAY_CALL, payload);
  };
  if (win.webContents.isLoading()) {
    win.webContents.once('did-finish-load', deliver);
  } else {
    deliver();
  }

  positionBottomRight(win);
  if (!win.isVisible()) win.showInactive();

  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = setTimeout(() => hideRelay(), RELAY_MAX_VISIBLE_MS);
}

export function hideRelay(): void {
  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }
  if (relayWindow && !relayWindow.isDestroyed() && relayWindow.isVisible()) {
    relayWindow.hide();
  }
}

export function destroyRelay(): void {
  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }
  if (relayWindow && !relayWindow.isDestroyed()) {
    relayWindow.destroy();
  }
  relayWindow = null;
}
