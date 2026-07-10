/* =============================================================
 * CIIT PFT Scorecard System — Cloud (Firebase Auth + Firestore)
 * -------------------------------------------------------------
 * Optional. When window.PFT_CONFIG.firebase.enabled is true and a valid
 * config is provided, this turns on:
 *   • real "Sign in with Google" (restricted to allowed email domains), and
 *   • a shared online database so every teacher sees the same classes and
 *     scorecards.
 *
 * When it is off (or Firebase fails to load), every function is a safe no-op
 * and the app keeps working with local, per-device storage.
 * ============================================================= */

window.Cloud = (function () {
  let enabled = false;
  let auth = null;
  let db = null;
  let dataCb = null;
  let unsub = [];
  let latestRecords = [];
  let latestClasses = [];

  function isEnabled() {
    return enabled;
  }

  function init(cfg) {
    if (!cfg || !cfg.enabled || !cfg.apiKey || !cfg.projectId) return false;
    if (typeof firebase === "undefined" || !firebase.initializeApp) {
      console.warn("[Cloud] Firebase SDK not loaded — staying in local mode.");
      return false;
    }
    try {
      firebase.initializeApp({
        apiKey: cfg.apiKey,
        authDomain: cfg.authDomain,
        projectId: cfg.projectId,
        appId: cfg.appId,
        storageBucket: cfg.storageBucket || undefined,
        messagingSenderId: cfg.messagingSenderId || undefined,
      });
      auth = firebase.auth();
      db = firebase.firestore();
      // Keep the user signed in across reloads.
      auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(() => {});
      enabled = true;
    } catch (e) {
      console.error("[Cloud] init failed:", e);
      enabled = false;
    }
    return enabled;
  }

  function onAuth(cb) {
    if (!enabled) return;
    auth.onAuthStateChanged(cb);
  }

  function signInWithGoogle(hostedDomain) {
    if (!enabled) return Promise.reject(new Error("Cloud disabled"));
    const provider = new firebase.auth.GoogleAuthProvider();
    if (hostedDomain) provider.setCustomParameters({ hd: hostedDomain });
    return auth.signInWithPopup(provider);
  }

  function signOut() {
    if (!enabled) return Promise.resolve();
    return auth.signOut();
  }

  // Remove undefined values (Firestore rejects them) and functions.
  function clean(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  function emit() {
    if (dataCb) dataCb({ records: latestRecords, classes: latestClasses });
  }

  // Begin live sync. `cb` is called with {records, classes} on every change.
  // `opts` = { role, email } — the security rules only allow admins to read
  // everything, so teachers/students must query a filtered subset that matches
  // what the rules permit (an unfiltered query would be rejected outright).
  function start(cb, opts) {
    if (!enabled) return;
    dataCb = cb;
    stop();
    const role = opts && opts.role;
    const email = opts && opts.email;

    let recQ = db.collection("records");
    let clsQ = db.collection("classes");
    if (role === "teacher") {
      recQ = recQ.where("teacherEmail", "==", email);
      clsQ = clsQ.where("teacherEmail", "==", email);
    } else if (role === "student") {
      recQ = recQ.where("email", "==", email);
      clsQ = null; // students don't read the classes collection
    }

    unsub.push(recQ.onSnapshot(
      (snap) => { latestRecords = snap.docs.map((d) => d.data()); emit(); },
      (err) => console.error("[Cloud] records sync error:", err)
    ));
    if (clsQ) {
      unsub.push(clsQ.onSnapshot(
        (snap) => { latestClasses = snap.docs.map((d) => d.data()); emit(); },
        (err) => console.error("[Cloud] classes sync error:", err)
      ));
    } else {
      latestClasses = [];
    }
  }

  function stop() {
    unsub.forEach((u) => { try { u(); } catch (e) {} });
    unsub = [];
  }

  function pushRecord(r) {
    if (!enabled || !r || !r.id) return;
    db.collection("records").doc(r.id).set(clean(r)).catch((e) => console.error("[Cloud] save record:", e));
  }
  function removeRecord(id) {
    if (!enabled || !id) return;
    db.collection("records").doc(id).delete().catch((e) => console.error("[Cloud] remove record:", e));
  }
  function pushClass(c) {
    if (!enabled || !c || !c.id) return;
    db.collection("classes").doc(c.id).set(clean(c)).catch((e) => console.error("[Cloud] save class:", e));
  }
  function removeClass(id) {
    if (!enabled || !id) return;
    db.collection("classes").doc(id).delete().catch((e) => console.error("[Cloud] remove class:", e));
  }

  return {
    isEnabled,
    init,
    onAuth,
    signInWithGoogle,
    signOut,
    start,
    stop,
    pushRecord,
    removeRecord,
    pushClass,
    removeClass,
  };
})();
