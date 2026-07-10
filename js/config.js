/* =============================================================
 * CIIT PFT Scorecard System — Configuration
 * -------------------------------------------------------------
 * PE teachers: you normally do NOT need to touch this file.
 * The person who sets up the system for you can edit the values
 * below to turn on official "Sign in with Google".
 * ============================================================= */

window.PFT_CONFIG = {
  // App identity (shown around the app / on printed reports)
  schoolName: "CIIT College of Innovation and Integrated Technology",
  courseName: "PED001 – PATHFIT 1",
  systemName: "Physical Fitness Test (PFT) Scorecard System",
  schoolYear: "1st Term S.Y. 2025 – 2026",

  // ---- Google Sign-In (optional) ----
  // To enable real "Sign in with your CIIT Google account":
  //   1. Ask your IT admin to create a Google OAuth Client ID
  //      (Google Cloud Console > Credentials > OAuth Client ID > Web).
  //   2. Add your website address to the "Authorized JavaScript origins".
  //   3. Paste the Client ID between the quotes below.
  // If you leave it blank, the app uses a simple local sign-in so you
  // can still use everything right away.
  googleClientId: "", // e.g. "1234567890-abcdefg.apps.googleusercontent.com"

  // Only allow accounts from these email domains to sign in with Google.
  // Leave the list empty to allow any Google account.
  allowedEmailDomains: ["ciit.edu.ph"],

  // ---- User roles ----
  // Three kinds of user (matched by their signed-in email, case-insensitive):
  //   • Admin   — can do everything.
  //   • Teacher — sees only the classes assigned to them and may edit the
  //               students' fitness readings (not their personal info).
  //   • Student — anyone else with an allowed email; sees and edits only
  //               their own scorecard readings.
  // List the admin and teacher emails below. Everyone else is a student.
  // NOTE: also mirror these lists in firestore.rules (admins/teachers) so the
  // database enforces the same rules.
  roles: {
    admins: [
      "kristine.dipalac@ciit.edu.ph",
      "jillan.macalintal@ciit.edu.ph",
      "rizaldy.rapsing@ciit.edu.ph",
    ],
    teachers: [
      "nicole.lictaoa@ciit.edu.ph",
      "noelle.dianzon@ciit.edu.ph",
      "julius.torrecarion@ciit.edu.ph",
      "ferdinand.tolentino@ciit.edu.ph",
    ],
  },

  // ---- Shared login + database (Firebase) ----
  // Turn this on to require real "Sign in with Google" (restricted to the
  // domains in allowedEmailDomains) AND make every teacher share the same
  // classes and scorecards from one online database.
  //
  // While enabled = false, the app works exactly as before (per-device data,
  // simple local sign-in). To turn it on, follow README → "Shared login &
  // database", paste the values from your Firebase project, and set enabled: true.
  firebase: {
    enabled: true,
    apiKey: "AIzaSyBHCTHfX0LO68vPrJBPvvncHW_B5wWVsnM",
    authDomain: "ciit-pft-scorecard.firebaseapp.com",        // e.g. "your-project.firebaseapp.com"
    projectId: "ciit-pft-scorecard",
    appId: "1:1072460773079:web:43f8e9bf6474b74e0ce292",
    storageBucket: "ciit-pft-scorecard.firebasestorage.app",     // optional
    messagingSenderId: "1072460773079", // optional
  },

  // ---- Master student list (Google Sheet) ----
  // The app can pull the list of students from a Google Sheet so teachers
  // pick names from a pulldown instead of typing them.
  //
  // IMPORTANT — make the sheet readable first:
  //   Open the sheet → Share → "Anyone with the link" → Viewer.
  //   (A private sheet cannot be read by the app and the pull will fail.)
  //
  // The sheet's first row should be a header. The app looks for columns
  // named like "Name" (required), and optionally "Section", "Sex" and
  // "Course" to auto-fill those fields when a student is chosen.
  studentSheet: {
    // Paste the normal share link OR just the spreadsheet ID.
    url: "https://docs.google.com/spreadsheets/d/1XOOdARe63ujD4RnuFGbuIs1qHeZrPBXvXRvu6ClzAr4/edit?usp=sharing",
    // Optional: the exact tab name to read (leave blank for the first tab).
    sheetName: "",
  },
};
