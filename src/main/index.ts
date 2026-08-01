/**
 * Affilync Desktop — remote shell over https://app.affilync.com.
 *
 * The app is tray-resident: closing the window hides it, the renderer stays
 * alive (softphone SIP registration included), and quitting is an explicit
 * tray action. See CLAUDE.md for architecture notes.
 */

import { app } from 'electron';

import { APP_USER_MODEL_ID } from './config';
import { extractDeepLink, flushDeepLinks, handleDeepLink, registerDeepLinks } from './deep-link';
import { registerIpcHandlers } from './ipc';
import { ensureMacMicrophoneAccess, registerPermissionHandlers } from './permissions';
import { isCallActive, registerWakeRecovery } from './power';
import { createTray, hasTray } from './tray';
import { initUpdater } from './updater';
import { destroyRelay } from './relay';
import { createMainWindow, getMainWindow, setQuitting, showMainWindow } from './window';

// Windows toast identity (and NSIS Start-menu shortcut attribution).
app.setAppUserModelId(APP_USER_MODEL_ID);

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    const link = extractDeepLink(argv);
    if (link) handleDeepLink(link);
    else showMainWindow();
  });

  registerDeepLinks();

  app.whenReady().then(async () => {
    // Permission policy must exist before the first page load.
    registerPermissionHandlers();
    await ensureMacMicrophoneAccess();

    const trayOk = createTray();
    if (!trayOk) {
      // No tray (stock GNOME/Wayland): close must NOT strand the user with a
      // hidden, unreachable window — fall back to real close = quit.
      setQuitting(true);
      console.warn('no system tray — close will quit instead of hide');
    }

    registerIpcHandlers();
    registerWakeRecovery();

    const win = createMainWindow();
    win.webContents.on('did-finish-load', () => flushDeepLinks());

    // Cold-start deep link (Windows/Linux pass it in argv).
    const bootLink = extractDeepLink(process.argv);
    if (bootLink) handleDeepLink(bootLink);

    initUpdater();
  });

  // Tray-resident: closing every window must not exit the app (any platform).
  app.on('window-all-closed', () => {
    /* no-op — quit only via tray / before-quit */
  });

  app.on('activate', () => {
    // macOS dock click.
    if (getMainWindow()) showMainWindow();
    else createMainWindow();
  });

  app.on('before-quit', (event) => {
    if (isCallActive() && hasTray()) {
      // Guard rail: never let an update/quit shortcut kill a live call
      // silently. The agent quits again from the tray if they mean it.
      event.preventDefault();
      showMainWindow();
      return;
    }
    setQuitting(true);
    // The Relay device is frameless + skipTaskbar; destroy it explicitly so
    // it can never outlive the app as an orphaned always-on-top window.
    destroyRelay();
  });
}
