# CIIT PFT Scorecard System

A simple, no-installation web app for **PE teachers** to record, manage, and print
**Physical Fitness Test (PFT)** results for CIIT's **PED001 – PATHFIT 1** course.

## 🔗 Live site

**https://rizaldyrapsingciit.github.io/ciit-pft-scorecard/**

Share that link with anyone — it works from any device or network (no shared WiFi needed).

> **Please note two things about how it works:**
>
> 1. **Data is per-device.** Each person's scorecards are saved privately in *their own
>    browser* (localStorage). The link shares the *app*, not the data. To move records
>    between people or devices, use **Manage Data → Backup** to download a file and
>    **Restore** to load it elsewhere.
> 2. **The student list is loaded from a shared Google Sheet.** Because the site is
>    public, anyone with the link who clicks *Pull from Google Sheet* can load the names
>    on that sheet. Keep the sheet's sharing tight (or remove the sheet ID from
>    `js/config.js`) if that student info should stay private.

### Updating the live site

The site auto-rebuilds whenever you push to `main`:

```bash
git add -A
git commit -m "Describe your change"
git push
```

Changes usually appear within a minute.

It follows the official CIIT PFT Scorecard:

- **Part I — Health-Related Fitness Test (HRF):** Body Composition (BMI), Cardiovascular
  Endurance (Stair Climbing), Muscular Strength (Push-ups, Plank), Muscular Endurance
  (Wall Squat, Sit-ups), Flexibility (Zipper Test, Sit & Reach).
- **Part II — Skill-Related Fitness Test (SRF):** Coordination (Hand-Eye), Agility
  (T-Cone), Speed (Shuttle Run), Power (Vertical Jump), Balance (Stork Stand),
  Reaction Time (Ball Drop).

The app automatically computes **BMI + classification**, **averages**, **best scores**,
the **T-Cone agility rating**, and **Target Heart Rate zones** (from age & resting HR).

---

## For PE teachers — how to use it

1. **Open the app** (see "How to run" below) and **sign in** with your name and CIIT email.
2. **Dashboard** — instantly see totals, average BMI, and charts about your class.
3. **New / Edit Scorecard** — type a student's results. The computed fields fill in
   automatically. Click **Save**.
4. **Manage Data** — search, filter, edit, or delete records. Use **Backup** to save a
   file, and **Restore** to load it (great for moving data between computers).
5. **Reports** — pick a student for a printable scorecard, or view a **Class Summary**,
   then click **Print / Save PDF**.

> Your data is stored **privately in your browser on this computer**. Nothing is uploaded.
> Please make a **Backup** regularly from the *Manage Data* page.

---

## How to run

This is a plain website (HTML/CSS/JavaScript) — no installation or database needed.

### Easiest: open with a local server

Because browsers restrict some features on `file://`, run a tiny local server:

**Option A — Python (already on most computers):**

```bash
cd "CIIT PFT Scorecard"
python -m http.server 8000
```

Then open <http://localhost:8000> in your browser.

**Option B — VS Code:** install the *Live Server* extension, right-click `index.html`,
choose **Open with Live Server**.

### Put it online (optional)

Upload the whole folder to any static host (GitHub Pages, Netlify, Google Sites file
hosting, your school's web server). Everyone can then open it via a link.

---

## Pulling the student list from a Google Sheet

Instead of typing names, teachers can pick students from a **pulldown** that is
filled from a shared Google Sheet.

1. **Share the sheet for reading:** open it → **Share** → *General access* →
   **Anyone with the link** → **Viewer**. (A private sheet cannot be read by the app.)
2. Make sure the **first row is a header** with a **Name** column. Optional
   **Section**, **Sex**, and **Course** columns will auto-fill when a student is picked.
3. The sheet is configured in `js/config.js` under `studentSheet` (paste the share
   link or the spreadsheet ID; set `sheetName` to read a specific tab).
4. In **New / Edit Scorecard**, click **⟳ Pull from Google Sheet** once. The names
   load into the pulldown and are remembered on this computer until you pull again.

Each scorecard also records an **Academic Year** and **Term (1–3)**, shown before
the name. The Academic Year defaults to the current one automatically.

---

## Enabling official "Sign in with Google" (optional, for admins)

By default the app uses a simple name + email sign-in so teachers can start right away.
To require real CIIT Google accounts:

1. In **Google Cloud Console → APIs & Services → Credentials**, create an
   **OAuth Client ID → Web application**.
2. Add your site address (e.g. `http://localhost:8000` or your live URL) to
   **Authorized JavaScript origins**.
3. Open `js/config.js` and paste the Client ID into `googleClientId`.
4. Adjust `allowedEmailDomains` (default `ciit.edu.ph`) if needed.

Save the file and reload — an official Google Sign-In button appears.

---

## Project structure

```
CIIT PFT Scorecard/
├── index.html          Main page (login + app)
├── css/styles.css      Styling
├── js/config.js        School info + Google Sign-In settings (edit me)
├── js/scoring.js       BMI, Target Heart Rate, ratings logic
├── js/storage.js       Save/load/backup data in the browser
├── js/app.js           App screens and behavior
└── README.md           This file
```

---

## Notes on scoring

- **BMI:** `weight (kg) / height (m)²`; classified as Underweight / Normal /
  Overweight / Obese (WHO ranges).
- **Target Heart Rate:** Max HR = `220 − age`; zones use Heart Rate Reserve
  (`MHR − Resting HR`) at 50–70% (moderate) and up to 85% (vigorous).
- **T-Cone Agility:** auto-rated from time using the sex-specific standards in the
  PATHFIT lecture.
- Other activities include an **Evaluation** dropdown (Excellent → Needs Improvement)
  so the teacher can rate them based on the class normative charts.
