# Projecture

A Tampermonkey userscript for organizing ChatGPT Projects and chats with a visual board, drag-and-drop moves, search/filtering, local organization insights, bulk operations, custom per-Project/per-chat favicons, and import/export tooling.

**Authorship:** Nathan Burgdorff + Ari (ChatGPT)

> Independent project; not affiliated with or endorsed by OpenAI.

## Highlights

- Visual Kanban-style Project/chat organizer.
- Drag-and-drop and bulk chat moves, with undo support.
- Custom GPT chat badges and destructive-conversion warnings before Project moves.
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

## Preview testing

Projecture supports an independently installed Preview channel for testing pull requests beside the release script:

1. Install `Projecture.preview.user.js` once from the repository's fixed `preview` branch.
2. Open ChatGPT normally to run the release copy.
3. Add `#proj-preview` to a ChatGPT URL to run Preview instead; removing the hash returns to release. Projecture reloads the page when this selector changes so exactly one copy initializes.

Every push outside the generated `preview` branch rebuilds that branch through `.github/workflows/preview-channel.yml`. The Preview userscript has its own name, namespace, monotonically increasing build version, update/download URLs, visible `[PREVIEW]` label, and local settings/favicon keys.

Preview and release therefore do not overwrite each other's browser-local configuration. They still operate on the same live ChatGPT account: moving a chat in Preview really moves it, and is not sandboxed test data.

Refreshing ChatGPT only reloads the userscript version already installed in the browser. To fetch a newer Preview build, use Tampermonkey's **Check for userscript updates** command or revisit the fixed Preview install URL. See `docs/PREVIEW_TESTING.md` for the complete testing workflow.

## Version

Current release: **1.1.2**.

Version snapshots are retained in `versions/` as development continues.

## Architecture

Projecture runs entirely in the browser. It reads the signed-in ChatGPT session and uses ChatGPT's own backend endpoints to enumerate Projects/chats and perform moves. UI state and favicon configuration are stored in channel-specific browser `localStorage`; the access token is retained only in memory for the current page session.

See `docs/Architecture.md`, `docs/DataModel.md`, and `docs/DevelopmentHistory.md`.

Run the userscript regression checks with `node --test tests/Projecture.regression.test.js`.

## License

Projecture is licensed under **GPL-3.0-or-later**. See `LICENSE`.
