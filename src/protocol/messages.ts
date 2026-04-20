/**
 * Protocol message types.
 *
 * Two layers:
 *
 *   (1) **Outer envelope** — rides on Native Messaging stdio. See
 *       docs/PROTOCOL.md §4 and docs/captures/2026-04-17-envelope/.
 *
 *   (2) **Inner payload** — plaintext JSON carried inside the `crypto_box`
 *       ciphertext in the envelope's `message` field. Its shape is now
 *       observed for every messageType value the extension emits — see
 *       docs/PROTOCOL.md §5 and docs/captures/2026-04-20-layerD/ for the
 *       plaintext captures these types were derived from.
 *
 * Types here are observation-derived, not source-derived. Where a field's
 * semantics are observed but its full value domain isn't, the type reflects
 * what was actually on the wire (e.g. `field: number` with known 2-valued
 * usage, rather than an enum we can't confirm).
 */

/* ─── Outer envelope (on the Native Messaging wire) ────────────────────── */

/**
 * Request envelope sent by the client. Plaintext JSON; base64 for all byte
 * fields. Wrapped in the uint32-LE Native Messaging frame by the transport.
 *
 * On `messageType === MessageType.Hello` the client has no peer public key
 * yet and therefore no ciphertext to send: `nonce` is an empty string and
 * `message` is the literal ASCII string `"message"`. On every other
 * messageType, `nonce` is 24 bytes (base64) and `message` is a `crypto_box`
 * ciphertext (base64) of a JSON inner payload.
 */
export interface RequestEnvelope {
  /** Client's Curve25519 public key, 32 bytes base64-encoded. */
  readonly clientPublicKey: string;
  /** 24-byte `crypto_box` nonce, base64-encoded. Empty string on Hello. */
  readonly nonce: string;
  /** `crypto_box` ciphertext, base64-encoded. Literal `"message"` on Hello. */
  readonly message: string;
  readonly messageType: MessageTypeValue;
}

/**
 * Response envelope returned by Strongbox. Plaintext JSON; base64 for all
 * byte fields. `message` is *always* a `crypto_box` ciphertext — even the
 * response to a Hello is encrypted.
 */
export interface ResponseEnvelope {
  /** `crypto_box` ciphertext, base64-encoded. */
  readonly message: string;
  /** Server's Curve25519 public key, 32 bytes base64-encoded. */
  readonly serverPublicKey: string;
  /** Human-readable error string. Empty on success. */
  readonly errorMessage: string;
  readonly success: boolean;
  /** 24-byte `crypto_box` nonce, base64-encoded. */
  readonly nonce: string;
}

/* ─── Operation codes ──────────────────────────────────────────────────── */

/**
 * Every `messageType` value observed on the wire. Operation names are
 * editorial — they reflect what each message visibly does, not any label
 * in Strongbox's source.
 */
export const MessageType = {
  Hello: 0,
  SearchByUrl: 2,
  CopyField: 3,
  UnlockDatabase: 4,
  LockDatabase: 5,
  CreateEntry: 6,
  ListGroups: 7,
  GeneratePassword: 11,
  CheckPasswordStrength: 12,
  PrepareNewEntry: 13,
} as const;

export type MessageTypeValue = (typeof MessageType)[keyof typeof MessageType];

/* ─── Shared inner-payload value types ─────────────────────────────────── */

/**
 * One entry in the Hello response's `databases` array.
 */
export interface DatabaseSummary {
  readonly uuid: string;
  readonly nickName: string;
  readonly locked: boolean;
  readonly autoFillEnabled: boolean;
  readonly includeFavIconForNewEntries: boolean;
}

/**
 * Server-advertised feature flags from the Hello response.
 */
export interface ServerSettings {
  readonly colorBlindPalette: boolean;
  readonly supportsCreateNew: boolean;
  readonly markdownNotes: boolean;
  readonly colorizePasswords: boolean;
}

/**
 * Password-strength meter result. `category` strings observed so far:
 * `"Very Weak"`, `"Strong"`. Typed broadly because the domain isn't
 * enumerated in captures.
 */
export interface PasswordStrength {
  readonly entropy: number;
  readonly category: string;
  readonly summaryString: string;
}

/**
 * A generated-password candidate. Used for both the primary pick and the
 * `alternatives` array in the Generate-Password response.
 */
export interface GeneratedPassword {
  readonly password: string;
  readonly strength: PasswordStrength;
}

/**
 * Full credential record as returned by Create-Entry. Field set is as
 * captured; empty-array / empty-string fields (`tags`, `customFields`,
 * `attachmentFileNames`, `notes`, `totp`) are always present on the wire
 * even when unset. The `icon` field is a `data:image/png;base64,...` URL.
 */
export interface Credential {
  readonly uuid: string;
  readonly databaseId: string;
  readonly databaseName: string;
  readonly title: string;
  readonly username: string;
  readonly password: string;
  readonly url: string;
  readonly totp: string;
  readonly notes: string;
  readonly favourite: boolean;
  readonly tags: readonly string[];
  readonly customFields: readonly unknown[];
  readonly attachmentFileNames: readonly string[];
  readonly icon: string;
  /** Human-formatted timestamp, e.g. `"Today at 5:17 PM"`. Not ISO. */
  readonly modified: string;
}

/* ─── Inner request shapes, keyed by messageType ───────────────────────── */

