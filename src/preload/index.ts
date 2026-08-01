/**
 * Preload bridge — the ONLY surface the remote page (app.affilync.com) sees.
 *
 * Rules: fire-and-forget sends (nothing awaitable in the incoming-call hot
 * path), no generic invoke escape hatch, every method maps to one validated
 * ipcMain handler. The web app feature-detects `window.affilyncDesktop` and
 * gates future methods on `bridgeVersion`.
 */

import { contextBridge, ipcRenderer } from 'electron';

import {
  BRIDGE_VERSION,
  IPC,
  RelayCallPayload,
  RelayCommand,
  TrayStatus,
} from '../shared/ipc-channels';

export interface AffilyncDesktopAPI {
  readonly bridgeVersion: typeof BRIDGE_VERSION;
  readonly appVersion: string;
  readonly platform: NodeJS.Platform;
  flashFrame(on: boolean): void;
  setBadge(count: number): void;
  setTrayStatus(status: TrayStatus): void;
  showWindow(): void;
  powerSaveBlockStart(): void;
  powerSaveBlockStop(): void;
  onDeepLink(cb: (url: string) => void): () => void;
  /** Relay (bridge v2): pop the incoming-call device. */
  relayIncoming(call: RelayCallPayload): void;
  /** Relay (bridge v2): ring ended (answered elsewhere / cancelled) — hide it. */
  relayHide(): void;
  /** Relay (bridge v2): the agent pressed Answer/Decline on the device. */
  onRelayCommand(cb: (command: RelayCommand) => void): () => void;
}

// Main passes the app version via additionalArguments (sandbox-safe).
const versionArg = process.argv.find((a) => a.startsWith('--affilync-version='));
const appVersion = versionArg ? versionArg.split('=')[1] ?? '' : '';

const api: AffilyncDesktopAPI = {
  bridgeVersion: BRIDGE_VERSION,
  appVersion,
  platform: process.platform,
  flashFrame: (on) => ipcRenderer.send(IPC.FLASH_FRAME, on === true),
  setBadge: (count) => ipcRenderer.send(IPC.SET_BADGE, count),
  setTrayStatus: (status) => ipcRenderer.send(IPC.SET_TRAY_STATUS, status),
  showWindow: () => ipcRenderer.send(IPC.SHOW_WINDOW),
  powerSaveBlockStart: () => ipcRenderer.send(IPC.POWER_SAVE_START),
  powerSaveBlockStop: () => ipcRenderer.send(IPC.POWER_SAVE_STOP),
  onDeepLink: (cb) => {
    const listener = (_event: Electron.IpcRendererEvent, url: string) => {
      if (typeof url === 'string') cb(url);
    };
    ipcRenderer.on(IPC.DEEP_LINK, listener);
    return () => ipcRenderer.removeListener(IPC.DEEP_LINK, listener);
  },
  relayIncoming: (call) => ipcRenderer.send(IPC.RELAY_INCOMING, call),
  relayHide: () => ipcRenderer.send(IPC.RELAY_HIDE),
  onRelayCommand: (cb) => {
    const listener = (_event: Electron.IpcRendererEvent, command: RelayCommand) => {
      if (command === 'answer' || command === 'decline') cb(command);
    };
    ipcRenderer.on(IPC.RELAY_COMMAND, listener);
    return () => ipcRenderer.removeListener(IPC.RELAY_COMMAND, listener);
  },
};

contextBridge.exposeInMainWorld('affilyncDesktop', api);
