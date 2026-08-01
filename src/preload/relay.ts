/**
 * Preload for the Relay window (src/main/relay.ts) — the incoming-call
 * device. Exposes exactly two capabilities to the local static page:
 * receive the call payload, and report which button the agent pressed.
 * Nothing else — the page has no network and needs nothing else.
 */

import { contextBridge, ipcRenderer } from 'electron';

import { IPC, RELAY_ACTIONS, RelayAction, RelayCallPayload } from '../shared/ipc-channels';

export interface AffilyncRelayAPI {
  onCall(cb: (call: RelayCallPayload) => void): void;
  sendAction(action: RelayAction): void;
}

const api: AffilyncRelayAPI = {
  onCall: (cb) => {
    ipcRenderer.on(IPC.RELAY_CALL, (_event, call: RelayCallPayload) => {
      if (call && typeof call.callerNumber === 'string') cb(call);
    });
  },
  sendAction: (action) => {
    if ((RELAY_ACTIONS as readonly string[]).includes(action)) {
      ipcRenderer.send(IPC.RELAY_ACTION, action);
    }
  },
};

contextBridge.exposeInMainWorld('affilyncRelay', api);