/**
 * `messageType=0` Hello. Transmitted on the wire as the literal bytes
 * `"message"` (see `RequestEnvelope` — no ciphertext, no nonce). No JSON
 * inner payload, so this interface is intentionally empty.
 */
export interface HelloRequest {
  readonly __tag?: 'Hello';
}

/** `messageType=2`. Extension asks for entries matching a page URL. */
export interface SearchByUrlRequest {
  readonly url: string;
  /** Pagination offset. Observed: 0. */
  readonly skip: number;
  /** Page size. Observed: 9. */
  readonly take: number;
}

/**
 * `messageType=3`. Server is asked to inject a specific field of a
 * specific entry via the OS paste/keyboard-injection path. `field` is an
 * integer selector; observed value: 2 (password).
 */
export interface CopyFieldRequest {
  readonly databaseId: string;
  readonly nodeId: string;
  readonly explicitTotp: boolean;
  readonly field: number;
}

/** `messageType=4`. */
export interface UnlockDatabaseRequest {
  readonly databaseId: string;
}

/** `messageType=5`. */
export interface LockDatabaseRequest {
  readonly databaseId: string;
}

/** `messageType=6`. Create a new entry. */
export interface CreateEntryRequest {
  readonly databaseId: string;
  readonly groupId: string;
  /** `data:image/png;base64,...` URL string. */
  readonly icon: string;
  readonly title: string;
  readonly username: string;
  readonly password: string;
  readonly url: string;
}

/** `messageType=7`. */
export interface ListGroupsRequest {
  readonly databaseId: string;
}

/**
 * `messageType=11`. Ask the server for a fresh suggestion + alternates.
 * On the wire this is a literal `{}` — no fields.
 */
export interface GeneratePasswordRequest {
  readonly __tag?: 'GeneratePassword';
}

/** `messageType=12`. Live strength meter for a typed password. */
export interface CheckPasswordStrengthRequest {
  readonly password: string;
}

/**
 * `messageType=13`. Preload state for the "create new entry" form: a
 * suggested password and the most-popular usernames already in the
 * target database.
 */
export interface PrepareNewEntryRequest {
  readonly databaseId: string;
}

/* ─── Inner response shapes, keyed by the request's messageType ────────── */

/** `messageType=0`. */
export interface HelloResponse {
  readonly databases: readonly DatabaseSummary[];
  readonly serverVersionInfo: string;
  readonly serverSettings: ServerSettings;
}

/**
 * `messageType=2`. `results` typed as `unknown[]` because every observed
 * capture returned `[]`. Likely `readonly Credential[]` once a non-empty
 * search is captured; keep as `unknown` until confirmed.
 */
export interface SearchByUrlResponse {
  readonly results: readonly unknown[];
  readonly unlockedDatabaseCount: number;
}

/** `messageType=3`, `4`, `5` all share this success-only response. */
export interface AckResponse {
  readonly success: boolean;
}

/** `messageType=6`. */
export interface CreateEntryResponse {
  /** Same UUID as `credential.uuid`; echoed at the top level too. */
  readonly uuid: string;
  readonly credential: Credential;
}

/** `messageType=7`. */
export interface ListGroupsResponse {
  readonly groups: readonly { readonly uuid: string; readonly title: string }[];
}

/** `messageType=11`. */
export interface GeneratePasswordResponse {
  readonly password: GeneratedPassword;
  readonly alternatives: readonly GeneratedPassword[];
}

/** `messageType=12`. */
export interface CheckPasswordStrengthResponse {
  readonly strength: PasswordStrength;
}

/** `messageType=13`. */
export interface PrepareNewEntryResponse {
  readonly mostPopularUsernames: readonly string[];
  readonly username: string;
  readonly password: GeneratedPassword;
}

/* ─── Discriminated unions keyed on messageType ────────────────────────── */

/**
 * Maps a `MessageType` value to its inner request and response types.
 * Useful as the source of truth for a typed `rpc<K>(...)` helper; see
 * `src/protocol/session.ts`.
 */
export interface RpcTypeMap {
  readonly [MessageType.Hello]: { request: HelloRequest; response: HelloResponse };
  readonly [MessageType.SearchByUrl]: { request: SearchByUrlRequest; response: SearchByUrlResponse };
  readonly [MessageType.CopyField]: { request: CopyFieldRequest; response: AckResponse };
  readonly [MessageType.UnlockDatabase]: { request: UnlockDatabaseRequest; response: AckResponse };
  readonly [MessageType.LockDatabase]: { request: LockDatabaseRequest; response: AckResponse };
  readonly [MessageType.CreateEntry]: { request: CreateEntryRequest; response: CreateEntryResponse };
  readonly [MessageType.ListGroups]: { request: ListGroupsRequest; response: ListGroupsResponse };
  readonly [MessageType.GeneratePassword]: {
    request: GeneratePasswordRequest;
    response: GeneratePasswordResponse;
  };
  readonly [MessageType.CheckPasswordStrength]: {
    request: CheckPasswordStrengthRequest;
    response: CheckPasswordStrengthResponse;
  };
  readonly [MessageType.PrepareNewEntry]: {
    request: PrepareNewEntryRequest;
    response: PrepareNewEntryResponse;
  };
}

export type RpcRequestFor<K extends MessageTypeValue> = RpcTypeMap[K]['request'];
export type RpcResponseFor<K extends MessageTypeValue> = RpcTypeMap[K]['response'];
