# Architecture

## Runtime model

Projecture is a single Tampermonkey userscript running on `chatgpt.com`. Its UI is mounted in a Shadow DOM so Projecture styling remains largely isolated from ChatGPT styling.

## ChatGPT data access

Projecture obtains the current ChatGPT access token from `/api/auth/session`, retains it only in memory, and uses ChatGPT's own backend endpoints to enumerate Projects/chats and patch chat Project membership.

The main normalized runtime collections are:

- `state.projects`: Project IDs, names, descriptions, colors, timestamps, and raw Project metadata.
- `state.chats`: chat IDs, titles, snippets, timestamps, current `projectId`, archive/star state, and origin metadata.

## Organization UI

The board groups normalized chats by `projectId`. Drag/drop and bulk moves call the backend PATCH endpoint, update the corresponding in-memory chat, rebuild local intelligence, and record undo metadata. Re-renders snapshot and restore the board's horizontal scroll offset plus each Project column's vertical scroll offset.

Custom GPT `gizmo_id` values are kept separate from `g-p-...` Project IDs. Because moving a Custom GPT conversation into a Project replaces that association, every move path passes through the same destructive-conversion confirmation.

## Local intelligence

Projecture builds token-frequency profiles from Project names/descriptions plus chat titles/snippets. TF/IDF-like weighting and cosine similarity provide conservative local move suggestions and Project-overlap warnings. No external AI call is made for these built-in suggestions.

The optional AI-triage workflow exports a prompt/JSON payload for semantic classification and can import a returned move plan.

## Persistence

Projecture stores browser-local configuration in two keys:

- `projecture.settings.v1`: board/UI settings.
- `projecture.favicons.v1`: favicon master state and Project/chat rules.

Legacy Organizer settings are read from `cgptProjectOrganizer.settings.v1` when no current Projecture settings exist. Legacy data is copied forward rather than deleted automatically.

## Favicon engine

A chat-specific enabled rule has highest priority. If none applies, the current Project's enabled rule is inherited. Otherwise ChatGPT's native favicon is restored.

Chrome did not reliably select an additional custom favicon candidate, so Projecture temporarily rewrites each existing native `rel="icon"` candidate to the desired custom image. Original favicon attributes are retained in a `WeakMap` and restored when no custom rule applies.

The favicon engine deliberately avoids a `MutationObserver` after early prototypes produced feedback loops with React's `<head>` reconciliation. Instead, passive polling verifies state periodically and only mutates attributes whose values are incorrect.

## React boundary

Projecture tries to avoid treating ChatGPT's React-managed DOM as owned state. Its main UI lives in its own Shadow DOM, and favicon bookkeeping is kept outside React-managed elements wherever practical. Coupling to ChatGPT internals should remain explicit and narrow because endpoints and DOM behavior may change without notice.
