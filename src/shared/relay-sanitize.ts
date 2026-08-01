/**
 * Sanitizers for the Relay call payload (no Electron imports — unit-testable
 * with `npm test` / node --test against the compiled dist).
 *
 * The Relay page only ever assigns these values to textContent, but the
 * payload crosses a process boundary from a REMOTE renderer — sanitize at
 * the door anyway: type-check, strip control characters, cap length.
 */

import { RelayCallPayload } from './ipc-channels';

export function cleanDisplayString(value: unknown, maxLen: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  // eslint-disable-next-line no-control-regex
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (!cleaned) return undefined;
  return cleaned.slice(0, maxLen);
}

/** Validate an untrusted relay-incoming payload into a clean RelayCallPayload,
 *  or null when it has no usable caller number. */
export function sanitizeRelayPayload(payload: unknown): RelayCallPayload | null {
  const raw = (payload ?? {}) as Record<string, unknown>;
  const callerNumber = cleanDisplayString(raw.callerNumber, 32);
  if (!callerNumber) return null;
  const call: RelayCallPayload = { callerNumber };
  const callerName = cleanDisplayString(raw.callerName, 80);
  if (callerName) call.callerName = callerName;
  const campaignName = cleanDisplayString(raw.campaignName, 80);
  if (campaignName) call.campaignName = campaignName;
  const queueName = cleanDisplayString(raw.queueName, 80);
  if (queueName) call.queueName = queueName;
  return call;
}
