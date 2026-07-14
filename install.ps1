# Lead Dialer - one-line Windows installer.
#   powershell -c "irm https://raw.githubusercontent.com/braydenricks6/lead-dialer-shared/main/install.ps1 | iex"
#
# Downloads the latest packaged release and unzips it to Desktop\LeadDialer-Windows.
# Non-interactive on purpose (no prompts) so it works cleanly piped through `iex`.
# After this one-time install, the app self-updates on every launch - this script
# only needs to be run once per person.

$ErrorActionPreference = "Stop"

$repo = "braydenricks6/lead-dialer-shared"
$dest = Join-Path $env:USERPROFILE "Desktop\LeadDialer-Windows"
$zipUrl = "https://github.com/$repo/releases/latest/download/LeadDialer-Windows.zip"

Write-Host "Lead Dialer installer"
Write-Host ""

# Never clobber a real existing install - that folder is where leads.json (their
# whole database) lives. If it's there, this is a re-run or a mistake; either way,
# do nothing destructive.
if (Test-Path (Join-Path $dest "leads.json")) {
    Write-Host "Lead Dialer is already installed at: $dest"
    Write-Host "(found existing lead data there, so leaving it alone)"
    Write-Host ""
    Write-Host "Just open that folder and double-click 'Start Lead Dialer.bat'."
    exit 0
}

# A stray empty/incomplete folder from a previous failed attempt is safe to clear.
if (Test-Path $dest) {
    Write-Host "Clearing an incomplete previous install at $dest..."
    Remove-Item -Recurse -Force $dest
}

Write-Host "Downloading Lead Dialer..."
$tmpZip = Join-Path $env:TEMP "leaddialer-$(Get-Random).zip"
Invoke-WebRequest -Uri $zipUrl -OutFile $tmpZip

Write-Host "Unzipping to $dest..."
$desktop = Join-Path $env:USERPROFILE "Desktop"
Expand-Archive -Path $tmpZip -DestinationPath $desktop -Force
Remove-Item $tmpZip -Force

# Clear the "downloaded from the internet" mark-of-the-web flag on every file so
# Windows doesn't nag/block node.exe and the scripts - one less warning to click past.
Get-ChildItem -Path $dest -Recurse | Unblock-File -ErrorAction SilentlyContinue
Unblock-File -Path $dest -ErrorAction SilentlyContinue

# Desktop shortcut with a real icon, so there's something better to click than a
# plain .bat file. Points at Start Lead Dialer.bat; icon.ico ships in the package.
try {
    $iconPath = Join-Path $dest "icon.ico"
    if (Test-Path $iconPath) {
        $shortcutPath = Join-Path $desktop "Lead Dialer.lnk"
        $wsh = New-Object -ComObject WScript.Shell
        $shortcut = $wsh.CreateShortcut($shortcutPath)
        $shortcut.TargetPath = Join-Path $dest "Start Lead Dialer.bat"
        $shortcut.WorkingDirectory = $dest
        $shortcut.IconLocation = $iconPath
        $shortcut.Save()
    }
} catch {
    Write-Host "(couldn't create a desktop shortcut - you can still use Start Lead Dialer.bat directly)"
}

Write-Host ""
Write-Host "Done! Lead Dialer is installed at: $dest"
Write-Host ""
Write-Host "Next steps:"
Write-Host "  1. Open File Explorer -> Desktop -> LeadDialer-Windows"
Write-Host "  2. Double-click Setup Calling.bat (one time) to connect your Twilio number"
Write-Host "  3. From then on, double-click the new 'Lead Dialer' icon on your Desktop"
Write-Host "     to open the app (or Start Lead Dialer.bat in that same folder)"
