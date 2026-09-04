# Changelog

## 1.1.2 - 2026-09-01

- Added an automated, separately installable Preview build for side-by-side pull-request testing.
- Routed normal URLs to Production and URLs ending in `#proj-preview` to Preview, with automatic reload when the hash changes.
- Isolated Preview UI and favicon settings from Production local storage.
- Preserved the board's horizontal scroll position and every Project column's vertical scroll position across selection-driven re-renders.
- Separated ChatGPT Project IDs from Custom GPT IDs in normalized chat data.
- Added a visible `Custom GPT` badge to affected chat cards and a selection-bar warning when any are selected.
- Added an unavoidable confirmation before a move would convert Custom GPT chats into standard ChatGPT chats.
- Clarified after Undo that Projecture can restore Project placement but cannot restore a discarded Custom GPT association.
- Included Custom GPT metadata in JSON and CSV organization exports.
- Added regression coverage for preview generation/routing, storage isolation, scroll preservation, ID classification, and destructive-move confirmation.

## 1.1.0 - 2026-08-28

- Canonicalized the project name from ChatGPT Project Organizer to **Projecture**.
- Standardized the userscript namespace to `https://nathanburgdorff.com/userscripts/`.
- Merged the standalone custom favicon userscript into Projecture.
- Added per-Project favicon rules and per-chat overrides.
- Added master and per-rule favicon enable/disable controls.
- Added Configured / Projects / Chats favicon management views.
- Added favicon import/export and migration support for legacy configuration formats.
- Integrated favicon inheritance with Projecture's live chat/project model.
- Added favicon updates when Projecture moves or restores chats.
- Preserved the existing board, drag/drop, bulk move, undo, search, sorting, insights, export, and UI-settings functionality.

## 1.0.1 - pre-Projecture

- Last retained version of the script under the **ChatGPT Project Organizer** name.
- Visual Kanban-style Project/chat organizer with drag/drop, bulk moves, search, sorting, local suggestions, overlap detection, undo, and export/import tooling.
