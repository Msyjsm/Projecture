# Preview testing channel

Projecture has two distribution channels:

- **Production:** `main` -> Greasy Fork -> Tampermonkey (`Projecture`)
- **Preview:** latest pushed non-`preview` branch -> GitHub Actions -> `preview` branch -> Tampermonkey (`Projecture [PREVIEW]`)

The preview build is generated from the same canonical `Projecture.user.js`. The build step changes only distribution metadata: its name, namespace, version, update URL, and download URL. It also updates Projecture's internal `VERSION` constant when it exactly matches the source `@version`.

## One-time installation

Install the preview script from:

`https://raw.githubusercontent.com/Msyjsm/Projecture/preview/Projecture.preview.user.js`

Tampermonkey treats it as a separate script because its `@name` and `@namespace` differ from production.

## Day-to-day testing

Because production and preview both match ChatGPT, do **not** leave both enabled at once.

Normal use:

- Projecture: enabled
- Projecture [PREVIEW]: disabled

PR/branch testing:

- Projecture: disabled
- Projecture [PREVIEW]: enabled
- refresh ChatGPT

Each GitHub Actions run appends its monotonically increasing `github.run_number` to the source version. For example, source `1.1.2` may become preview `1.1.2.37`. That lets Tampermonkey detect a new preview even when a branch commit does not bump the production `@version`.

## What the `preview` branch is

The `preview` branch is a generated distribution branch. Do not develop on it and do not merge it into `main`. It contains only:

- `Projecture.preview.user.js`
- `PREVIEW_SOURCE.txt`, recording the source branch and commit

If there is only one active development branch, the last push to that branch is the preview. A later push to `main` (normally a merge) rebuilds preview from `main`, so the preview channel does not remain stranded on stale pre-merge code.

## GitHub Actions permissions

The workflow needs permission to write the generated `preview` branch. If the workflow reports a permissions error, open:

**Repository Settings -> Actions -> General -> Workflow permissions**

and select **Read and write permissions**.

## Data warning

Changing a userscript's name/namespace separates Tampermonkey-managed storage, but Projecture currently stores its settings in ChatGPT's page `localStorage`. Production and Preview therefore still see the same Projecture settings/favicons. Treat preview builds as real code operating on your real Projecture configuration.
