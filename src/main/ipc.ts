/**
 * Single registration point for all ipcMain handlers.
 *
 * Every payload from the (remote!) renderer is validated here — the page is
 * production web content, but defense-in-depth costs nothing: clamp numbers,
 * whitelist enum strings, accept no arbitrary channels.
 */

import { app, ipcMain } from 'electron';

import {
  IPC,
  RELAY_ACTIONS,
  RelayAction,
  TRAY_STATUSES,
  TrayStatus,
} from '../shared/ipc-channels';
import { sanitizeRelayPayload } from '../shared/relay-sanitize';
import { powerSaveStart, powerSaveStop } from './power';
import { getRelayWindow, hideRelay, showRelay } from './relay';
import { updateTrayStatus } from './tray';
import { getMainWindow, showMainWindow } from './window';

function isFromMainWindow(event: Electron.IpcMainEvent): boolean {
  const win = getMainWindow();
  return Boolean(win && !win.isDestroyed() && event.sender === win.webContents);
}

export function registerIpcHandlers(): void {
  ipcMain.on(IPC.FLASH_FRAME, (_event, on: unknown) => {
    const win = getMainWindow();
    if (win && !win.isDestroyed()) win.flashFrame(on === true);
  });

  ipcMain.on(IPC.SET_BADGE, (_event, count: unknown) => {
    const n = typeof count === 'number' && Number.isFinite(count) ? count : 0;
    app.setBadgeCount(Math.max(0, Math.min(99, Math.floor(n))));
  });

  ipcMain.on(IPC.SET_TRAY_STATUS, (_event, status: unknown) => {
    if (typeof status === 'string' && (TRAY_STATUSES as readonly string[]).includes(status)) {
      updateTrayStatus(status as TrayStatus);
      // Incoming call while hidden to tray: surface the window ourselves
      // (without stealing focus) instead of relying on OS toasts — Windows
      // suppresses toasts from apps lacking Start-menu registration (e.g.
      // unpackaged runs), which would leave the agent with ringtone only.
      if (status === 'ringing') {
        const win = getMainWindow();
        if (win && !win.isDestroyed() && !win.isVisible()) {
          win.showInactive();
          win.flashFrame(true);
        }
      } else {
        // Any transition off 'ringing' (answered, cancelled, offline) is a
        // belt-and-braces signal that the Relay device must not linger.
        hideRelay();
      }
    }
  });

  ipcMain.on(IPC.SHOW_WINDOW, () => showMainWindow());

  ipcMain.on(IPC.POWER_SAVE_START, () => powerSaveStart());
  ipcMain.on(IPC.POWER_SAVE_STOP, () => powerSaveStop());

  // ── Relay: the incoming-call device (bridge v2) ────────────────────────
  ipcMain.on(IPC.RELAY_INCOMING, (event, payload: unknown) => {
    // Only the trusted app window may pop the device.
    if (!isFromMainWindow(event)) return;
    const call = sanitizeRelayPayload(payload);
    if (!call) return;
    showRelay(call);
  });

  ipcMain.on(IPC.RELAY_HIDE, (event) => {
    if (!isFromMainWindow(event)) return;
    hideRelay();
  });

  ipcMain.on(IPC.RELAY_ACTION, (event, action: unknown) => {
    // Only the Relay window itself may report button presses.
    const relay = getRelayWindow();
    if (!relay || relay.isDestroyed() || event.sender !== relay.webContents) return;
    if (typeof action !== 'string' || !(RELAY_ACTIONS as readonly string[]).includes(action)) {
      return;
    }
    const relayAction = action as RelayAction;
    hideRelay();
    if (relayAction === 'answer' || relayAction === 'open') {
      // Answering pulls up the full app — the agent lands on the live call
      // with wrap-up, notes and dialer controls already in front of them.
      showMainWindow();
    }
    if (relayAction === 'answer' || relayAction === 'decline') {
      const win = getMainWindow();
      if (win && !win.isDestroyed()) {
        win.webContents.send(IPC.RELAY_COMMAND, relayAction);
      }
    }
  });
}
