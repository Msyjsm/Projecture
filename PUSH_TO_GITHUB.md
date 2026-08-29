# Local Git / GitHub workflow

The canonical repository is `Msyjsm/Projecture` and the default branch is `main`.

For ordinary local development:

```bash
git clone https://github.com/Msyjsm/Projecture.git
cd Projecture
# edit Projecture.user.js
git add Projecture.user.js
git commit -m "Describe the change"
git push origin main
```

For a release:

1. Update the userscript `@version` and internal `VERSION` constant together.
2. Update `CHANGELOG.md`.
3. Copy the released source to `versions/Projecture-vX.Y.Z.user.js`.
4. Keep `Projecture.user.js` as the canonical latest version.
5. Run a syntax check such as `node --check Projecture.user.js` before pushing.

The initial v1.1.0 repository import was performed through the connected GitHub integration and a checksum-verified temporary transfer workflow; those transfer artifacts are not part of the intended long-term development process.
