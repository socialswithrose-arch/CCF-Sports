# Put CCF Sports Dubai online (about 15 minutes, no coding)

You need: the ministry's GitHub and Vercel accounts, and this folder (unzipped).

## 1. Put the code on GitHub (5 min)
1. Go to https://github.com/new, name it `ccf-sports-dubai`, choose **Private**, tick nothing else, click **Create repository**.
2. On the new page click **uploading an existing file**.
3. Open the unzipped `ccf-sports-dubai` folder on your computer, select **everything inside it** (api, lib, public, package.json, vercel.json, README.md, DEPLOY.md, .gitignore) and drag it into the page. Wait until every file is listed.
4. Click **Commit changes**.

## 2. Create the site on Vercel (3 min)
1. Sign in to the ministry's Vercel, click **Add New… → Project**.
2. Find `ccf-sports-dubai` and click **Import** (if it isn't listed, click **Adjust GitHub App Permissions** and allow that repository).
3. Framework Preset: **Other**. Leave everything else as it is.
4. Open **Environment Variables** and add these four (Name → Value):

| Name | Value |
|---|---|
| LEADER_PASSWORD | a password for leaders (you choose it) |
| VOLUNTEER_PASSWORD | a different password for volunteers (you choose it) |
| SESSION_SECRET | 742b233f2c97e80e176e78d2cddcd7e5b18242a49e6a688d8fdeadcf94737ff9 |
| CRON_SECRET | ca06e7b1a50958bae9e1ef5ef937cf4ef4fb6844fe4fdcd6 |

5. Click **Deploy**. When it finishes you get an address like `ccf-sports-dubai.vercel.app`.

## 3. Connect the free database (2 min)
1. In the project, open the **Storage** tab → **Create Database** → **Neon** (Serverless Postgres) → **Free** plan → accept → **Create**.
2. Connect it to the project for **Production** and **Preview**. Vercel adds `DATABASE_URL` by itself.
3. Go to **Deployments**, open the top one, click **⋯ → Redeploy**.

## 4. Check it works
1. Open the address on your phone. You should see the welcome screen with the team photo.
2. Tap **Leaders sign in**, type your name and the leaders' password.
3. Go to **Settings**: set the gyms for North and South, the game day and time, and the leaders' names. Add the D-groups.
4. Sign yourself up as a test player from another phone (or a private browser window), then scan or find yourself on the leader phone.
5. Delete the test player afterwards (Players → open → Delete player).

## 5. Google Sheet (optional, later)
See "Connecting the Google Sheet" in README.md. Until then, use Settings → Download CSV.

## If something goes wrong
- The deploy fails: open the deployment, copy the red error lines and send them to Claude.
- "The database is not connected yet": step 3 wasn't finished, or the Redeploy was skipped.
- "That password isn't right": check LEADER_PASSWORD in Settings → Environment Variables, then Redeploy after changing it.
- Changing a password or secret only takes effect after a Redeploy.
