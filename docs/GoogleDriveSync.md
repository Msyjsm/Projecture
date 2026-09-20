# Google Drive Sync

Projecture v1.2 and later can synchronize portable organizer state through a small Google Apps Script bridge owned by the user. The bridge stores a visible `Projecture/ProjectureCloudBackup.json` file in Google Drive.

## Why a user-owned bridge?

Projecture runs on `chatgpt.com`, a domain the userscript author does not own. Google's browser OAuth flow is therefore a poor fit: authorized JavaScript origins must be controlled by the OAuth client owner, and browser tokens expire. The Apps Script bridge receives Drive permission once and Projecture authenticates each request with a high-entropy shared secret.

## One-time setup

1. Open Google Apps Script and create a new project.
2. Replace the default code with `integrations/google-drive/Code.gs` from this repository.
3. Run `Setup()` once and approve the requested Drive permission.
4. Copy the `Sync secret` from the execution log.
5. Choose **Deploy > New deployment > Web app**.
6. Set **Execute as** to **Me** and **Who has access** to **Anyone**.
7. Deploy and copy the Web App URL ending in `/exec`.
8. In Projecture, click **Drive: Setup** and paste the `/exec` URL and secret.

The Web App endpoint must be reachable without a Google sign-in redirect so Tampermonkey can call it from ChatGPT. The shared secret protects read/write operations. Keep it private.

## What syncs

- Portable UI preferences: sort/view choices, compact/snippet/date options, archived-chat loading, collapsed and hidden Projects, and custom Project colors.
- Project and chat favicon rules, including intentional removals.
- Saved multi-chat names, ordered chat IDs, and each pane's saved scroll position.

Column width remains device-local because different screens need different physical dimensions. Current searches, selections, loaded conversation contents, ChatGPT tokens, and Google bridge credentials are also local-only.

Production and Preview use separate local configuration and separate bridge credentials. They may point to the same bridge if deliberate, but doing so makes both channels merge into the same cloud state.

## Merge and conflict behavior

Each sync performs read, validate, merge, and conditional write. Individual settings and records carry modification timestamps. Favicon and saved-multi-chat deletions are retained as tombstones so another browser cannot resurrect stale data. The bridge uses a monotonically increasing revision; if another browser writes first, Projecture rereads and retries up to three times.

Configured browsers sync shortly after startup and after debounced durable changes. Click the Drive button to force a sync. Shift-click it to reconfigure or disconnect that browser.
