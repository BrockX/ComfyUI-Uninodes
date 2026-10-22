# Uninodes release helper for Windows PowerShell / VS Code.
# Updates VERSION + pyproject.toml, commits and pushes to main.
# The existing GitHub Action publishes to Comfy Registry when pyproject.toml changes.
[CmdletBinding()]
param(
    [ValidateSet('patch', 'minor', 'major')]
    [string]$Bump = 'patch',
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$repo = $PSScriptRoot
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

function Git-Output {
    param([string[]]$ArgsList)
    $result = & git @ArgsList
    if ($LASTEXITCODE -ne 0) {
        throw "Git failed: git $($ArgsList -join ' ')"
    }
    return (($result | Out-String).Trim())
}

try {
    if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
        throw 'Git was not found. Install Git for Windows or use the Git-enabled VS Code terminal.'
    }
    Push-Location $repo
    try {
        $root = Git-Output -ArgsList @('rev-parse', '--show-toplevel')
        if ([System.IO.Path]::GetFullPath($root) -ne [System.IO.Path]::GetFullPath($repo)) {
            throw 'Place both release files in the ROOT of the ComfyUI-Uninodes Git repository.'
        }

        $branch = Git-Output -ArgsList @('branch', '--show-current')
        if ($branch -ne 'main') {
            throw "Current branch is '$branch'. Switch to main before publishing."
        }

        $origin = Git-Output -ArgsList @('remote', 'get-url', 'origin')
        if ($origin -notmatch '(?i)(github\.com[:/])BrockX/ComfyUI-Uninodes(?:\.git)?$') {
            throw "This doesn't look like BrockX/ComfyUI-Uninodes (origin: $origin). Refusing to publish."
        }

        $pending = Git-Output -ArgsList @('status', '--porcelain', '--untracked-files=normal')
        if ($pending) {
            throw "There are uncommitted/untracked changes. Commit and push your tested code (and the release helper itself) in VS Code first.`n$pending"
        }

        Write-Host 'Checking GitHub for newer commits...' -ForegroundColor DarkCyan
        $null = Git-Output -ArgsList @('fetch', '--quiet', 'origin', 'main')
        $localCommit = Git-Output -ArgsList @('rev-parse', 'HEAD')
        $remoteCommit = Git-Output -ArgsList @('rev-parse', 'refs/remotes/origin/main')
        if ($localCommit -ne $remoteCommit) {
            throw 'Local main and origin/main are not identical. Use VS Code Sync/Pull/Push first and rerun.'
        }

        $tomlPath = Join-Path $repo 'pyproject.toml'
        $versionPath = Join-Path $repo 'VERSION'
        if (-not (Test-Path -LiteralPath $tomlPath -PathType Leaf)) {
            throw 'pyproject.toml not found in repository root.'
        }

        $toml = [System.IO.File]::ReadAllText($tomlPath)
        $projectMatch = [regex]::Match($toml, '(?ms)^\[project\][ \t]*\r?\n(?<body>.*?)(?=^\[|\z)')
        if (-not $projectMatch.Success) { throw 'Cannot find a [project] section in pyproject.toml.' }
        $lineMatch = [regex]::Match($projectMatch.Groups['body'].Value,
            '(?m)^[ \t]*version[ \t]*=[ \t]*["''](?<version>\d+\.\d+\.\d+)["''][ \t]*(?:#.*)?$')
        if (-not $lineMatch.Success) { throw 'Expected a simple version = "1.2.19" line inside [project].' }

        $oldVersion = $lineMatch.Groups['version'].Value
        $parts = $oldVersion.Split('.')
        $major = [int]$parts[0]
        $minor = [int]$parts[1]
        $patch = [int]$parts[2]
        switch ($Bump) {
            'major' { $major++; $minor = 0; $patch = 0 }
            'minor' { $minor++; $patch = 0 }
            'patch' { $patch++ }
        }
        $newVersion = "$major.$minor.$patch"

        # Replace only the exact version inside [project], leaving other TOML settings untouched.
        $offset = $projectMatch.Groups['body'].Index + $lineMatch.Groups['version'].Index
        $updatedToml = $toml.Substring(0, $offset) + $newVersion +
            $toml.Substring($offset + $oldVersion.Length)

        $versionFileText = if (Test-Path -LiteralPath $versionPath -PathType Leaf) {
            [System.IO.File]::ReadAllText($versionPath).Trim()
        } else { '<missing>' }

        Write-Host ''
        Write-Host 'UNINODES RELEASE' -ForegroundColor Cyan
        Write-Host "  Version:    $oldVersion -> $newVersion ($Bump)"
        Write-Host '  Files:      pyproject.toml + VERSION'
        Write-Host '  Git branch: main'
        Write-Host '  Action:     commit + push; GitHub publishes to Comfy Registry'
        if ($versionFileText -ne $oldVersion) {
            throw "VERSION is '$versionFileText', but pyproject.toml is '$oldVersion'. Fix VERSION before releasing."
        }
        if ($DryRun) {
            Write-Host 'DRY RUN - No files modified, no commits, no pushes.' -ForegroundColor Yellow
            return
        }

        $answer = Read-Host 'Publish this release? Type RELEASE to confirm'
        if ($answer -cne 'RELEASE') {
            Write-Host 'Cancelled. Nothing changed.' -ForegroundColor Yellow
            return
        }

        [System.IO.File]::WriteAllText($tomlPath, $updatedToml, $utf8NoBom)
        [System.IO.File]::WriteAllText($versionPath, "$newVersion`n", $utf8NoBom)
        $null = Git-Output -ArgsList @('add', '--', 'pyproject.toml', 'VERSION')
        $null = Git-Output -ArgsList @('commit', '-m', "chore: release v$newVersion")
        Write-Host "Committed v$newVersion locally." -ForegroundColor Cyan
        Write-Host 'Pushing to GitHub...' -ForegroundColor DarkCyan
        $null = Git-Output -ArgsList @('push', 'origin', 'main')

        Write-Host ''
        Write-Host "v$newVersion pushed successfully!" -ForegroundColor Green
        Write-Host 'Your existing GitHub Action will now attempt the Registry publication.' -ForegroundColor Green
        Write-Host 'Check: https://github.com/BrockX/ComfyUI-Uninodes/actions'
    } finally {
        Pop-Location
    }
} catch {
    Write-Host ''
    Write-Host "RELEASE STOPPED: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host 'If a Git commit was created but push failed, fix the Git issue and push that commit.' -ForegroundColor Yellow
    Write-Host 'Do NOT run the helper again until that is resolved, or it will bump again.' -ForegroundColor Yellow
    exit 1
}
