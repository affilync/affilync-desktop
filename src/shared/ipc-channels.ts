/**
 * IPC channel names + payload types shared between main and preload.
 *
 * The bridge is deliberately tiny and explicit: every capability is a named
 * channel with a validated payload — no generic invoke escape hatch. Bump
 * BRIDGE_VERSION on any breaking change so the web app can gate features.
 */

export const BRIDGE_VERSION = 2 as const;

export const IPC = {
  FLASH_FRAME: 'affilync:flash-frame',
  SET_BADGE: 'affilync:set-badge',
  SET_TRAY_STATUS: 'affilync:set-tray-status',
  SHOW_WINDOW: 'affilync:show-window',
  POWER_SAVE_START: 'affilync:power-save-start',
  POWER_SAVE_STOP: 'affilync:power-save-stop',
  DEEP_LINK: 'affilync:deep-link',
  // Relay — the incoming-call device window (bridge v2).
  RELAY_INCOMING: 'affilync:relay-incoming', // web app → main: show the device
  RELAY_HIDE: 'affilync:relay-hide', // web app → main: ring ended, hide it
  RELAY_ACTION: 'affilync:relay-action', // Relay window → main: user pressed a button
  RELAY_COMMAND: 'affilync:relay-command', // main → web app: act on the softphone
  RELAY_CALL: 'affilync:relay-call', // main → Relay window: call payload to render
} as const;

/**
 * What the web app knows about a ringing inbound call. Everything is
 * display-only; the softphone in the (hidden) main window remains the single
 * owner of call state. All fields are length-clamped + type-checked in
 * src/main/ipc.ts before they reach the Relay window.
 */
export interface RelayCallPayload {
  callerNumber: string;
  callerName?: string;
  /** Call-center context lines — campaign / queue the call landed on. */
  campaignName?: string;
  queueName?: string;
}

export const RELAY_ACTIONS = ['answer', 'decline', 'open'] as const;
export type RelayAction = (typeof RELAY_ACTIONS)[number];

/** Commands Relay forwards to the softphone in the web app. */
export type RelayCommand = Exclude<RelayAction, 'open'>;

export const TRAY_STATUSES = [
  'available',
  'ringing',
  'oncall',
  'away',
  'offline',
] as const;

export type TrayStatus = (typeof TRAY_STATUSES)[number];
