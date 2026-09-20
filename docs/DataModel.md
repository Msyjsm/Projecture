# Data Model

Projecture has three layers of state: live ChatGPT data held in memory, browser-local configuration, and an optional timestamped portable representation used for Drive synchronization.

## Projects

Normalized Project records include:

- `id` - normalized `g-p-...` Project identifier.
- `name` / `description` / `instructions`.
- `color` - detected ChatGPT Project color when available.
- `createdAt` / `updatedAt`.
- `raw` - retained source metadata for future compatibility work.

## Chats

Normalized chat records include:

- `id` - conversation identifier.
- `title` / `snippet`.
- `createTime` / `updateTime`.
- `projectId` - current normalized Project identifier or `null`.
- `archived` / `starred` / `temporary`.
- `origin`.
- `gizmoId` - the source `gizmo_id`, whether it identifies a Project or a Custom GPT.
- `customGpt` / `customGptId` / `customGptName` - Custom GPT identity metadata when present.

Chat IDs are stable identities for chat-specific configuration. Moving a chat between Projects does not move or rewrite its chat-specific favicon rule.

Project IDs and Custom GPT IDs are deliberately normalized into separate fields. ChatGPT does not support Custom GPT chats inside Projects: assigning one to a Project replaces its Custom GPT association. Projecture warns before that destructive conversion and does not claim that Undo can reconstruct the lost association.

## UI settings

Stored under `projecture.settings.v1`.

Examples include sort/view choices, compact mode, snippet/date visibility, archived-chat inclusion, collapsed/hidden Projects, organizer colors, and column width.

Column width is intentionally absent from portable/cloud state. Other durable settings are represented as independent timestamped records so unrelated changes made on different browsers can converge.

## Favicon settings

Stored under `projecture.favicons.v1`:

```json
{
  "enabled": true,
  "projects": {
    "g-p-...": { "value": "🧩", "enabled": true }
  },
  "chats": {
    "conversation-id": { "value": "🍆", "enabled": true }
  }
}
```

Resolution order is:

1. enabled chat-specific rule;
2. enabled rule for the chat's current Project;
3. ChatGPT's native favicon.

A disabled chat-specific rule remains stored but does not block inheritance from an enabled Project rule.

## Saved multi-chats

Stored under `projecture.multichats.v1`. Each active view contains:

- `id` and `name`.
- ordered `chatIds` (two to four entries).
- `scrollPositions` keyed by chat ID.
- `createdAt` and `updatedAt`.

Cloud portable state wraps each view in a timestamped record. Deletion produces a tombstone instead of removing the record immediately.

## Portable state

`projecture.portable.v1` uses format `ProjecturePortableState`, schema version 1. It contains timestamped scalar settings, timestamped map entries, favicon rules, and saved multi-chat records. A record with `deleted: true` and a newer timestamp wins over an older live value. Exact-timestamp ties use a deterministic serialized comparison so clients converge.

## Migration principles

- Prefer current Projecture storage when both current and legacy keys exist.
- Copy compatible legacy data forward rather than deleting it automatically.
- Normalize older favicon string values into `{ value, enabled }` objects.
- Treat missing historical `enabled` values as enabled for backward compatibility.
- Seed timestamped portable records from existing local settings/favicons on first v1.2 load.
- Retain deletion tombstones through sync rather than interpreting absence as deletion.
