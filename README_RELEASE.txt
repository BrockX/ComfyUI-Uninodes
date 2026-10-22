UNINODES - VERSION FIX + ONE-CLICK RELEASE HELPER
================================================

ONE-TIME SETUP (DO THIS NOW)
1. Extract ALL FOUR files into the ROOT of your local GitHub checkout:
   ComfyUI-Uninodes/
     VERSION                <-- replaces the incorrect JavaScript-filled file
     Release-Uninodes.cmd
     Release-Uninodes.ps1
     README_RELEASE.txt
2. Verify that VERSION now contains exactly: 1.2.19
3. In VS Code, commit and PUSH these changes to GitHub.
   IMPORTANT: pyproject.toml stays at 1.2.19 during this setup.
   Your existing GitHub Action only triggers automatically when
   pyproject.toml changes, so this correction won't republish 1.2.19.

FOR EACH FUTURE RELEASE
1. Finish and TEST your changes inside ComfyUI.
2. Copy tested source code to your local GitHub checkout.
3. COMMIT and PUSH the tested source code via VS Code first.
   The release helper requires a clean Git working tree and origin/main sync.
4. DOUBLE-CLICK Release-Uninodes.cmd in the checkout folder.
5. Review the version preview, then type RELEASE and press Enter.
6. The helper bumps both files, creates a release commit and pushes it.
7. Your existing GitHub Action attempts to publish the new version.
   Check https://github.com/BrockX/ComfyUI-Uninodes/actions

VERSION EXAMPLES
Double-click:       1.2.19 -> 1.2.20 (patch)
From VS Code shell:  .\Release-Uninodes.cmd minor  (1.2.19 -> 1.3.0)
                     .\Release-Uninodes.cmd major  (1.2.19 -> 2.0.0)
Dry run:             powershell -NoProfile -File .\Release-Uninodes.ps1 -DryRun

NOTES
- This does not ask for or store Registry API keys.
- Only VERSION and pyproject.toml are changed by the release helper.
- The script refuses to release with dirty local files, an unexpected
  remote, a branch other than main, or unsynced local/remote commits.
- It checks that VERSION exactly matches pyproject.toml before releasing.
- It does not run `comfy node publish`, avoiding duplicate publications.
- If git PUSH fails after the commit succeeds, fix and push the existing
  release commit manually. Do NOT run the helper again or it will bump again.
- The GitHub Action may still fail; confirm success in the Actions tab.
- Windows PowerShell 5.1 or newer is required (included with Windows).
- The VERSION replacement is safe for the public repository as of
  2026-10-22: it mistakenly duplicates web/deluxe.js, while the real
  web/deluxe.js file exists separately.
