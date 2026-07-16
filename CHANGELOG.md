## v20 — Call recordings
- Every dial mode (manual, keypad, hands-free single-line, parallel/ring-my-phone, inbound) now records the call via Twilio. A "🎙 Call Recordings" section in the lead detail pane lists them with an inline player — click to expand and load. Twilio's recording fee is about $0.0025/minute, on top of normal per-minute call cost. No recording-disclosure announcement is played at the start of calls — a deliberate choice, not an oversight; several states legally require all-party consent to record, so check what applies before relying on this.

## v19 — Fixed a data-loss bug from v18
- v18's bracket-notes splitter used a "70% of the text is bracket tags" threshold, which was too loose — a real note like "[Household Income: $30k-$50k] 7/10 2x NA" (a vendor tag plus a genuine agent-typed follow-up) would have had the "7/10 2x NA" part silently deleted, since the short residual barely tipped the percentage. Caught before it did any damage in the wild by checking a broader sample of leads, not just the ones a specific import touched. Now requires ZERO leftover text after stripping the tags — if there's any real content next to them, the whole note is left completely alone.

## v18 — Auto-split bracket-tagged notes into real fields
- Some lead vendors cram everything into one notes column as repeated "[Key: Value] [Key: Value]" tags instead of separate columns. When a notes value is almost entirely that pattern, it now gets split into individual custom fields (which already show up in the lead detail's "More details" section) instead of one unreadable text blob. A genuine free-text note that happens to contain a bracket is left alone.

## v17 — Column-matching step for CSV imports
- Importing a generic CSV now shows a "Match your columns" step (like Ringy's import editor) before anything gets saved — every detected column, a sample value, and a dropdown to confirm or fix what it maps to (Name, Phone, Address components as custom fields, Notes, Disposition/Status, ignore it entirely, etc.), pre-filled with our best guess. Fixes a real trap: a status-like column named something other than exactly "Status" (e.g. a vendor's own tier/tag column) could silently get treated as a real call disposition and wrongly mark fresh leads as already contacted — now you see and confirm every mapping instead of trusting an invisible guess. Skipped for Ringy-raw exports and re-imports of this app's own JSON export, which don't need it.

## v16 — Calendar for callbacks & appointments
- New 📆 Calendar button opens a month-grid view of every scheduled callback and appointment, with a dot for each on the days they fall on — click a day to see the list, click an item to jump straight to that lead. "Scheduled Appointment" now opens the same time-zone-aware scheduling popover Callback already used (added in v15), storing a separate appointmentAt/appointmentNote pair. Leads with a pending appointment are now excluded from the auto-dial queue, same as pending callbacks — you won't get auto-dialed and dispositioned out of a meeting you already booked. The "Due today" strip now shows both callbacks and appointments together.

## v15 — Callbacks scheduled in the lead's own time zone
- Scheduling a callback now reads and writes the time picker in the LEAD's local time zone (based on their state), not yours — so if they say "call me at 3," you type 3, no mental math. A disclaimer in the scheduling popover names their time zone; everywhere else (the due-today strip, the detail pill) already shows the converted time in your own local time, since the underlying stored instant hasn't changed. Falls back to your own local time for any state with no known time zone, same as before.

## v14 — Configurable machine-pickup retry limit
- The "skip after a machine pickup" setting from v13 is now a number instead of on/off: "Move on after N machine pickup(s), even if attempts remain" (1–5, off by default). Lets you dial a lead 3 times overall but stop after 2 machine pickups — useful since some phones (iPhone Do Not Disturb) auto-forward the first unknown call to voicemail but let a second one ring through, so it's often worth one retry, just not the full attempt count.

## v13 — Skip retrying after a machine pickup
- New setting in Auto-Dial Defaults: "Move on immediately after a machine pickup — don't retry the same lead." Off by default. Applies to both hands-free single-line dialing and ring-my-phone sessions — a voicemail box won't become a person on the next attempt, so this saves the wasted retries when attempts-per-lead is set above 1.

## v12 — Fixed cross-day log collapsing
- A retried lead's collapsed log line (e.g. "No Answer ×3") only merges same-day repeats now. Previously, a lead that got the same outcome again after resting a few days on the retry cadence had that new dial silently merged into the old entry, with the whole entry's date bumped to today — quietly attributing older dials to today's stats.

## v11 — Fixed Stats dashboard undercounting retried calls
- Dispositions that get retried and collapsed into one log line (e.g. "No Answer ×3") were being tallied as a separate bucket from plain "No Answer," and counted as 1 call instead of 3. Fixed for the Calls tile, Reach rate, the 14-day chart, and the disposition breakdown — all now merge and count correctly.

## v10 — What's New in Settings
- Settings now shows a "What's New" link next to the version number, listing recent updates like this one.

## v9 — Show app version in Settings
- A small "v9" now shows in the bottom-left corner of Settings, next to Done.

## v8 — Nearest-state caller ID fallback
- Auto state-switching now borrows the nearest bordering state's number (e.g. Alabama uses your Georgia number) instead of jumping straight to your active number when a lead's own state has none assigned.

## v7 — Setup Health panel + friendlier errors
- Settings shows an at-a-glance health check: active caller ID, calling backend deployed, numbers registered.
- Common Twilio errors (KYC/compliance block, trial-account limits, bad credentials) now show plain-English explanations with a next step, in both the app and the Setup Calling wizard.
- Setup Calling wizard no longer silently defaults to buying a number on invalid input at the caller-ID prompt — it re-asks.

## v6 — Remove numbers from Settings
- New "remove" link permanently releases a Twilio number from your account (stops the ~$1.15/mo charge) — separate from "hide from CRM," guarded against removing your active caller ID.

## v5 — Hide numbers, trimmed dispositions
- "Hide from CRM" link for an owned number used by something else (e.g. a texting-only number for another product) — removes it from caller ID, auto state-switching, and the spam checklist without releasing it from Twilio.
- Default disposition list for new installs trimmed to match real day-to-day usage.

## v4 — Removed raw parallel dial, ring-my-phone retry
- Raw parallel dialing removed (never worked reliably).
- Ring-my-phone now retries a lead per your attempts-per-lead setting instead of dialing once and moving on, and shows the dialing lead in the detail pane right away.
- Buying a number auto-assigns its state for caller ID switching.

## v3 — Ring-my-phone audio fix + auto-redeploy
- Fixed dead silence during ring-my-phone waits between attempts.
- Fixed the lead info panel not updating until someone answered.
- Twilio Function code changes now auto-redeploy to your account on every launch.

## v2 — Fresh vs. aged leads
- New import prompt classifies each batch as 🌱 Fresh or 🕰 Aged, with a list filter and a manual correction toggle for fixing a mislabeled batch.

## v1 — Initial shared release
- Clients/Policies tracking, the callback auto-dial fix, a proper desktop app launcher, and the self-updater that's powered every release since.
