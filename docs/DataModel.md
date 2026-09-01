# Data Model

Projecture has two layers of state: live ChatGPT data held in memory and browser-local Projecture configuration.

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

## Migration principles

- Prefer current Projecture storage when both current and legacy keys exist.
- Copy compatible legacy data forward rather than deleting it automatically.
- Normalize older favicon string values into `{ value, enabled }` objects.
- Treat missing historical `enabled` values as enabled for backward compatibility.
