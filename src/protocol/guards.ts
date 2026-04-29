/**
 * Runtime type guards for protocol messages.
 *
 * Wire shapes are observation-derived (see docs/captures/2026-04-20-layerD/),
 * so anything we pull off the wire starts life as `unknown` and must pass
 * one of these guards before callers can rely on its shape. Guards check
 * only the fields they need; unknown fields are permitted so the extension
 * can grow without breaking us.
 */

import {
  MessageType,
  type AckResponse,
  type CopyFieldRequest,
  type CreateEntryRequest,
  type CreateEntryResponse,
  type Credential,
  type CredentialsForUrlRequest,
  type CredentialsForUrlResponse,
  type DatabaseSummary,
  type GeneratePasswordRequest,
  type GeneratePasswordResponse,
  type GeneratedPassword,
  type GetNewEntryDefaultsV2Request,
  type GetNewEntryDefaultsV2Response,
  type GetPasswordStrengthRequest,
  type GetPasswordStrengthResponse,
  type HelloRequest,
  type HelloResponse,
  type ListGroupsRequest,
  type ListGroupsResponse,
  type LockDatabaseRequest,
  type MessageTypeValue,
  type PasswordStrength,
  type RequestEnvelope,
  type ResponseEnvelope,
  type RpcRequestFor,
  type RpcResponseFor,
  type ServerSettings,
  type UnlockDatabaseRequest,
} from './messages.ts';

/* ─── Primitives ───────────────────────────────────────────────────────── */

export function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

export function isString(x: unknown): x is string {
  return typeof x === 'string';
}

export function isBoolean(x: unknown): x is boolean {
  return typeof x === 'boolean';
}

export function isNumber(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x);
}

function isStringArray(x: unknown): x is readonly string[] {
  return Array.isArray(x) && x.every(isString);
}

function isArray(x: unknown): x is readonly unknown[] {
  return Array.isArray(x);
}

/* ─── Envelopes ────────────────────────────────────────────────────────── */

const KNOWN_MESSAGE_TYPES = new Set<number>(Object.values(MessageType));

export function isMessageTypeValue(x: unknown): x is MessageTypeValue {
  return typeof x === 'number' && KNOWN_MESSAGE_TYPES.has(x);
}

/**
 * Recognise a request envelope. The envelope itself is plaintext JSON; the
 * ciphertext inside `message` is not validated here.
 */
export function isRequestEnvelope(x: unknown): x is RequestEnvelope {
  return (
    isObject(x) &&
    isString(x['clientPublicKey']) &&
    isString(x['nonce']) &&
    isString(x['message']) &&
    isMessageTypeValue(x['messageType'])
  );
}

/**
 * Recognise a response envelope. As with requests the ciphertext is opaque
 * to this guard; callers decrypt it separately.
 */
export function isResponseEnvelope(x: unknown): x is ResponseEnvelope {
  return (
    isObject(x) &&
    isString(x['message']) &&
    isString(x['serverPublicKey']) &&
    isString(x['errorMessage']) &&
    isBoolean(x['success']) &&
    isString(x['nonce'])
  );
}

/* ─── Shared value types ───────────────────────────────────────────────── */

function isDatabaseSummary(x: unknown): x is DatabaseSummary {
  return (
    isObject(x) &&
    isString(x['uuid']) &&
    isString(x['nickName']) &&
    isBoolean(x['locked']) &&
    isBoolean(x['autoFillEnabled']) &&
    isBoolean(x['includeFavIconForNewEntries'])
  );
}

function isServerSettings(x: unknown): x is ServerSettings {
  return (
    isObject(x) &&
    isBoolean(x['colorBlindPalette']) &&
    isBoolean(x['supportsCreateNew']) &&
    isBoolean(x['markdownNotes']) &&
    isBoolean(x['colorizePasswords'])
  );
}

function isPasswordStrength(x: unknown): x is PasswordStrength {
  return (
    isObject(x) &&
    isNumber(x['entropy']) &&
    isString(x['category']) &&
    isString(x['summaryString'])
  );
}

function isGeneratedPassword(x: unknown): x is GeneratedPassword {
  return isObject(x) && isString(x['password']) && isPasswordStrength(x['strength']);
}

function isCredential(x: unknown): x is Credential {
  return (
    isObject(x) &&
    isString(x['uuid']) &&
    isString(x['databaseId']) &&
    isString(x['databaseName']) &&
    isString(x['title']) &&
    isString(x['username']) &&
    isString(x['password']) &&
    isString(x['url']) &&
    isString(x['totp']) &&
    isString(x['notes']) &&
    isBoolean(x['favourite']) &&
    isStringArray(x['tags']) &&
    isArray(x['customFields']) &&
    isStringArray(x['attachmentFileNames']) &&
    isString(x['icon']) &&
    isString(x['modified'])
  );
}

/* ─── Inner request guards ─────────────────────────────────────────────── */

function isHelloRequest(_x: unknown): _x is HelloRequest {
  // Hello has no inner JSON payload — see RequestEnvelope. Nothing to check.
  return true;
}

function isCredentialsForUrlRequest(x: unknown): x is CredentialsForUrlRequest {
  return isObject(x) && isString(x['url']) && isNumber(x['skip']) && isNumber(x['take']);
}

