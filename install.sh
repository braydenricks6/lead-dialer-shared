#!/bin/bash
# Lead Dialer — one-line installer.
#   curl -fsSL https://raw.githubusercontent.com/braydenricks6/lead-dialer-shared/main/install.sh | bash
#
# Downloads the latest packaged release and unzips it to ~/Desktop/LeadDialer-Mac.
# Non-interactive on purpose (no prompts) so it works cleanly piped through `bash`.
# After this one-time install, the app self-updates on every launch — this script
# only needs to be run once per person.
set -e

REPO="braydenricks6/lead-dialer-shared"
DEST="$HOME/Desktop/LeadDialer-Mac"
ZIP_URL="https://github.com/$REPO/releases/latest/download/LeadDialer-Mac.zip"

echo "Lead Dialer installer"
echo ""

# Never clobber a real existing install — that folder is where leads.json (their
# whole database) lives. If it's there, this is a re-run or a mistake; either way,
# do nothing destructive.
if [ -f "$DEST/leads.json" ]; then
  echo "Lead Dialer is already installed at: $DEST"
  echo "(found existing lead data there, so leaving it alone)"
  echo ""
  echo "Just open that folder and double-click \"Lead Dialer.app\" (or \"Start Lead Dialer.command\")."
  exit 0
fi

# A stray empty/incomplete folder from a previous failed attempt is safe to clear.
if [ -d "$DEST" ]; then
  echo "Clearing an incomplete previous install at $DEST…"
  rm -rf "$DEST"
fi

echo "Downloading Lead Dialer…"
TMP_ZIP="$(mktemp -t leaddialer).zip"
curl -fsSL -o "$TMP_ZIP" "$ZIP_URL"

echo "Unzipping to $DEST…"
mkdir -p "$HOME/Desktop"
unzip -q "$TMP_ZIP" -d "$HOME/Desktop"
rm -f "$TMP_ZIP"

# Clear the macOS "downloaded from internet" quarantine flag up front, same as the
# .command scripts already do on first launch — one less right-click-Open needed.
xattr -dr com.apple.quarantine "$DEST" 2>/dev/null || true
chmod +x "$DEST/Start Lead Dialer.command" "$DEST/Setup Calling.command" 2>/dev/null || true

echo ""
echo "Done! Lead Dialer is installed at: $DEST"
echo ""
echo "Next steps:"
echo "  1. Open Finder → Desktop → LeadDialer-Mac"
echo "  2. Double-click Setup Calling.command (one time) to connect your Twilio number"
echo "  3. Double-click Lead Dialer.app (or Start Lead Dialer.command) any time to open the app"
