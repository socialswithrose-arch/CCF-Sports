# CCF Sports Ministry check-in app

A free website that works like an app on players' and leaders' phones (add it to the home screen), with:

- **Players:** sign up once, get a personal QR code (works offline), check in by scanning the game day's QR.
- **Leaders:** scan players' QR codes or find them by name, sign up new players at the table (works with no internet; changes upload later), follow-up list, dashboard, player records, D-groups.
- **Google Sheet CRM:** new sign-ups and check-ins are added straight away; the whole report refreshes every night.

Hosted on Vercel (free Hobby plan) with a free Neon Postgres database.

## How it is built

| Part | Where |
|---|---|
| Screens (one-page app, offline support) | `public/` (`index.html`, `app.js` players, `leader.js` leaders, `logic.js` shared rules, `sw.js` offline cache) |
| Player API | `api/player.js` |
| Leader API (sign-in, sync, changes) | `api/leader.js` |
| Nightly Google Sheet refresh | `api/cron.js`, scheduled in `vercel.json` (19:17 UTC = 23:17 Dubai) |
| Database, sign-in, Sheets helpers | `lib/` |

No build step. The only package is `@neondatabase/serverless`.

## Settings (Vercel → Project → Settings → Environment Variables)

| Name | What it is |
|---|---|
| `DATABASE_URL` | Added automatically when you connect the Neon database |
| `LEADER_PASSWORD` | The password leaders type to sign in. Change it any time, then redeploy |
| `VOLUNTEER_PASSWORD` | (optional) Password for volunteers helping at the table: check-in and line-up only, no notes or reports |
| `SESSION_SECRET` | A long random string. Signs leader sign-ins and each game day's check-in code. Changing it signs every leader out |
| `CRON_SECRET` | A long random string. Lets Vercel's nightly job run the Sheet refresh |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | (Google Sheet) the whole key file of the Google service account, pasted as one value |
| `SHEET_ID` | (Google Sheet) `1WWi1WdXqBNS6rJrZfwyD2asGnXnejNDq2iyFnW8GmFw` |

## Connecting the free database (once)

1. Vercel → this project → **Storage** → **Create Database** → **Neon** → Free plan → Create.
2. Connect it to the project for Production and Preview. Vercel adds `DATABASE_URL`.
3. **Deployments** → the latest one → **⋯** → **Redeploy**.

The app creates its table by itself on first use.

## Connecting the Google Sheet (once, about 10 minutes)

1. Go to https://console.cloud.google.com, create a project (e.g. "CCF Sports").
2. **APIs & Services → Library** → search **Google Sheets API** → **Enable**.
3. **IAM & Admin → Service Accounts → Create service account** (name: `ccf-sheet-sync`). No roles needed. Done.
4. Open it → **Keys → Add key → Create new key → JSON**. A file downloads.
5. Open the CRM Sheet → **Share** → paste the service account's email (ends in `iam.gserviceaccount.com`) → **Editor**.
6. In Vercel, add `GOOGLE_SERVICE_ACCOUNT_JSON` (paste the whole file) and `SHEET_ID`, then redeploy.
7. In the app: **Settings → Update the Sheet now** to test.

## Game day

- **Before:** each leader opens the app once with internet so the player list is on their phone.
- **At the court:** Scan tab. Scan players' QR, or Find name, or New player. Tap **Show Sunday's QR** so players with the app can scan and check themselves in. No signal is fine: the top bar shows how many changes are waiting.
- **After:** open the app with internet; everything uploads.

## Rules the app uses

- **Sunday's line-up (or whichever day the game is):** first-timers first, then players in the order they arrived, then volunteers if spots are left. Games of 10 (Team A / Team B, alternating). Leaders can mark someone "Sit out".
- **I'll play:** players answer for the next game day (set in Settings, default Sunday 8:00 AM). It doesn't count as attending; only a check-in does. Two yes answers in a row without coming adds a follow-up step.

- **Attendance:** New (1 visit, last 30 days), Regular (3+ visits in 8 weeks), Occasional (1–2 in 8 weeks), Lapsed (2+ visits, none in 30 days), Didn't return (1 visit, over 30 days ago).
- **Next step:** follow up after first visit → invite to a D-group (regulars, or anyone who asked) → check on an invite after 14 days → assign a leader (2+ visits) → reach out to lapsed players.

## Local testing

`DB_MOCK=1` keeps data in memory instead of Postgres.
