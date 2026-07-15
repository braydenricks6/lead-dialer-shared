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
