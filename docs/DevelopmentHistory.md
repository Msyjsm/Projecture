# Development History

## Before Projecture

The project began as **ChatGPT Project Organizer**, a Tampermonkey userscript for visually organizing ChatGPT Projects and chats. The pre-rename 1.0.1 code provided a Kanban-style board, drag/drop and bulk moves, search/sorting/filtering, local move suggestions, overlap detection, undo, export/import, and configurable UI behavior.

Separately, a custom favicon userscript was developed to visually distinguish ChatGPT tabs by individual chat or Project. Several approaches were tested against ChatGPT's React-managed `<head>`:

1. Adding one extra favicon candidate worked transiently but ChatGPT/Chrome often replaced or ignored it.
2. Aggressive `MutationObserver`-based enforcement caused a feedback loop with React and could prevent the page from settling.
3. A passive-polling design avoided the feedback loop but Chrome still preferred native favicon candidates.
4. The successful approach temporarily rewrote all existing native favicon candidates to the same desired icon, retained original attributes in a `WeakMap`, and restored them when customization no longer applied.

## 1.1.0 - Projecture

On August 28, 2026, **Projecture** became the canonical name. Version 1.1.0 combines the Organizer and favicon systems into one userscript and one data model.

The merge adds a dedicated Favicons drawer, master/per-rule enable controls, Configured/Projects/Chats views, Project inheritance, chat overrides, favicon import/export, legacy-storage normalization, and move/undo hooks that immediately update inherited favicon resolution when Projecture changes a chat's Project.

The project namespace was standardized to `https://nathanburgdorff.com/userscripts/`.

## Future identity

**ChatrBox** is reserved as a possible future Clippy-like animated Projecture assistant/mascot: conceptually a cube with chat-interface-like screens on its faces, potentially using ASCII-style animations.
