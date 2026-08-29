# Projecture

A Tampermonkey userscript for organizing ChatGPT Projects and chats with a visual board, drag-and-drop moves, search/filtering, local organization insights, bulk operations, custom per-Project/per-chat favicons, and import/export tooling.

**Authorship:** Nathan Burgdorff + Ari (ChatGPT)

> Independent project; not affiliated with or endorsed by OpenAI.

## Highlights

- Visual Kanban-style Project/chat organizer.
- Drag-and-drop and bulk chat moves, with undo support.
- Search, sorting, filtering, compact mode, snippets, dates, and archived-chat support.
- Local title/snippet similarity suggestions and Project-overlap signals.
- AI triage prompt/export workflow for semantic classification.
- Per-Project custom favicons with per-chat overrides.
- Master and per-rule favicon enable/disable controls.
- Favicon management views for configured rules, all Projects, and all chats.
- JSON/CSV organization export plus favicon import/export.
- Migration from the earlier ChatGPT Project Organizer settings key.

## Install

Install `Projecture.user.js` in Tampermonkey or a compatible userscript manager and visit ChatGPT. Projecture opens from the floating `▦` button or with `Alt+Shift+O`.

A workplace-friendly plain-text copy is retained in `workplace-copy/Projecture.txt`.

If migrating favicon rules from the former standalone custom-favicon userscript, see `tools/legacy-favicon-export-patch.txt` and then import the copied JSON from Projecture's Favicons panel.

## Version

Current release: **1.1.0**.

Version snapshots are retained in `versions/` as development continues.

## Architecture

Projecture runs entirely in the browser. It reads the signed-in ChatGPT session and uses ChatGPT's own backend endpoints to enumerate Projects/chats and perform moves. UI state and favicon configuration are stored in browser `localStorage`; the access token is retained only in memory for the current page session.

See `docs/Architecture.md`, `docs/DataModel.md`, and `docs/DevelopmentHistory.md`.

## License

Projecture is licensed under **GPL-3.0-or-later**. See `LICENSE`.