function isCopyFieldRequest(x: unknown): x is CopyFieldRequest {
  return (
    isObject(x) &&
    isString(x['databaseId']) &&
    isString(x['nodeId']) &&
    isBoolean(x['explicitTotp']) &&
    isNumber(x['field'])
  );
}

function isDatabaseIdOnlyRequest(
  x: unknown,
): x is
  | LockDatabaseRequest
  | UnlockDatabaseRequest
  | ListGroupsRequest
  | GetNewEntryDefaultsV2Request {
  return isObject(x) && isString(x['databaseId']);
}

function isCreateEntryRequest(x: unknown): x is CreateEntryRequest {
  return (
    isObject(x) &&
    isString(x['databaseId']) &&
    isString(x['groupId']) &&
    isString(x['icon']) &&
    isString(x['title']) &&
    isString(x['username']) &&
    isString(x['password']) &&
    isString(x['url'])
  );
}

function isGeneratePasswordRequest(x: unknown): x is GeneratePasswordRequest {
  // Request is literally `{}` on the wire.
  return isObject(x);
}

function isGetPasswordStrengthRequest(x: unknown): x is GetPasswordStrengthRequest {
  return isObject(x) && isString(x['password']);
}

/* ─── Inner response guards ────────────────────────────────────────────── */

function isHelloResponse(x: unknown): x is HelloResponse {
  return (
    isObject(x) &&
    isString(x['serverVersionInfo']) &&
    isServerSettings(x['serverSettings']) &&
    Array.isArray(x['databases']) &&
    x['databases'].every(isDatabaseSummary)
  );
}

function isCredentialsForUrlResponse(x: unknown): x is CredentialsForUrlResponse {
  return isObject(x) && Array.isArray(x['results']) && isNumber(x['unlockedDatabaseCount']);
}

function isAckResponse(x: unknown): x is AckResponse {
  return isObject(x) && isBoolean(x['success']);
}

function isCreateEntryResponse(x: unknown): x is CreateEntryResponse {
  return isObject(x) && isString(x['uuid']) && isCredential(x['credential']);
}

function isListGroupsResponse(x: unknown): x is ListGroupsResponse {
  return (
    isObject(x) &&
    Array.isArray(x['groups']) &&
    x['groups'].every((g) => isObject(g) && isString(g['uuid']) && isString(g['title']))
  );
}

function isGeneratePasswordResponse(x: unknown): x is GeneratePasswordResponse {
  return (
    isObject(x) &&
    isGeneratedPassword(x['password']) &&
    Array.isArray(x['alternatives']) &&
    x['alternatives'].every(isGeneratedPassword)
  );
}

function isGetPasswordStrengthResponse(x: unknown): x is GetPasswordStrengthResponse {
  return isObject(x) && isPasswordStrength(x['strength']);
}

function isGetNewEntryDefaultsV2Response(x: unknown): x is GetNewEntryDefaultsV2Response {
  return (
    isObject(x) &&
    isStringArray(x['mostPopularUsernames']) &&
    isString(x['username']) &&
    isGeneratedPassword(x['password'])
  );
}

/* ─── Dispatch tables ──────────────────────────────────────────────────── */

/**
 * Validate an inner request payload by its `messageType`. Returns whether
 * `payload` matches the expected shape for `messageType`.
 */
export function isRpcRequestFor<K extends MessageTypeValue>(
  messageType: K,
  payload: unknown,
): payload is RpcRequestFor<K> {
  switch (messageType) {
    case MessageType.Hello:
      return isHelloRequest(payload);
    case MessageType.CredentialsForUrl:
      return isCredentialsForUrlRequest(payload);
    case MessageType.CopyField:
      return isCopyFieldRequest(payload);
    case MessageType.LockDatabase:
    case MessageType.UnlockDatabase:
    case MessageType.ListGroups:
    case MessageType.GetNewEntryDefaultsV2:
      return isDatabaseIdOnlyRequest(payload);
    case MessageType.CreateEntry:
      return isCreateEntryRequest(payload);
    case MessageType.GeneratePassword:
      return isGeneratePasswordRequest(payload);
    case MessageType.GetPasswordStrength:
      return isGetPasswordStrengthRequest(payload);
    default:
      return false;
  }
}

/**
 * Validate an inner response payload by the `messageType` of the request
 * that produced it.
 */
export function isRpcResponseFor<K extends MessageTypeValue>(
  messageType: K,
  payload: unknown,
): payload is RpcResponseFor<K> {
  switch (messageType) {
    case MessageType.Hello:
      return isHelloResponse(payload);
    case MessageType.CredentialsForUrl:
      return isCredentialsForUrlResponse(payload);
    case MessageType.CopyField:
    case MessageType.LockDatabase:
    case MessageType.UnlockDatabase:
      return isAckResponse(payload);
    case MessageType.CreateEntry:
      return isCreateEntryResponse(payload);
    case MessageType.ListGroups:
      return isListGroupsResponse(payload);
    case MessageType.GeneratePassword:
      return isGeneratePasswordResponse(payload);
    case MessageType.GetPasswordStrength:
      return isGetPasswordStrengthResponse(payload);
    case MessageType.GetNewEntryDefaultsV2:
      return isGetNewEntryDefaultsV2Response(payload);
    default:
      return false;
  }
}
