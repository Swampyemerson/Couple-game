# Just Us 💞

A private couples game app for Emerson & Sydney. It's a free, better version of Couple Joy.
It runs in the phone browser, can be added to the home screen like a real app, and needs no accounts.

## What's in it

- **Question of the day.** You both answer, and answers stay hidden until you've both answered. Includes a streak counter and a history of past days.
- **How Well Do You Know Me?** (6 quizzes). Answer for yourself and guess for the other person. Scores are tracked across every quiz.
- **This or That**, **Would You Rather**, **Who's More Likely To**, **Never Have I Ever**. Results show matches and the % you're in sync.
- **Deep Talks** (5 packs). Written answers, revealed side by side.
- **Love Language Quiz.** Ranked results for each of you, plus a tip on how to love the other person.
- **Truth or Dare.** Sweet, Flirty and Spicy levels, for playing in person. Takes turns automatically.
- **Date spinner.** Random date ideas in 5 categories. Send any idea to the bucket list.
- **Shared bucket list** and a **days-together counter**.
- **🔥 After Dark tab** (hidden until you tap to open it):
  - **Desire Match.** Yes / Maybe / No. Only things you *both* said yes or maybe to are ever shown, so no awkward no's.
  - Spicy quizzes, spicy This or That, Would You Rather, Most Likely To, Never Have I Ever.
  - Pillow Talk and Confessions written prompts.

All questions live in `js/content.js`. Add your own, or inside jokes, by editing the lists.

## Claude artifact version (what we use)

`python3 tools/build_artifact.py` bundles everything into `dist/just-us.html`, which is published as a Claude artifact with the `db` and `user` capabilities. Answers sync through the artifact's built-in shared database, so there's no Firebase and no sync links.

- Share it from the artifact's Share menu by inviting the other person's email as an **Editor**. A public link stops guests from saving.
- Each person picks their name once. Other devices signed in to the same Claude account recognize them automatically.
- After changing questions or code, rebuild and republish to the same artifact.

## Put it online (free, ~2 minutes)

**GitHub Pages:** Settings → Pages → *Deploy from a branch* → `main` / root → Save.
After a minute it's live at `https://<your-username>.github.io/<repo-name>/`.
(On a free GitHub plan, Pages needs the repo to be public. Only the questions are in the repo. Your answers never are.)

Other free options: drag the folder onto [Netlify Drop](https://app.netlify.com/drop), or use Cloudflare Pages.

Then on each phone, open the link:
- **iPhone:** Safari → Share → *Add to Home Screen*
- **Android:** Chrome → ⋮ → *Add to Home screen / Install app*

## Syncing between your phones

### Option A: sync links (works right away, no setup)
After you play, the app shows **"Send sync link"**. Text it to the other person. When they open it, your answers load on their phone. They do the same back.
Tip: links open in the browser, not the home-screen app. If you installed it, copy the link and paste it into **Us → Sync & pairing**.

### Option B: live sync (recommended, ~5 minutes, one time, free)
Everything shows up on both phones instantly, with no links to send.

1. Go to https://console.firebase.google.com → **Add project** (turn off Analytics, it's not needed).
2. **Build → Realtime Database → Create database** → pick a location → *Start in locked mode*.
3. Open the **Rules** tab, paste this, and click Publish:
   ```json
   {
     "rules": {
       ".read": false,
       ".write": false,
       "rooms": {
         "$room": {
           ".read": "$room.length >= 20",
           ".write": "$room.length >= 20"
         }
       }
     }
   }
   ```
   Your data sits under a random 20-character code that only your two phones know, and nobody can list the codes.
4. **Project settings** (gear icon) → *Your apps* → **Web** (`</>`) → register it with any name → copy the `firebaseConfig` object.
5. Paste it into `js/config.js` in place of `firebase: null`. It must include `databaseURL`. Commit and push.
6. Open the app → pick who you are → **Create our space** → **Share pairing link** → send it to the other person. Done forever.

Anything you played before setting up sync gets uploaded automatically.

## Customize

- Names and app title are in `js/config.js`.
- Questions are in `js/content.js`.
- Colors are the CSS variables at the top of `style.css`.

Plain HTML/CSS/JS with no build step. To run it locally: `python3 -m http.server` and open http://localhost:8000.
