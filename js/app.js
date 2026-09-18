/* =============================================================
 * CIIT PFT Scorecard System — Main App
 * ============================================================= */
(function () {
  const CFG = window.PFT_CONFIG;
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const AUTH_KEY = "ciit_pft_auth_v1";
  let currentUser = null;
  let charts = {};
  let cloudEnabled = false;

  // Fixed choices (help teachers avoid typing mistakes)
  const COURSES = ["PATHFIT 1", "PATHFIT 2", "PATHFIT 3", "PATHFIT 4"];
  const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const TIMES = ["7:30–9:30 AM", "1:00–2:00 PM", "3:45–5:45 PM", "6:30–8:30 PM"];
  const WINGS = ["Left", "Right"];
  const TERMS = ["1", "2", "3"];

  /* ============================================================
   * Roles & access
   * ========================================================== */
  const lc = (s) => String(s || "").trim().toLowerCase();
  const ROLES = (CFG.roles || {});
  const ADMIN_EMAILS = (ROLES.admins || []).map(lc);

  // Effective PE-teacher list: the admin-managed shared list if it exists,
  // otherwise the defaults from config.js.
  function getTeachers() {
    const s = Store.getSettings();
    if (s && Array.isArray(s.teachers)) return s.teachers;
    return ROLES.teachers || [];
  }
  const teacherEmailsLc = () => getTeachers().map(lc);

  function roleOf(email) {
    const e = lc(email);
    if (ADMIN_EMAILS.includes(e)) return "admin";
    if (teacherEmailsLc().includes(e)) return "teacher";
    return "student";
  }

  // Admin-only "Preview as" lens. Purely client-side: it changes what the UI
  // shows so an admin can see a teacher's/student's view. It does NOT reduce
  // the admin's real database permissions.
  let preview = null; // { role, email, name } or null

  const actualRole = () => (currentUser && currentUser.role) || "student";
  const isRealAdmin = () => actualRole() === "admin";
  const myEmail = () => lc(preview ? preview.email : (currentUser && currentUser.email));
  const myRole = () => (preview ? preview.role : actualRole());
  const isAdmin = () => myRole() === "admin";
  const isTeacher = () => myRole() === "teacher";
  const isStudent = () => myRole() === "student";

  // Records this user is allowed to see.
  function visibleRecords() {
    const all = Store.all();
    if (isAdmin()) return all;
    if (isTeacher()) return all.filter((r) => lc(r.teacherEmail) === myEmail());
    return all.filter((r) => lc(r.email) === myEmail()); // student
  }
  // Classes this user is allowed to see.
  function visibleClasses() {
    const all = Store.classesAll();
    if (isAdmin()) return all;
    if (isTeacher()) return all.filter((c) => lc(c.teacherEmail) === myEmail());
    return [];
  }
  function canAccessRecord(r) {
    if (!r) return false;
    if (isAdmin()) return true;
    if (isTeacher()) return lc(r.teacherEmail) === myEmail();
    return lc(r.email) === myEmail();
  }
  function canAccessClass(cls) {
    if (!cls) return false;
    return isAdmin() || (isTeacher() && lc(cls.teacherEmail) === myEmail());
  }

  // CIIT runs on trimesters: Term 1 starts August, Term 2 December,
  // Term 3 April. The academic year therefore starts in August, so
  // Jan–Jul still counts as the previous year's AY.
  function currentAYStart() {
    const now = new Date();
    return now.getMonth() + 1 >= 8 ? now.getFullYear() : now.getFullYear() - 1;
  }
  // Academic years, most-recent first (next year included at the top).
  function academicYears() {
    const start = currentAYStart();
    const out = [];
    for (let y = start + 1; y >= start - 5; y--) out.push(`${y}-${y + 1}`);
    return out;
  }
  const currentAY = () => { const s = currentAYStart(); return `${s}-${s + 1}`; };
  // Trimester currently in progress: 1 = Aug–Nov, 2 = Dec–Mar, 3 = Apr–Jul.
  function currentTerm() {
    const m = new Date().getMonth() + 1;
    if (m >= 8 && m <= 11) return "1";
    if (m === 12 || m <= 3) return "2";
    return "3";
  }

  const optionList = (arr, selected) =>
    ['<option value="">— select —</option>']
      .concat(arr.map((o) => `<option value="${esc(o)}" ${o === selected ? "selected" : ""}>${esc(o)}</option>`))
      .join("");

  /* ============================================================
   * Small UI helpers
   * ========================================================== */
  function toast(msg, type = "") {
    const el = document.createElement("div");
    el.className = "toast " + (type || "");
    el.textContent = msg;
    $("#toastRoot").appendChild(el);
    setTimeout(() => el.remove(), 3200);
  }

  function modal({ title, body, actions, wide }) {
    const root = $("#modalRoot");
    const back = document.createElement("div");
    back.className = "modal-back";
    const actionsHTML = (actions || [])
      .map((a, i) => `<button class="btn ${a.class || "btn-ghost"}" data-i="${i}">${a.label}</button>`)
      .join("");
    back.innerHTML = `
      <div class="modal${wide ? " modal-wide" : ""}">
        <div class="modal-head">${title}</div>
        <div class="modal-body">${body}</div>
        <div class="modal-foot">${actionsHTML}</div>
      </div>`;
    root.appendChild(back);
    const close = () => back.remove();
    back.addEventListener("click", (e) => { if (e.target === back) close(); });
    $$(".modal-foot .btn", back).forEach((btn, i) => {
      btn.addEventListener("click", () => {
        const act = actions[i];
        if (!act.onClick || act.onClick(back) !== false) close();
      });
    });
    return { close, root: back };
  }

  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  function download(filename, text, mime = "text/plain") {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  const initials = (name) =>
    (name || "T").split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();

  /* ============================================================
   * Student roster — pull from the configured Google Sheet
   * ========================================================== */
  function sheetId() {
    const s = CFG.studentSheet || {};
    if (s.id) return s.id;
    const m = String(s.url || "").match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    return m ? m[1] : "";
  }

  function sheetCsvUrl() {
    const id = sheetId();
    if (!id) return "";
    let url = `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:csv`;
    const name = (CFG.studentSheet || {}).sheetName;
    if (name) url += `&sheet=${encodeURIComponent(name)}`;
    return url;
  }

  // Minimal RFC-4180 CSV parser (handles quotes, commas and newlines).
  function parseCSV(text) {
    const rows = [];
    let row = [], field = "", inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }
          else inQuotes = false;
        } else field += c;
      } else if (c === '"') inQuotes = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
      else if (c === "\r") { /* ignore */ }
      else field += c;
    }
    if (field.length || row.length) { row.push(field); rows.push(row); }
    return rows.filter((r) => r.some((v) => String(v).trim() !== ""));
  }

  // Turn CSV rows into roster entries {fullName, sectionCode, sex, course}.
  // Build a readable name from a CIIT email, e.g. "rysa.abadier@ciit.edu.ph"
  // becomes "Rysa Abadier".
  function nameFromEmail(email) {
    const local = String(email).split("@")[0] || "";
    return local
      .split(/[._-]+/)
      .filter(Boolean)
      .map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
      .join(" ");
  }

  function rowsToRoster(rows) {
    if (!rows.length) return [];
    const header = rows[0].map((h) => String(h).trim().toLowerCase());
    const has = (h, ...needles) => needles.some((n) => h.includes(n));
    const findCol = (pred) => header.findIndex(pred);

    // Explicit "Name" column (but not "Student Number", which contains no "name")
    const idxName = findCol((h) => has(h, "full name", "student name") || h === "name" || (has(h, "name") && !has(h, "user", "file", "number")));
    const idxEmail = findCol((h) => has(h, "email", "e-mail") || h === "mail");
    const idxNumber = findCol((h) => has(h, "student number", "student no", "student id") || ((has(h, "number", "no.", "id")) && has(h, "student")));
    const idxSection = findCol((h) => has(h, "section", "block"));
    const idxSex = findCol((h) => has(h, "sex", "gender"));
    const idxCourse = findCol((h) => has(h, "course", "pathfit", "subject"));
    const idxProgram = findCol((h) => has(h, "program", "degree", "course/program"));
    const idxBirthday = findCol((h) => has(h, "birthday", "birthdate", "birth date", "date of birth", "dob"));

    const looksLikeHeader = [idxName, idxEmail, idxNumber, idxSection, idxSex, idxCourse, idxProgram, idxBirthday].some((i) => i >= 0);
    const dataRows = looksLikeHeader ? rows.slice(1) : rows;
    const nameCol = idxName >= 0 ? idxName : (looksLikeHeader ? -1 : 0);

    const cell = (r, i) => (i >= 0 ? String(r[i] || "").trim() : "");
    const seen = new Set();
    const out = [];
    dataRows.forEach((r) => {
      const email = cell(r, idxEmail);
      let fullName = nameCol >= 0 ? cell(r, nameCol) : "";
      if (!fullName && email) fullName = nameFromEmail(email);
      if (!fullName) return;
      const key = (email || fullName).toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      out.push({
        fullName,
        email,
        studentNo: cell(r, idxNumber),
        program: cell(r, idxProgram),
        sectionCode: cell(r, idxSection),
        sex: normalizeSex(cell(r, idxSex)),
        course: cell(r, idxCourse),
        birthday: normalizeDate(cell(r, idxBirthday)),
      });
    });
    out.sort((a, b) => a.fullName.localeCompare(b.fullName));
    return out;
  }

  // Match the form's "Male"/"Female" options regardless of sheet casing.
  function normalizeSex(v) {
    const s = String(v || "").trim().toLowerCase();
    if (s.startsWith("m")) return "Male";
    if (s.startsWith("f")) return "Female";
    return v ? String(v).trim() : "";
  }

  // Coerce a date value to yyyy-mm-dd so <input type="date"> accepts it.
  function normalizeDate(v) {
    const s = String(v || "").trim();
    if (!s) return "";
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    const d = new Date(s);
    if (isNaN(d.getTime())) return "";
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  function sheetHelpModal() {
    modal({
      title: "Couldn't read the Google Sheet",
      body: `
        <p>The app couldn't load the student list. This almost always means the
        sheet isn't shared for reading yet.</p>
        <p><b>To fix it:</b></p>
        <ol style="margin:0 0 10px 18px;padding:0;line-height:1.6">
          <li>Open the sheet in Google Sheets.</li>
          <li>Click <b>Share</b> (top-right).</li>
          <li>Under <i>General access</i>, choose <b>Anyone with the link</b> → <b>Viewer</b>.</li>
          <li>Click <b>Done</b>, then try <b>Pull from Google Sheet</b> again.</li>
        </ol>
        <p class="muted" style="font-size:12px">The sheet's first row should have a
        <b>Name</b> or <b>Email</b> column (names can be read from CIIT emails).
        Optional <b>Student Number</b>, <b>Section</b>, <b>Sex</b> and <b>Course</b>
        columns are used to auto-fill the form when you pick a student.</p>`,
      actions: [
        { label: "Open the sheet", class: "btn-soft", onClick: () => { window.open((CFG.studentSheet || {}).url || sheetCsvUrl(), "_blank"); return false; } },
        { label: "OK", class: "btn-primary" },
      ],
    });
  }

  // Fetch + parse the sheet, save the roster. Returns the number of students.
  async function pullRoster() {
    const url = sheetCsvUrl();
    if (!url) throw new Error("No Google Sheet is configured in js/config.js.");
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const text = await res.text();
    if (/<html|<!doctype/i.test(text.slice(0, 200))) throw new Error("not-public");
    const students = rowsToRoster(parseCSV(text));
    if (!students.length) throw new Error("empty");
    Store.setRoster(students);
    return students.length;
  }

  /* ============================================================
   * Authentication
   * ========================================================== */
  function applyBranding() {
    $("#loginSchool").textContent = CFG.schoolName;
    $("#loginCourse").textContent = CFG.courseName;
    $("#loginYear").textContent = CFG.schoolYear;
    document.title = CFG.systemName;
  }

  function domainAllowed(email) {
    const list = CFG.allowedEmailDomains || [];
    if (!list.length) return true;
    const dom = String(email).split("@")[1] || "";
    return list.some((d) => dom.toLowerCase() === d.toLowerCase());
  }

  function decodeJWT(token) {
    try {
      const payload = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
      return JSON.parse(decodeURIComponent(escape(atob(payload))));
    } catch (e) { return null; }
  }

  function setUser(user) {
    currentUser = user;
    localStorage.setItem(AUTH_KEY, JSON.stringify(user));
  }

  function initGoogle() {
    const note = $("#localNote");
    if (!CFG.googleClientId) {
      note.textContent = "Tip: an admin can enable official Google Sign-In in js/config.js.";
      return;
    }
    const start = () => {
      if (!window.google || !google.accounts) return setTimeout(start, 300);
      google.accounts.id.initialize({
        client_id: CFG.googleClientId,
        callback: (resp) => {
          const info = decodeJWT(resp.credential);
          if (!info) return toast("Sign-in failed. Please try again.", "err");
          if (!domainAllowed(info.email)) {
            return toast("Please use your CIIT (" + (CFG.allowedEmailDomains[0] || "") + ") account.", "err");
          }
          setUser({ name: info.name, email: info.email, picture: info.picture, via: "google" });
          enterApp();
        },
      });
      google.accounts.id.renderButton($("#googleBtnHolder"), {
        theme: "outline", size: "large", width: 320, text: "signin_with",
      });
      $(".divider")?.classList.remove("hidden");
    };
    start();
  }

  // Real "Sign in with Google" + shared database (Firebase). Only used when
  // firebase.enabled is true in config and the SDK initialised successfully.
  function initCloudAuth() {
    const hd = (CFG.allowedEmailDomains && CFG.allowedEmailDomains[0]) || "";

    // Hide the simple name/email login — a real Google account is required.
    $("#localLogin")?.classList.add("hidden");
    $(".divider")?.classList.add("hidden");

    const holder = $("#googleBtnHolder");
    holder.innerHTML =
      `<button class="btn btn-primary btn-block" id="cloudGoogleBtn">Sign in with Google</button>
       <p class="login-note">Use your CIIT (${esc(hd || "ciit.edu.ph")}) Google account.</p>`;
    $("#cloudGoogleBtn").onclick = () => {
      Cloud.signInWithGoogle(hd).catch((e) => {
        if (e && e.code === "auth/popup-closed-by-user") return;
        toast("Sign-in failed. " + (e && e.message ? e.message : ""), "err");
      });
    };

    // Firebase remembers the session, so this fires on every load/sign-in.
    Cloud.onAuth((user) => {
      if (!user) {
        currentUser = null;
        Cloud.stop();
        $("#app").classList.add("hidden");
        $("#loginScreen").classList.remove("hidden");
        return;
      }
      if (!domainAllowed(user.email)) {
        toast("Please use your CIIT (" + (hd || "ciit.edu.ph") + ") account.", "err");
        Cloud.signOut();
        return;
      }
      currentUser = {
        name: user.displayName || nameFromEmail(user.email) || user.email,
        email: user.email,
        picture: user.photoURL || "",
        via: "google",
        role: "student",
      };
      // Load the shared teacher list FIRST so the role is decided correctly,
      // then start the (role-scoped) live sync and enter the app.
      Cloud.fetchSettings().then((settings) => {
        Store.applyRemote(undefined, undefined, settings);
        currentUser.role = roleOf(currentUser.email);
        Cloud.start(({ records, classes, settings }) => {
          Store.applyRemote(records, classes, settings);
          refresh();
        }, { role: currentUser.role, email: currentUser.email });
        enterApp();
      });
    });
  }

  function localSignIn() {
    const name = $("#teacherName").value.trim();
    const email = $("#teacherEmail").value.trim();
    if (!name) return toast("Please enter your name.", "err");
    if (!email || !/^\S+@\S+\.\S+$/.test(email)) return toast("Please enter a valid email.", "err");
    if (!domainAllowed(email)) {
      return toast("Please use your CIIT (" + (CFG.allowedEmailDomains[0] || "") + ") email.", "err");
    }
    setUser({ name, email, via: "local" });
    enterApp();
  }

  function logout() {
    localStorage.removeItem(AUTH_KEY);
    currentUser = null;
    preview = null;
    if (window.google && google.accounts) google.accounts.id.disableAutoSelect();
    if (cloudEnabled) {
      // onAuth handles showing the login screen once sign-out completes.
      Cloud.signOut();
      return;
    }
    $("#app").classList.add("hidden");
    $("#loginScreen").classList.remove("hidden");
  }

  const ROLE_LABEL = { admin: "Admin", teacher: "Teacher", student: "Student" };

  // Show/hide nav items and pick the right landing view for the role.
  function applyNavForRole() {
    const allowed = {
      admin: ["classes", "dashboard", "manage", "reports"],
      teacher: ["classes", "dashboard", "reports"],
      student: [],
    }[myRole()] || [];
    $$(".nav-item[data-view]").forEach((b) => {
      b.classList.toggle("hidden", !allowed.includes(b.dataset.view));
    });
  }

  function renderPreviewBanner() {
    const el = $("#previewBanner");
    if (!el) return;
    if (!preview) { el.classList.add("hidden"); el.innerHTML = ""; return; }
    el.classList.remove("hidden");
    const who = preview.role === "teacher" ? "Teacher" : "Student";
    el.innerHTML = `<span>👁 Previewing as <b>${who}</b> — ${esc(preview.name || preview.email)} <span class="muted">(your admin access is unchanged)</span></span>
      <button class="btn btn-sm btn-soft" id="exitPreview">Exit preview</button>`;
    $("#exitPreview").onclick = exitPreview;
  }

  function applyPreview(p) {
    if (!isRealAdmin()) return;
    preview = p;
    applyNavForRole();
    renderPreviewBanner();
    navigate(isStudent() ? "mine" : "classes");
  }
  function exitPreview() { applyPreview(null); }

  function openPreviewModal() {
    if (!isRealAdmin()) return;
    const teachers = getTeachers();
    // Students that actually have a record (so the preview shows something).
    const seen = new Set();
    const students = Store.all()
      .filter((r) => r.email && !ADMIN_EMAILS.includes(lc(r.email)) && !teacherEmailsLc().includes(lc(r.email)))
      .filter((r) => { const k = lc(r.email); if (seen.has(k)) return false; seen.add(k); return true; })
      .map((r) => ({ email: r.email, name: r.fullName || r.email }));

    const body = `
      <p class="muted" style="margin-top:0">See the app exactly as a teacher or student would. This only changes your view — it never changes your admin permissions.</p>
      <div class="field">
        <span>Preview as a Teacher</span>
        <select id="pvTeacher"><option value="">— choose a teacher —</option>
          ${teachers.map((t) => `<option value="${esc(t)}">${esc(t)}</option>`).join("")}</select>
      </div>
      <div class="field" style="margin-top:10px">
        <span>Preview as a Student</span>
        <select id="pvStudent"><option value="">${students.length ? "— choose a student —" : "— no student records yet —"}</option>
          ${students.map((s) => `<option value="${esc(s.email)}">${esc(s.name)} — ${esc(s.email)}</option>`).join("")}</select>
      </div>
      <p class="muted" style="margin-top:14px">No test data yet? Create a demo class with dummy students to try it out:</p>
      <button type="button" class="btn btn-soft btn-sm" id="pvDemo">🧪 Create demo class + dummy students</button>`;

    const m = modal({
      title: "Preview as…",
      body,
      wide: true,
      actions: [{ label: "Close", class: "btn-ghost" }],
    });
    const tSel = $("#pvTeacher", m.root);
    const sSel = $("#pvStudent", m.root);
    tSel.onchange = () => {
      if (!tSel.value) return;
      m.close();
      applyPreview({ role: "teacher", email: tSel.value, name: tSel.value });
    };
    sSel.onchange = () => {
      if (!sSel.value) return;
      const stu = students.find((s) => lc(s.email) === lc(sSel.value));
      m.close();
      applyPreview({ role: "student", email: sSel.value, name: stu ? stu.name : sSel.value });
    };
    $("#pvDemo", m.root).onclick = () => { m.close(); seedDemoData(); };
  }

  // Create a clearly-labelled demo class + two dummy students so an admin can
  // test the teacher/student views. Safe to delete afterwards (delete the class).
  function seedDemoData() {
    const teacher = getTeachers()[0] || myEmail();
    let cls = Store.classesAll().find((c) => c.sectionCode === "DEMO");
    if (!cls) {
      cls = Store.classSave({
        academicYear: currentAY(), term: currentTerm(),
        course: "PATHFIT 1", sectionCode: "DEMO", teacherEmail: teacher,
        scheduleDay: "Monday", scheduleTime: TIMES[0], gymWing: "Left",
      });
    }
    const dummies = [
      { fullName: "Demo Student A", email: "demo.studenta@ciit.edu.ph", studentNo: "DEMO-001", sex: "Female", birthday: "2006-05-12" },
      { fullName: "Demo Student B", email: "demo.studentb@ciit.edu.ph", studentNo: "DEMO-002", sex: "Male", birthday: "2005-11-03" },
    ];
    const existing = new Set(studentsOfClass(cls).map((r) => lc(r.email)));
    dummies.forEach((d) => {
      if (existing.has(lc(d.email))) return;
      const rec = Object.assign({
        classId: cls.id, teacherEmail: cls.teacherEmail,
        academicYear: cls.academicYear, term: cls.term,
        course: cls.course, sectionCode: cls.sectionCode,
        scheduleDay: cls.scheduleDay, scheduleTime: cls.scheduleTime, gymWing: cls.gymWing,
        // A few sample readings so progress isn't 0%.
        heightM: "1.60", weightKg: "52", rhr: "72", pushups: "18", plankTime: "01:00",
      }, d);
      computeDerived(rec);
      rec.recordedBy = currentUser.email;
      Store.save(rec);
    });
    toast("Demo class + dummy students created.", "ok");
    navigate("classes");
    openPreviewModal();
  }

  function enterApp() {
    // Roles may have changed in config since last session — always recompute.
    currentUser.role = roleOf(currentUser.email);
    $("#loginScreen").classList.add("hidden");
    $("#app").classList.remove("hidden");
    $("#userName").textContent = currentUser.name;
    $("#userEmail").textContent = currentUser.email;
    const av = $("#userAvatar");
    if (currentUser.picture) {
      av.style.backgroundImage = `url(${currentUser.picture})`;
      av.textContent = "";
    } else {
      av.textContent = initials(currentUser.name);
    }
    const badge = $("#storageBadge");
    if (badge) {
      const roleTxt = ROLE_LABEL[myRole()] || "Student";
      if (cloudEnabled) {
        badge.textContent = `● ${roleTxt} • Shared database`;
        badge.title = "Signed in with Google. Data is shared across CIIT accounts per your role.";
        badge.className = "storage-badge shared";
      } else {
        badge.textContent = `● ${roleTxt} • This device only`;
        badge.title = "Data is saved privately in this browser. Use Manage Data → Backup to move it.";
        badge.className = "storage-badge local";
      }
    }
    preview = null;
    const pvBtn = $("#previewBtn");
    if (pvBtn) {
      pvBtn.classList.toggle("hidden", !isRealAdmin());
      pvBtn.onclick = openPreviewModal;
    }
    renderPreviewBanner();
    applyNavForRole();
    navigate(isStudent() ? "mine" : "classes");
  }

  /* ============================================================
   * Scorecard field definitions
   * ========================================================== */
  const HRF = [
    {
      key: "bodyComp", title: "A. Body Composition — Body Mass Index (BMI)",
      fields: [
        { k: "heightM", label: "Height (meters)", type: "number", step: "0.01", ph: "e.g. 1.65" },
        { k: "weightKg", label: "Weight (kilograms)", type: "number", step: "0.1", ph: "e.g. 55" },
        { k: "bmi", label: "BMI", auto: true },
        { k: "bmiClass", label: "Classification", auto: true },
      ],
    },
    {
      key: "cardio", title: "B. Cardiovascular Endurance — Stair Climbing",
      fields: [
        { k: "rhr", label: "Resting HR — before (bpm)", type: "number", ph: "e.g. 78" },
        { k: "mhrAfter", label: "Heart Rate — after (bpm)", type: "number", ph: "e.g. 150" },
        { k: "cardioRating", label: "Evaluation", rating: true },
      ],
    },
    {
      key: "strength", title: "C. Muscular Strength",
      fields: [
        { k: "pushups", label: "90° Push-Ups (count)", type: "number", ph: "e.g. 20" },
        { k: "plankTime", label: "Basic Plank (mm:ss)", type: "text", ph: "e.g. 01:30" },
        { k: "strengthRating", label: "Evaluation", rating: true },
      ],
    },
    {
      key: "endurance", title: "D. Muscular Endurance",
      fields: [
        { k: "wallSquatLeft", label: "Wall Squat — Left leg (mm:ss)", type: "text", ph: "e.g. 00:42" },
        { k: "wallSquatLeftRating", label: "Wall Squat (Left) — Evaluation", rating: true },
        { k: "wallSquatRight", label: "Wall Squat — Right leg (mm:ss)", type: "text", ph: "e.g. 00:45" },
        { k: "wallSquatRightRating", label: "Wall Squat (Right) — Evaluation", rating: true },
        { k: "situps", label: "Sit-Up Test (count)", type: "number", ph: "e.g. 25" },
        { k: "situpsRating", label: "Sit-Up Test — Evaluation", rating: true },
      ],
    },
    {
      key: "flex", title: "E. Flexibility",
      fields: [
        { k: "zipperLeft", label: "Zipper Test — Left arm (cm)", type: "number", step: "0.1" },
        { k: "zipperLeftRating", label: "Zipper (Left) — Evaluation", rating: true },
        { k: "zipperRight", label: "Zipper Test — Right arm (cm)", type: "number", step: "0.1" },
        { k: "zipperRightRating", label: "Zipper (Right) — Evaluation", rating: true },
        { k: "sitReach1", label: "Sit & Reach — 1st try (cm)", type: "number", step: "0.1" },
        { k: "sitReach2", label: "Sit & Reach — 2nd try (cm)", type: "number", step: "0.1" },
        { k: "sitReach3", label: "Sit & Reach — 3rd try (cm)", type: "number", step: "0.1" },
        { k: "sitReachAvg", label: "Sit & Reach — Average (cm)", auto: true },
        { k: "sitReachAvgRating", label: "Sit & Reach (Average) — Evaluation", rating: true },
      ],
    },
  ];

  const SRF = [
    {
      key: "coord", title: "A. Coordination — Hand-Eye Coordination",
      fields: [
        { k: "handEye", label: "Score (number of catches)", type: "number", ph: "e.g. 8" },
        { k: "coordRating", label: "Evaluation", rating: true },
      ],
    },
    {
      key: "agility", title: "B. Agility — T-Cone Test",
      fields: [
        { k: "tCone", label: "Fastest time (seconds)", type: "number", step: "0.01", ph: "e.g. 10.2" },
        { k: "tConeRating", label: "Evaluation (auto)", auto: true },
      ],
    },
    {
      key: "speed", title: "C. Speed — Shuttle Run",
      fields: [
        { k: "shuttleRun", label: "Time (mm:ss or seconds)", type: "text", ph: "e.g. 11.5" },
        { k: "speedRating", label: "Evaluation", rating: true },
      ],
    },
    {
      key: "power", title: "D. Power — Vertical Jump Test",
      fields: [
        { k: "vJump1", label: "1st jump (cm)", type: "number", step: "0.1" },
        { k: "vJump2", label: "2nd jump (cm)", type: "number", step: "0.1" },
        { k: "vJump3", label: "3rd jump (cm)", type: "number", step: "0.1" },
        { k: "vJumpBest", label: "Best score (cm)", auto: true },
        { k: "powerRating", label: "Evaluation", rating: true },
      ],
    },
    {
      key: "balance", title: "E. Balance — Stork Balance Stand",
      fields: [
        { k: "storkLeft", label: "Left foot time (mm:ss)", type: "text", ph: "e.g. 00:18" },
        { k: "storkLeftRating", label: "Balance (Left foot) — Evaluation", rating: true },
        { k: "storkRight", label: "Right foot time (mm:ss)", type: "text", ph: "e.g. 00:20" },
        { k: "storkRightRating", label: "Balance (Right foot) — Evaluation", rating: true },
      ],
    },
    {
      key: "reaction", title: "F. Reaction Time — Ball Drop Test",
      fields: [
        { k: "ballDrop1", label: "1st trial (cm)", type: "number", step: "0.1" },
        { k: "ballDrop2", label: "2nd trial (cm)", type: "number", step: "0.1" },
        { k: "ballDrop3", label: "3rd trial (cm)", type: "number", step: "0.1" },
        { k: "ballDropAvg", label: "Average (cm)", auto: true },
        { k: "reactionRating", label: "Evaluation", rating: true },
      ],
    },
  ];

  // Look up a class's saved schedule (Day / Time / Gym Wing) from an existing
  // scorecard of the same class. A class is identified by AY + Term + Course +
  // Section. Store.all() is newest-first, so this returns the latest one used.
  function classDefaults(ay, term, course, section) {
    if (!course || !section) return null;
    const match = Store.all().find((r) =>
      r.academicYear === ay &&
      String(r.term || "") === String(term || "") &&
      r.course === course &&
      r.sectionCode === section &&
      (r.scheduleDay || r.scheduleTime || r.gymWing));
    if (!match) return null;
    return {
      scheduleDay: match.scheduleDay || "",
      scheduleTime: match.scheduleTime || "",
      gymWing: match.gymWing || "",
    };
  }

  // Compute all derived/auto values from a record.
  function computeDerived(r) {
    const computedAge = Scoring.ageFromBirthday(r.birthday);
    if (computedAge != null) r.age = computedAge;
    r.bmi = Scoring.bmi(r.weightKg, r.heightM);
    r.bmiClass = Scoring.bmiClassification(r.bmi);
    r.sitReachAvg = Scoring.average([r.sitReach1, r.sitReach2, r.sitReach3]);
    r.vJumpBest = Scoring.best([r.vJump1, r.vJump2, r.vJump3], "max");
    r.ballDropAvg = Scoring.average([r.ballDrop1, r.ballDrop2, r.ballDrop3]);
    r.tConeRating = Scoring.tConeRating(r.tCone, r.sex);
    // Suggested 5-star evaluations from general fitness norms — only fill the
    // ones the teacher has left blank (manual ratings are always respected).
    const auto = Scoring.autoRatings(r);
    Object.keys(auto).forEach((k) => {
      if (r[k] === "" || r[k] == null) r[k] = auto[k];
    });
    return r;
  }

  // Rating field keys (used to auto-fill star widgets on the entry form).
  const RATING_KEYS = [].concat(HRF, SRF)
    .reduce((acc, sec) => acc.concat(sec.fields.filter((f) => f.rating).map((f) => f.k)), []);

  /* ============================================================
   * Router
   * ========================================================== */
  const TITLES = {
    classes: ["Classes", "Your classes — open one to manage its students"],
    class: ["Class", "Students in this class"],
    dashboard: ["Dashboard", "Overview of your class fitness results"],
    entry: ["Scorecard", "Add or edit a student's PFT results"],
    manage: ["Manage Data", "Search, edit, back up and export records"],
    reports: ["Reports", "Printable scorecards and class summaries"],
    mine: ["My Scorecard", "View and update your own fitness readings"],
  };

  // Views each role is allowed to open directly.
  function canView(view) {
    const perRole = {
      admin: ["classes", "class", "dashboard", "entry", "manage", "reports", "mine"],
      teacher: ["classes", "class", "dashboard", "entry", "reports", "mine"],
      student: ["mine", "entry", "reports"],
    };
    return (perRole[myRole()] || []).includes(view);
  }

  let currentView = "classes";
  let currentArg = null;

  // Re-render the current view (used when shared cloud data changes). We never
  // refresh the entry form, so a teacher's unsaved typing is never wiped out.
  function refresh() {
    if (currentView === "entry") return;
    navigate(currentView, currentArg);
  }

  function navigate(view, arg) {
    // Keep users out of views their role can't use.
    if (!canView(view)) view = isStudent() ? "mine" : "classes";
    currentView = view;
    currentArg = arg;
    const navKey = { class: "classes", entry: "classes", mine: "" }[view] ?? view;
    $$(".nav-item[data-view]").forEach((b) =>
      b.classList.toggle("active", b.dataset.view === navKey));
    $("#pageTitle").textContent = TITLES[view][0];
    $("#pageSub").textContent = TITLES[view][1];
    const c = $("#content");
    Object.values(charts).forEach((ch) => ch && ch.destroy());
    charts = {};
    if (view === "classes") renderClasses(c);
    else if (view === "class") renderClassDetail(c, arg);
    else if (view === "dashboard") renderDashboard(c);
    else if (view === "entry") renderEntry(c, arg);
    else if (view === "manage") renderManage(c);
    else if (view === "reports") renderReports(c, arg);
    else if (view === "mine") renderStudentHome(c);
  }

  /* ============================================================
   * Classes (class-first workflow)
   * ========================================================== */
  function classLabel(cls) {
    return `${cls.course || "PATHFIT"} – ${cls.sectionCode || "?"}`;
  }

  function classSchedule(cls) {
    return [
      [cls.scheduleDay, cls.scheduleTime].filter(Boolean).join(" "),
      cls.gymWing ? cls.gymWing + " wing" : "",
    ].filter(Boolean).join(" • ");
  }

  // Students belonging to a class: linked by classId, or (for older records)
  // matched on Academic Year + Term + Course + Section.
  function studentsOfClass(cls) {
    return Store.all().filter((r) =>
      r.classId === cls.id ||
      (!r.classId &&
        r.academicYear === cls.academicYear &&
        String(r.term || "") === String(cls.term || "") &&
        r.course === cls.course &&
        r.sectionCode === cls.sectionCode));
  }

  function recordProgress(r) {
    const keys = [...HRF, ...SRF].flatMap((s) => s.fields.filter((f) => !f.auto && !f.rating).map((f) => f.k));
    let filled = 0;
    keys.forEach((k) => { if (r[k] !== "" && r[k] != null) filled++; });
    return keys.length ? Math.round((filled / keys.length) * 100) : 0;
  }

  function renderClasses(c) {
    const classes = visibleClasses();
    const admin = isAdmin();
    if (!classes.length) {
      c.innerHTML = emptyState(
        admin ? "No classes yet" : "No classes assigned to you yet",
        admin ? "Create a class first, then add students into it."
              : "An admin will assign your classes. Check back soon.",
        admin ? `<button class="btn btn-soft" id="mngTeachers">👥 Teachers</button>
          <button class="btn btn-primary" id="newClass">＋ New class</button>` : ""
      );
      const nc = $("#newClass");
      if (nc) nc.onclick = () => openClassModal();
      const mt = $("#mngTeachers");
      if (mt) mt.onclick = openTeachersModal;
      return;
    }
    c.innerHTML = `
      <div class="toolbar no-print">
        <div class="left"><h3 style="margin:0">Your classes</h3></div>
        <div class="right">${admin ? `<button class="btn btn-soft btn-sm" id="mngTeachers">👥 Teachers</button>
          <button class="btn btn-primary btn-sm" id="newClass">＋ New class</button>` : ""}</div>
      </div>
      <div class="grid class-grid">
        ${classes.map((cls) => {
          const n = studentsOfClass(cls).length;
          return `<div class="card class-card">
            <button type="button" class="cc-open" data-open="${cls.id}">
              <div class="cc-top">
                <span class="cc-title">${esc(classLabel(cls))}</span>
                <span class="badge brandbadge">${n} student${n === 1 ? "" : "s"}</span>
              </div>
              <div class="cc-meta">${esc(cls.academicYear || "")} • Term ${esc(cls.term || "")}</div>
              <div class="cc-meta muted">${esc(classSchedule(cls) || "No schedule set")}</div>
            </button>
            <div class="cc-actions">
              ${admin ? `<button class="btn btn-soft btn-sm" data-edit="${cls.id}">Edit</button>
              <button class="btn btn-ghost btn-sm" data-del="${cls.id}">Delete</button>` : ""}
              <button class="btn btn-primary btn-sm" data-open="${cls.id}">Open →</button>
            </div>
          </div>`;
        }).join("")}
      </div>`;
    const nc = $("#newClass");
    if (nc) nc.onclick = () => openClassModal();
    const mt = $("#mngTeachers");
    if (mt) mt.onclick = openTeachersModal;
    $$("[data-open]", c).forEach((b) => b.onclick = () => navigate("class", b.dataset.open));
    $$("[data-edit]", c).forEach((b) => b.onclick = () => openClassModal(Store.classGet(b.dataset.edit)));
    $$("[data-del]", c).forEach((b) => b.onclick = () => confirmDeleteClass(Store.classGet(b.dataset.del)));
  }

  // Admin-only: manage which CIIT emails are PE teachers (shared with everyone).
  function openTeachersModal() {
    if (!isRealAdmin()) { toast("Only admins can manage teachers.", "err"); return; }
    const domain = (CFG.allowedEmailDomains && CFG.allowedEmailDomains[0]) || "ciit.edu.ph";
    const render = (m) => {
      const list = getTeachers();
      const listHTML = list.length
        ? list.map((t) => `<label class="add-row">
            <span class="ar-name">${esc(t)}</span>
            <button type="button" class="btn btn-ghost btn-sm" data-remove="${esc(t)}">✕ Remove</button>
          </label>`).join("")
        : `<p class="muted" style="margin:6px 0">No teachers yet — add one below.</p>`;
      $("#tmBody", m.root).innerHTML = `
        <div class="add-list">${listHTML}</div>
        <div class="name-picker" style="margin-top:12px">
          <input id="tmNew" type="email" placeholder="teacher@${esc(domain)}" />
          <button type="button" class="btn btn-primary btn-sm" id="tmAdd">＋ Add teacher</button>
        </div>
        <p class="muted" style="margin:10px 0 0">A newly added teacher must sign out and back in for their teacher access to take effect.</p>`;
      $("#tmAdd", m.root).onclick = () => {
        const email = lc($("#tmNew", m.root).value);
        if (!email || !/^\S+@\S+\.\S+$/.test(email)) { toast("Enter a valid email.", "err"); return; }
        if (CFG.allowedEmailDomains && CFG.allowedEmailDomains.length &&
            !CFG.allowedEmailDomains.some((d) => email.endsWith("@" + lc(d)))) {
          toast(`Teacher email must be @${domain}.`, "err"); return;
        }
        const cur = getTeachers().map(lc);
        if (cur.includes(email)) { toast("That teacher is already listed.", "err"); return; }
        Store.setSettings({ teachers: getTeachers().concat(email) });
        toast("Teacher added.", "ok");
        render(m);
      };
      $$("[data-remove]", m.root).forEach((b) => b.onclick = () => {
        const email = b.dataset.remove;
        Store.setSettings({ teachers: getTeachers().filter((t) => lc(t) !== lc(email)) });
        toast("Teacher removed.", "ok");
        render(m);
      });
    };
    const m = modal({
      title: "PE Teachers",
      body: `<p class="muted" style="margin-top:0">These CIIT accounts can be assigned to classes and will get teacher access. Shared with all admins.</p><div id="tmBody"></div>`,
      wide: true,
      actions: [{ label: "Done", class: "btn-primary" }],
    });
    render(m);
  }

  function confirmDeleteClass(cls) {
    if (!cls) return;
    if (!isAdmin()) { toast("Only admins can delete classes.", "err"); return; }
    const kids = studentsOfClass(cls);
    modal({
      title: "Delete class?",
      body: `This will delete <b>${esc(classLabel(cls))}</b>${kids.length ? ` and its <b>${kids.length}</b> student scorecard${kids.length === 1 ? "" : "s"}` : ""}. This cannot be undone.`,
      actions: [
        { label: "Cancel", class: "btn-ghost" },
        { label: "Delete", class: "btn-danger", onClick: () => {
          kids.forEach((r) => Store.remove(r.id));
          Store.classRemove(cls.id);
          toast("Class deleted.", "ok");
          navigate("classes");
        } },
      ],
    });
  }

  const teacherOptionsHTML = (sel) =>
    ['<option value="">— assign a teacher —</option>']
      .concat(getTeachers().map((t) =>
        `<option value="${esc(t)}" ${lc(t) === lc(sel) ? "selected" : ""}>${esc(t)}</option>`))
      .join("");

  function openClassModal(cls) {
    if (!isAdmin()) { toast("Only admins can create or edit classes.", "err"); return; }
    const editing = cls || null;
    const ay = editing ? editing.academicYear : currentAY();
    const term = editing ? editing.term : currentTerm();
    const body = `
      <div class="field-grid modal-grid">
        <label class="field"><span>Academic Year</span><select id="cfAY">${ayOptionsHTML(ay)}</select></label>
        <label class="field"><span>Term</span><select id="cfTerm">${termOptionsHTML(term)}</select></label>
        <label class="field"><span>PE Course</span><select id="cfCourse">${optionList(COURSES, editing && editing.course)}</select></label>
        <label class="field"><span>Section Code</span><input id="cfSection" value="${esc(editing ? editing.sectionCode : "")}" placeholder="e.g. 101" /></label>
        <label class="field"><span>Assigned Teacher</span><select id="cfTeacher">${teacherOptionsHTML(editing && editing.teacherEmail)}</select></label>
        <label class="field"><span>PE Schedule — Day</span><select id="cfDay">${optionList(DAYS, editing && editing.scheduleDay)}</select></label>
        <label class="field"><span>PE Schedule — Time</span><select id="cfTime">${optionList(TIMES, editing && editing.scheduleTime)}</select></label>
        <label class="field"><span>Gym Wing (7th Floor)</span><select id="cfWing">${optionList(WINGS, editing && editing.gymWing)}</select></label>
      </div>`;
    modal({
      title: editing ? "Edit class" : "New class",
      body,
      wide: true,
      actions: [
        { label: "Cancel", class: "btn-ghost" },
        { label: editing ? "Save class" : "Create class", class: "btn-primary", onClick: (back) => {
          const cCourse = $("#cfCourse", back).value;
          const cSection = $("#cfSection", back).value.trim();
          const cTeacher = $("#cfTeacher", back).value;
          if (!cCourse) { toast("Please choose the PE course.", "err"); return false; }
          if (!cSection) { toast("Please enter the section code.", "err"); return false; }
          if (!cTeacher) { toast("Please assign a teacher to this class.", "err"); return false; }
          const rec = {
            id: editing ? editing.id : undefined,
            academicYear: $("#cfAY", back).value,
            term: $("#cfTerm", back).value,
            course: cCourse,
            sectionCode: cSection,
            teacherEmail: cTeacher,
            scheduleDay: $("#cfDay", back).value,
            scheduleTime: $("#cfTime", back).value,
            gymWing: $("#cfWing", back).value,
          };
          const saved = Store.classSave(rec);
          // Keep this class's student scorecards in sync with the class fields
          studentsOfClass(saved).forEach((r) => {
            r.classId = saved.id;
            r.academicYear = saved.academicYear; r.term = saved.term;
            r.course = saved.course; r.sectionCode = saved.sectionCode;
            r.teacherEmail = saved.teacherEmail;
            r.scheduleDay = saved.scheduleDay; r.scheduleTime = saved.scheduleTime; r.gymWing = saved.gymWing;
            computeDerived(r);
            Store.save(r);
          });
          toast(editing ? "Class updated." : "Class created.", "ok");
          navigate("class", saved.id);
        } },
      ],
    });
  }

  function renderClassDetail(c, classId) {
    const cls = Store.classGet(classId);
    if (!cls) return navigate("classes");
    if (!canAccessClass(cls)) { toast("You don't have access to that class.", "err"); return navigate("classes"); }
    const admin = isAdmin();
    $("#pageTitle").textContent = classLabel(cls);
    $("#pageSub").textContent = `${cls.academicYear || ""} • Term ${cls.term || ""}`;
    const students = studentsOfClass(cls);

    c.innerHTML = `
      <div class="toolbar no-print">
        <div class="left"><button class="btn btn-ghost btn-sm" id="backClasses">← All classes</button></div>
        <div class="right">
          ${admin ? `<button class="btn btn-soft btn-sm" id="editClass">✎ Edit class</button>
          <button class="btn btn-ghost btn-sm" id="delClass">Delete class</button>
          <button class="btn btn-primary btn-sm" id="addStudent">＋ Add student</button>` : ""}
        </div>
      </div>
      <div class="card class-banner">
        <div class="cb-title"><span class="pill">Class</span> <strong>${esc(classLabel(cls))}</strong></div>
        <div class="cb-meta">${esc(cls.academicYear || "")} • Term ${esc(cls.term || "")} • ${esc(classSchedule(cls) || "No schedule set")}</div>
        ${cls.teacherEmail ? `<div class="cb-meta muted">Teacher: ${esc(cls.teacherEmail)}</div>` : ""}
      </div>
      <div id="classStudents"></div>`;
    $("#backClasses").onclick = () => navigate("classes");
    if (admin) {
      $("#editClass").onclick = () => openClassModal(cls);
      $("#delClass").onclick = () => confirmDeleteClass(cls);
      $("#addStudent").onclick = () => openAddStudentModal(cls);
    }

    const host = $("#classStudents");
    if (!students.length) {
      host.innerHTML = emptyState(
        "No students yet",
        admin ? "Click “Add student” to pick students from your Google Sheet list."
              : "No students have been added to this class yet.",
        admin ? `<button class="btn btn-primary" id="addStudent2">＋ Add student</button>` : ""
      );
      const a2 = $("#addStudent2");
      if (a2) a2.onclick = () => openAddStudentModal(cls);
      return;
    }
    host.innerHTML = `
      <div class="table-wrap"><table class="data">
        <thead><tr><th>Name</th><th>Student No.</th><th>Sex</th><th>Age</th><th>BMI</th><th>Status</th><th>Progress</th><th></th></tr></thead>
        <tbody>
          ${students.map((r) => {
            const p = recordProgress(r);
            return `<tr>
              <td><strong>${esc(r.fullName || "Unnamed")}</strong></td>
              <td>${esc(r.studentNo || "—")}</td>
              <td>${esc(r.sex || "—")}</td>
              <td>${esc(r.age || "—")}</td>
              <td>${r.bmi != null ? r.bmi : "—"}</td>
              <td>${bmiBadge(r.bmiClass)}</td>
              <td><div class="prog"><span style="width:${p}%"></span></div><small class="muted">${p}%</small></td>
              <td class="actions">
                <button class="btn btn-soft btn-sm" data-edit="${r.id}">${admin ? "Edit" : "Edit readings"}</button>
                <button class="btn btn-ghost btn-sm" data-report="${r.id}">Report</button>
                ${admin ? `<button class="btn btn-ghost btn-sm" data-remove="${r.id}">Remove</button>` : ""}
              </td>
            </tr>`;
          }).join("")}
        </tbody>
      </table></div>
      <p class="muted" style="margin-top:10px">${students.length} student${students.length === 1 ? "" : "s"} in this class</p>`;
    $$("[data-edit]", host).forEach((b) => b.onclick = () => navigate("entry", b.dataset.edit));
    $$("[data-report]", host).forEach((b) => b.onclick = () => navigate("reports", b.dataset.report));
    $$("[data-remove]", host).forEach((b) => b.onclick = () => removeStudentFromClass(Store.get(b.dataset.remove), cls));
  }

  function removeStudentFromClass(rec, cls) {
    if (!rec) return;
    if (!isAdmin()) { toast("Only admins can remove students.", "err"); return; }
    const doRemove = () => {
      Store.remove(rec.id);
      toast("Student removed from class.", "ok");
      navigate("class", cls.id);
    };
    if (recordProgress(rec) === 0) return doRemove(); // empty shell — remove instantly
    modal({
      title: "Remove student?",
      body: `<b>${esc(rec.fullName || "This student")}</b> already has test results recorded. Removing deletes this scorecard. The student stays in your Google Sheet list.`,
      actions: [
        { label: "Cancel", class: "btn-ghost" },
        { label: "Remove", class: "btn-danger", onClick: doRemove },
      ],
    });
  }

  function openAddStudentModal(cls) {
    if (!isAdmin()) { toast("Only admins can add students.", "err"); return; }
    const roster = Store.getRoster().students;
    const existing = new Set(studentsOfClass(cls).map((r) => (r.email || r.fullName || "").toLowerCase()));
    const available = roster.filter((s) => !existing.has((s.email || s.fullName || "").toLowerCase()));

    let body, actions;
    if (!roster.length) {
      body = `<p>No student list loaded yet. Pull it from your Google Sheet, then add students.</p>`;
      actions = [
        { label: "Close", class: "btn-ghost" },
        { label: "⟳ Pull from Google Sheet", class: "btn-primary", onClick: async () => {
          try { const n = await pullRoster(); toast(`Loaded ${n} student${n === 1 ? "" : "s"}.`, "ok"); openAddStudentModal(cls); }
          catch (e) { sheetHelpModal(); }
          return true;
        } },
      ];
    } else if (!available.length) {
      body = `<p>All students from the sheet are already in this class. 🎉</p>`;
      actions = [{ label: "Close", class: "btn-primary" }];
    } else {
      body = `
        <div class="search" style="margin-bottom:10px">🔎 <input id="asSearch" placeholder="Search students..." /></div>
        <div class="add-list" id="asList">
          ${available.map((s, i) => `<label class="add-row">
            <input type="checkbox" value="${i}" />
            <span class="ar-name">${esc(s.fullName)}</span>
            <span class="ar-sub muted">${esc(s.studentNo || s.email || "")}</span>
          </label>`).join("")}
        </div>
        <p class="muted" id="asCount" style="margin:8px 0 0">0 selected</p>`;
      actions = [
        { label: "Cancel", class: "btn-ghost" },
        { label: "Add selected", class: "btn-primary", onClick: (back) => {
          const idxs = $$("#asList input:checked", back).map((el) => parseInt(el.value, 10));
          if (!idxs.length) { toast("Pick at least one student.", "err"); return false; }
          idxs.forEach((i) => {
            const s = available[i];
            const rec = {
              classId: cls.id,
              teacherEmail: cls.teacherEmail || "",
              academicYear: cls.academicYear, term: cls.term,
              course: cls.course, sectionCode: cls.sectionCode,
              scheduleDay: cls.scheduleDay, scheduleTime: cls.scheduleTime, gymWing: cls.gymWing,
              fullName: s.fullName, studentNo: s.studentNo || "", email: s.email || "",
              sex: s.sex || "", birthday: s.birthday || "",
            };
            computeDerived(rec);
            rec.recordedBy = currentUser.email;
            Store.save(rec);
          });
          toast(`Added ${idxs.length} student${idxs.length === 1 ? "" : "s"}.`, "ok");
          navigate("class", cls.id);
        } },
      ];
    }

    const m = modal({ title: `Add students — ${classLabel(cls)}`, body, actions, wide: true });
    const search = $("#asSearch", m.root);
    if (search) {
      search.addEventListener("input", () => {
        const q = search.value.toLowerCase().trim();
        $$(".add-row", m.root).forEach((row) => {
          const t = row.textContent.toLowerCase();
          row.style.display = (!q || t.includes(q)) ? "" : "none";
        });
      });
    }
    const list = $("#asList", m.root);
    if (list) {
      list.addEventListener("change", () => {
        const n = $$("#asList input:checked", m.root).length;
        const cnt = $("#asCount", m.root);
        if (cnt) cnt.textContent = `${n} selected`;
      });
    }
  }

  /* ============================================================
   * Student home (their own scorecards only)
   * ========================================================== */
  function renderStudentHome(c) {
    const mine = visibleRecords().slice().sort(periodOrder);
    if (!mine.length) {
      c.innerHTML = emptyState(
        "No scorecard yet",
        "Your teacher hasn't added you to a class yet. Once they do, your scorecard will appear here.",
        ""
      );
      return;
    }
    c.innerHTML = `
      <div class="toolbar no-print">
        <div class="left"><h3 style="margin:0">My scorecards</h3></div>
        <div class="right">${mine.length > 1 ? `<button class="btn btn-soft btn-sm" id="myProgress">📈 My progress</button>` : ""}</div>
      </div>
      <div class="grid class-grid">
        ${mine.map((r) => {
          const p = recordProgress(r);
          return `<div class="card class-card">
            <button type="button" class="cc-open" data-open="${r.id}">
              <div class="cc-top">
                <span class="cc-title">${esc(classLabel({ course: r.course, sectionCode: r.sectionCode }))}</span>
                <span class="badge brandbadge">${r.bmi != null ? "BMI " + r.bmi : "—"}</span>
              </div>
              <div class="cc-meta">${esc(r.academicYear || "")} • Term ${esc(r.term || "")}</div>
              <div class="cc-meta muted">${esc(classSchedule(r) || "No schedule set")}</div>
              <div class="prog" style="margin-top:8px"><span style="width:${p}%"></span></div>
              <small class="muted">${p}% complete</small>
            </button>
            <div class="cc-actions">
              <button class="btn btn-ghost btn-sm" data-report="${r.id}">Report</button>
              <button class="btn btn-primary btn-sm" data-open="${r.id}">Update readings →</button>
            </div>
          </div>`;
        }).join("")}
      </div>`;
    const mp = $("#myProgress");
    if (mp) mp.onclick = () => navigate("reports", mine[0].id);
    $$("[data-open]", c).forEach((b) => b.onclick = () => navigate("entry", b.dataset.open));
    $$("[data-report]", c).forEach((b) => b.onclick = () => navigate("reports", b.dataset.report));
  }

  /* ============================================================
   * Dashboard
   * ========================================================== */
  function renderDashboard(c) {
    const rows = visibleRecords();
    const total = rows.length;
    const withBMI = rows.filter((r) => r.bmi != null);
    const avgBMI = withBMI.length
      ? (withBMI.reduce((a, r) => a + r.bmi, 0) / withBMI.length).toFixed(1) : "—";
    const sections = new Set(rows.map((r) => r.sectionCode).filter(Boolean));
    const normal = withBMI.filter((r) => r.bmiClass === "Normal").length;
    const normalPct = withBMI.length ? Math.round((normal / withBMI.length) * 100) : 0;

    if (!total) {
      c.innerHTML = emptyState(
        "Welcome! No records yet",
        "Start by creating a class, then add your students.",
        `<button class="btn btn-primary" id="goEntry">📚 Go to Classes</button>`
      );
      $("#goEntry").onclick = () => navigate("classes");
      return;
    }

    c.innerHTML = `
      <div class="grid stat-grid">
        <div class="card stat brand">
          <span class="stat-ico">👥</span>
          <span class="stat-label">Total Students</span>
          <span class="stat-value">${total}</span>
          <span class="stat-foot">${sections.size} section${sections.size === 1 ? "" : "s"}</span>
        </div>
        <div class="card stat good">
          <span class="stat-ico">⚖️</span>
          <span class="stat-label">Average BMI</span>
          <span class="stat-value">${avgBMI}</span>
          <span class="stat-foot">${withBMI.length} with BMI recorded</span>
        </div>
        <div class="card stat ${normalPct >= 60 ? "good" : "warn"}">
          <span class="stat-ico">💪</span>
          <span class="stat-label">Normal BMI</span>
          <span class="stat-value">${normalPct}%</span>
          <span class="stat-foot">${normal} of ${withBMI.length} students</span>
        </div>
        <div class="card stat warn">
          <span class="stat-ico">🏃</span>
          <span class="stat-label">Tests Completed</span>
          <span class="stat-value">${completionRate(rows)}%</span>
          <span class="stat-foot">avg. fields filled per card</span>
        </div>
      </div>

      <div class="grid two-col" style="margin-top:18px">
        <div class="card">
          <h3>BMI Classification</h3>
          <p class="muted">How students are distributed across BMI categories</p>
          <div class="chart-box"><canvas id="chartBMI"></canvas></div>
        </div>
        <div class="card">
          <h3>Students by Sex</h3>
          <p class="muted">Class composition</p>
          <div class="chart-box sm"><canvas id="chartSex"></canvas></div>
        </div>
      </div>

      <div class="grid two-col" style="margin-top:18px">
        <div class="card">
          <h3>Students per Section</h3>
          <p class="muted">Head count by section code</p>
          <div class="chart-box sm"><canvas id="chartSection"></canvas></div>
        </div>
        <div class="card">
          <h3>Agility (T-Cone) Ratings</h3>
          <p class="muted">Auto-rated from recorded times</p>
          <div class="chart-box sm"><canvas id="chartAgility"></canvas></div>
        </div>
      </div>

      <div class="card" style="margin-top:18px">
        <div class="toolbar" style="margin-bottom:12px">
          <div class="left"><h3 style="margin:0">Recently updated</h3></div>
          <div class="right"><button class="btn btn-soft btn-sm" id="viewAll">View all →</button></div>
        </div>
        <div class="table-wrap">
          <table class="data">
            <thead><tr><th>Name</th><th>Section</th><th>Sex</th><th>BMI</th><th>Status</th><th></th></tr></thead>
            <tbody>
              ${rows.slice(0, 6).map((r) => `
                <tr>
                  <td><strong>${esc(r.fullName || "Unnamed")}</strong></td>
                  <td>${esc(r.sectionCode || "—")}</td>
                  <td>${esc(r.sex || "—")}</td>
                  <td>${r.bmi != null ? r.bmi : "—"}</td>
                  <td>${bmiBadge(r.bmiClass)}</td>
                  <td class="actions">
                    <button class="btn btn-soft btn-sm" data-edit="${r.id}">Edit</button>
                    <button class="btn btn-ghost btn-sm" data-report="${r.id}">Report</button>
                  </td>
                </tr>`).join("")}
            </tbody>
          </table>
        </div>
      </div>`;

    $("#viewAll").onclick = () => navigate("manage");
    $$("[data-edit]", c).forEach((b) => b.onclick = () => navigate("entry", b.dataset.edit));
    $$("[data-report]", c).forEach((b) => b.onclick = () => navigate("reports", b.dataset.report));

    drawCharts(rows);
  }

  function completionRate(rows) {
    const keys = [...HRF, ...SRF].flatMap((s) => s.fields.filter((f) => !f.auto && !f.rating).map((f) => f.k));
    let filled = 0, tot = 0;
    rows.forEach((r) => keys.forEach((k) => { tot++; if (r[k] !== "" && r[k] != null) filled++; }));
    return tot ? Math.round((filled / tot) * 100) : 0;
  }

  function drawCharts(rows) {
    const palette = ["#1f6feb", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#ec4899"];

    // BMI classification
    const bmiCats = ["Underweight", "Normal", "Overweight", "Obese"];
    const bmiCounts = bmiCats.map((c) => rows.filter((r) => r.bmiClass === c).length);
    charts.bmi = new Chart($("#chartBMI"), {
      type: "bar",
      data: { labels: bmiCats, datasets: [{ data: bmiCounts, backgroundColor: ["#f59e0b", "#10b981", "#f59e0b", "#ef4444"], borderRadius: 8 }] },
      options: baseOpts({ y: true }),
    });

    // Sex doughnut
    const sexes = ["Male", "Female"];
    const sexCounts = sexes.map((s) => rows.filter((r) => (r.sex || "").toLowerCase().startsWith(s[0].toLowerCase())).length);
    const other = rows.length - sexCounts.reduce((a, b) => a + b, 0);
    charts.sex = new Chart($("#chartSex"), {
      type: "doughnut",
      data: { labels: other ? [...sexes, "Unspecified"] : sexes, datasets: [{ data: other ? [...sexCounts, other] : sexCounts, backgroundColor: ["#1f6feb", "#ec4899", "#cbd5e1"] }] },
      options: baseOpts({ legend: true }),
    });

    // Sections
    const secMap = {};
    rows.forEach((r) => { const s = r.sectionCode || "Unassigned"; secMap[s] = (secMap[s] || 0) + 1; });
    charts.section = new Chart($("#chartSection"), {
      type: "bar",
      data: { labels: Object.keys(secMap), datasets: [{ data: Object.values(secMap), backgroundColor: "#1f6feb", borderRadius: 8 }] },
      options: baseOpts({ y: true }),
    });

    // Agility ratings
    const rate = ["Excellent", "Good", "Average", "Needs Improvement"];
    const rateCounts = rate.map((x) => rows.filter((r) => r.tConeRating === x).length);
    charts.agility = new Chart($("#chartAgility"), {
      type: "bar",
      data: { labels: rate, datasets: [{ data: rateCounts, backgroundColor: ["#10b981", "#1f6feb", "#f59e0b", "#ef4444"], borderRadius: 8 }] },
      options: baseOpts({ y: true, indexAxis: "y" }),
    });
  }

  function baseOpts(o = {}) {
    const opt = {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: !!o.legend, position: "bottom" } },
      scales: {},
    };
    if (o.y) {
      opt.scales.y = { beginAtZero: true, ticks: { precision: 0 }, grid: { color: "#eef2f7" } };
      opt.scales.x = { grid: { display: false } };
    }
    if (o.indexAxis) opt.indexAxis = o.indexAxis;
    return opt;
  }

  /* ============================================================
   * Entry form
   * ========================================================== */
  // 5-star rating input. Stores the number (1–5) in a hidden field so the
  // existing collect()/save() flow keeps working unchanged.
  function starWidgetHTML(k, val) {
    const cur = parseInt(val, 10) || 0;
    const stars = [1, 2, 3, 4, 5].map((n) =>
      `<button type="button" class="star ${n <= cur ? "on" : ""}" data-val="${n}" title="${n} – ${esc(Scoring.ratingLabel(n))}" aria-label="${n} ${esc(Scoring.ratingLabel(n))}">★</button>`).join("");
    return `<div class="stars" data-stars>
      <input type="hidden" data-k="${k}" value="${cur || ""}" />
      ${stars}
      <button type="button" class="star-clear" data-clear title="Clear rating">✕</button>
    </div>`;
  }

  function paintStars(box, val) {
    $$(".star", box).forEach((s) =>
      s.classList.toggle("on", parseInt(s.dataset.val, 10) <= val));
  }

  // Star string + label for printable reports, e.g. "★★★★☆ Good".
  function ratingStars(val) {
    const n = parseInt(val, 10);
    if (!n) return val ? String(val) : "";
    return "★★★★★☆☆☆☆☆".slice(5 - n, 10 - n) + " " + Scoring.ratingLabel(n);
  }

  function fieldHTML(f, val) {
    const v = val == null ? "" : val;
    if (f.rating) {
      return `<label class="field rating-field"><span>${f.label}</span>${starWidgetHTML(f.k, v)}</label>`;
    }
    if (f.auto) {
      return `<label class="field"><span>${f.label}</span><input class="readonly" data-k="${f.k}" value="${esc(v)}" readonly /></label>`;
    }
    const step = f.step ? `step="${f.step}"` : "";
    return `<label class="field"><span>${f.label}</span>
      <input type="${f.type || "text"}" data-k="${f.k}" value="${esc(v)}" placeholder="${f.ph || ""}" ${step} /></label>`;
  }

  function sectionHTML(sec) {
    return `<div class="param-block" style="margin-bottom:14px">
      <p class="param-title">${sec.title}</p>
      <div class="field-grid">${sec.fields.map((f) => fieldHTML(f, "")).join("")}</div>
    </div>`;
  }

  const ayOptionsHTML = (sel) =>
    academicYears().map((y) => `<option ${y === sel ? "selected" : ""}>${y}</option>`).join("");
  const termOptionsHTML = (sel) =>
    TERMS.map((t) => `<option value="${t}" ${t === sel ? "selected" : ""}>Term ${t}</option>`).join("");

  function nameOptionsHTML(selected) {
    const students = Store.getRoster().students.slice();
    if (selected && !students.some((s) => s.fullName === selected)) {
      students.unshift({ fullName: selected });
    }
    const head = `<option value="">${students.length ? "— select a student —" : "— pull the list first —"}</option>`;
    return head + students
      .map((s) => {
        const extra = s.studentNo || s.email || "";
        const label = extra ? `${s.fullName} — ${extra}` : s.fullName;
        return `<option value="${esc(s.fullName)}" ${s.fullName === selected ? "selected" : ""}>${esc(label)}</option>`;
      })
      .join("");
  }

  function rosterStatusHTML() {
    const roster = Store.getRoster();
    if (!roster.students.length) return "No student list yet — click <b>Pull from Google Sheet</b>.";
    const when = roster.syncedAt ? new Date(roster.syncedAt).toLocaleString() : "";
    return `${roster.students.length} students loaded${when ? " • synced " + esc(when) : ""}`;
  }

  function ratingLegendHTML() {
    const items = Scoring.RATING_SCALE.map((r) =>
      `<span class="rl-item"><span class="rl-stars">${"★".repeat(r.value)}</span> ${r.value} = ${esc(r.label)}</span>`).join("");
    return `<div class="rating-legend"><span class="rl-title">Evaluation scale — auto-filled from results; tap a star to override (✕ to reset):</span>${items}</div>`;
  }

  function renderEntry(c, id) {
    const editing = id ? Store.get(id) : null;
    // Only admins may create brand-new records here; others always edit an
    // existing one they own.
    if (!editing && !isAdmin()) { toast("Your scorecard is created by your teacher.", "err"); return navigate(isStudent() ? "mine" : "classes"); }
    if (editing && !canAccessRecord(editing)) { toast("You don't have access to that record.", "err"); return navigate(isStudent() ? "mine" : "classes"); }
    const r = editing || {};
    const ayValue = r.academicYear || currentAY();
    const termValue = r.term || currentTerm();
    const lockClass = !!r.classId;
    // Class/schedule fields: only an admin can change them (and only when not
    // already managed by a class). Student identity fields: admin only.
    const canInfo = isAdmin();
    const dis = (lockClass || !canInfo) ? "disabled" : "";
    const infoDis = canInfo ? "" : "disabled";
    const showPicker = canInfo && !lockClass;

    c.innerHTML = `
      <form id="scForm">
        <div class="form-tabs no-print" id="formTabs">
          <button type="button" class="ftab active" data-step="0">1 · Student</button>
          <button type="button" class="ftab" data-step="1">2 · Health-Related (HRF)</button>
          <button type="button" class="ftab" data-step="2">3 · Skill-Related (SRF)</button>
          <button type="button" class="ftab" data-step="3">4 · Remarks</button>
        </div>

        <div class="form-step active" data-step="0">
          <div class="form-section">
            <div class="section-head"><span class="pill">Class</span><h3>Class &amp; Schedule</h3>
              <span class="desc">${lockClass ? "Managed from the class page" : (editing ? "Editing existing record" : "Set once for the class")}</span></div>
            <div class="field-grid">
              <label class="field"><span>Academic Year</span><select data-k="academicYear" ${dis}>${ayOptionsHTML(ayValue)}</select></label>
              <label class="field"><span>Term</span><select data-k="term" ${dis}>${termOptionsHTML(termValue)}</select></label>
              <label class="field"><span>PE Course</span><select data-k="course" ${dis}>${optionList(COURSES)}</select></label>
              <label class="field"><span>Section Code</span><input data-k="sectionCode" placeholder="e.g. 101" ${dis} /></label>
              <label class="field"><span>PE Schedule — Day</span><select data-k="scheduleDay" ${dis}>${optionList(DAYS)}</select></label>
              <label class="field"><span>PE Schedule — Time</span><select data-k="scheduleTime" ${dis}>${optionList(TIMES)}</select></label>
              <label class="field"><span>Gym Wing (7th Floor)</span><select data-k="gymWing" ${dis}>${optionList(WINGS)}</select></label>
            </div>
          </div>

          <div class="form-section">
            <div class="section-head"><span class="pill">Student</span><h3>Student</h3>
              <span class="desc">${canInfo ? (lockClass ? "" : "Pick a name — the rest fills in from the sheet") : "Personal info is read-only — you can update the readings"}</span></div>
            <div class="field-grid">
              <label class="field name-field">
                <span>Full Name</span>
                <div class="name-picker">
                  <select data-k="fullName" id="nameSelect" ${dis}>${nameOptionsHTML(r.fullName)}</select>
                  ${showPicker ? `<button type="button" class="btn btn-soft btn-sm" id="pullRosterBtn">⟳ Pull from Google Sheet</button>` : ""}
                </div>
                ${showPicker ? `<small class="muted" id="rosterStatus">${rosterStatusHTML()}</small>` : ""}
              </label>
              <label class="field"><span>Student No.</span><input data-k="studentNo" placeholder="e.g. 17-24-5072" ${infoDis} /></label>
              <label class="field"><span>CIIT Email</span><input type="email" data-k="email" placeholder="student@ciit.edu.ph" ${infoDis} /></label>
              <label class="field"><span>Sex</span><select data-k="sex" ${infoDis}><option value="">—</option><option>Male</option><option>Female</option></select></label>
              <label class="field"><span>Birthday</span><input type="date" data-k="birthday" ${infoDis} /></label>
              <label class="field"><span>Age</span><input type="number" data-k="age" placeholder="e.g. 18" ${infoDis} /></label>
            </div>
          </div>
        </div>

        <div class="form-step" data-step="1">
          <div class="form-section">
            <div class="section-head"><span class="pill">Part I</span><h3>Health-Related Fitness Test (HRF)</h3></div>
            ${ratingLegendHTML()}
            ${HRF.map(sectionHTML).join("")}
            <div class="card thr-card">
              <h3 style="color:var(--brand-dark)">💓 Target Heart Rate (auto)</h3>
              <p class="muted" id="thrLine">Enter Age and Resting HR to see recommended exercise zones.</p>
            </div>
          </div>
        </div>

        <div class="form-step" data-step="2">
          <div class="form-section">
            <div class="section-head"><span class="pill">Part II</span><h3>Skill-Related Fitness Test (SRF)</h3></div>
            ${ratingLegendHTML()}
            ${SRF.map(sectionHTML).join("")}
          </div>
        </div>

        <div class="form-step" data-step="3">
          <div class="form-section">
            <div class="section-head"><span class="pill">Notes</span><h3>Remarks</h3></div>
            <label class="field"><textarea data-k="notes" rows="4" placeholder="Optional notes about this student's performance..."></textarea></label>
          </div>
        </div>

        <div class="form-actions no-print">
          ${editing && isAdmin() ? `<button type="button" class="btn btn-danger" id="delBtn">Delete</button>` : ""}
          <button type="button" class="btn btn-ghost" id="cancelBtn">Cancel</button>
          <button type="submit" class="btn btn-primary" id="saveBtn">💾 ${editing ? "Save changes" : "Save scorecard"}</button>
        </div>
      </form>`;

    const form = $("#scForm", c);
    // Populate values
    $$("[data-k]", form).forEach((el) => { if (r[el.dataset.k] != null) el.value = r[el.dataset.k]; });
    // Reflect saved star ratings visually
    $$("[data-stars]", form).forEach((box) => {
      const input = $("input[data-k]", box);
      paintStars(box, parseInt(input.value, 10) || 0);
    });

    // Tabs — show one step at a time so each fits the screen
    $$(".ftab", form).forEach((tab) => tab.onclick = () => {
      const step = tab.dataset.step;
      $$(".ftab", form).forEach((t) => t.classList.toggle("active", t === tab));
      $$(".form-step", form).forEach((s) => s.classList.toggle("active", s.dataset.step === step));
      c.scrollTop = 0;
      window.scrollTo(0, 0);
    });

    // Remembers the last value we auto-filled for each rating, so we can tell
    // a teacher's manual override apart from an untouched (auto) star.
    const autoShadow = {};

    // Star ratings (event delegation)
    form.addEventListener("click", (e) => {
      const star = e.target.closest(".star");
      const clear = e.target.closest(".star-clear");
      if (!star && !clear) return;
      const box = e.target.closest("[data-stars]");
      if (!box) return;
      const input = $("input[data-k]", box);
      let val = 0;
      if (star) {
        val = parseInt(star.dataset.val, 10);
        if ((parseInt(input.value, 10) || 0) === val) val = 0; // click again to clear
      }
      input.value = val || "";
      paintStars(box, val);
      // Clearing (✕ or toggling off) reverts that star to the auto suggestion.
      recompute();
    });

    const recompute = () => {
      const draft = collect(form);
      computeDerived(draft);
      ["bmi", "bmiClass", "sitReachAvg", "vJumpBest", "ballDropAvg", "tConeRating"].forEach((k) => {
        const el = $(`[data-k="${k}"]`, form);
        if (el) el.value = draft[k] == null ? "" : draft[k];
      });
      // Auto-fill the 5-star evaluations from general norms, unless a teacher
      // has manually overridden a star (kept if it differs from our last auto).
      const auto = Scoring.autoRatings(draft);
      RATING_KEYS.forEach((k) => {
        const input = $(`input[data-k="${k}"]`, form);
        if (!input) return;
        const box = input.closest("[data-stars]");
        const autoVal = auto[k] != null ? auto[k] : null;
        const cur = input.value === "" ? null : parseInt(input.value, 10);
        const shadow = autoShadow[k] != null ? autoShadow[k] : null;
        const autoControlled = cur == null || cur === shadow;
        if (autoControlled) {
          input.value = autoVal || "";
          if (box) paintStars(box, autoVal || 0);
          autoShadow[k] = autoVal;
        }
      });
      // Age is derived from Birthday when one is given; otherwise stays editable
      const ageEl = $('[data-k="age"]', form);
      const autoAge = Scoring.ageFromBirthday(draft.birthday);
      if (ageEl) {
        if (autoAge != null) {
          ageEl.value = autoAge;
          ageEl.readOnly = true;
          ageEl.classList.add("readonly");
          ageEl.title = "Calculated from birthday";
        } else {
          ageEl.readOnly = false;
          ageEl.classList.remove("readonly");
          ageEl.title = "";
        }
      }
      // Target heart rate line
      const thr = Scoring.targetHeartRate(draft.age, draft.rhr);
      const line = $("#thrLine");
      if (thr) {
        let txt = `Max HR (220 − age): <b>${thr.mhr} bpm</b>.`;
        if (thr.moderateLow) {
          txt += ` Moderate zone: <b>${thr.moderateLow}–${thr.moderateHigh} bpm</b>, Vigorous up to <b>${thr.vigorousHigh} bpm</b>.`;
        } else {
          txt += " Add Resting HR for full training zones.";
        }
        line.innerHTML = txt;
      }
    };

    form.addEventListener("input", recompute);
    recompute();

    // Pull the student list from the Google Sheet
    const pullBtn = $("#pullRosterBtn", c);
    if (pullBtn) pullBtn.onclick = async () => {
      const orig = pullBtn.textContent;
      pullBtn.disabled = true;
      pullBtn.textContent = "⏳ Pulling…";
      try {
        const n = await pullRoster();
        const sel = $("#nameSelect", c);
        sel.innerHTML = nameOptionsHTML(sel.value);
        $("#rosterStatus", c).innerHTML = rosterStatusHTML();
        toast(`Loaded ${n} student${n === 1 ? "" : "s"} from the sheet.`, "ok");
      } catch (e) {
        if (["not-public", "empty"].includes(e.message) || /Failed to fetch|NetworkError|HTTP|CORS/i.test(e.message)) {
          sheetHelpModal();
        } else {
          toast("Could not pull the list. " + e.message, "err");
        }
      } finally {
        pullBtn.disabled = false;
        pullBtn.textContent = orig;
      }
    };

    // When a student is picked, fill in any details the sheet provided
    $("#nameSelect", c).addEventListener("change", (e) => {
      const stu = Store.getRoster().students.find((s) => s.fullName === e.target.value);
      if (!stu) return;
      const setVal = (k, v) => { const el = $(`[data-k="${k}"]`, form); if (el) el.value = v || ""; };
      const setIfProvided = (k, v) => { if (v) setVal(k, v); };
      // Identity fields belong to the chosen student — always sync
      setVal("studentNo", stu.studentNo);
      setVal("email", stu.email);
      // These only exist on some sheets; don't wipe a manual entry
      setIfProvided("sectionCode", stu.sectionCode);
      setIfProvided("sex", stu.sex);
      setIfProvided("course", stu.course);
      setIfProvided("birthday", stu.birthday);
      recompute(); // refresh the age from the birthday
    });

    // When the class (AY + Term + Course + Section) is set, reuse the schedule
    // already recorded for that class so it doesn't need re-typing.
    const applyClassDefaults = () => {
      const d = collect(form);
      const def = classDefaults(d.academicYear, d.term, d.course, d.sectionCode);
      if (!def) return;
      const setVal = (k, v) => { const el = $(`[data-k="${k}"]`, form); if (el && v) el.value = v; };
      setVal("scheduleDay", def.scheduleDay);
      setVal("scheduleTime", def.scheduleTime);
      setVal("gymWing", def.gymWing);
    };
    ["academicYear", "term", "course", "sectionCode"].forEach((k) => {
      const el = $(`[data-k="${k}"]`, form);
      if (el) el.addEventListener("change", applyClassDefaults);
    });

    const backView = () => {
      if (isStudent()) return navigate("mine");
      if (editing && editing.classId) return navigate("class", editing.classId);
      return navigate(editing ? "manage" : "classes");
    };
    $("#cancelBtn").onclick = backView;
    const delBtn = $("#delBtn");
    if (delBtn) delBtn.onclick = () => confirmDelete(editing);

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      // Start from the existing record so ownership/link fields (classId,
      // teacherEmail, recordedBy, timestamps) are never lost on save.
      const rec = editing ? Object.assign({}, editing, collect(form)) : collect(form);
      if (editing) rec.id = editing.id;
      if (!rec.fullName || !rec.fullName.trim()) return toast("Please enter the student's name.", "err");
      if (!rec.course) return toast("Please choose the PE course (PATHFIT 1–4).", "err");
      computeDerived(rec);
      if (!rec.recordedBy) rec.recordedBy = currentUser.email;
      const saved = Store.save(rec);
      toast("Scorecard saved.", "ok");
      if (isStudent()) navigate("mine");
      else if (saved.classId) navigate("class", saved.classId);
      else navigate("reports", saved.id);
    });
  }

  function collect(form) {
    const out = {};
    $$("[data-k]", form).forEach((el) => { out[el.dataset.k] = el.value; });
    return out;
  }

  function confirmDelete(rec) {
    modal({
      title: "Delete scorecard?",
      body: `This will permanently remove <b>${esc(rec.fullName || "this student")}</b>'s record. This cannot be undone.`,
      actions: [
        { label: "Cancel", class: "btn-ghost" },
        { label: "Delete", class: "btn-danger", onClick: () => { Store.remove(rec.id); toast("Record deleted.", "ok"); if (rec.classId) navigate("class", rec.classId); else navigate("manage"); } },
      ],
    });
  }

  /* ============================================================
   * Manage data
   * ========================================================== */
  function renderManage(c) {
    if (!isAdmin()) { toast("Only admins can open Manage Data.", "err"); return navigate("classes"); }
    const sections = Array.from(new Set(visibleRecords().map((r) => r.sectionCode).filter(Boolean))).sort();
    c.innerHTML = `
      <div class="toolbar no-print">
        <div class="left">
          <div class="search">🔎 <input id="q" placeholder="Search by name..." /></div>
          <select class="filter" id="fCourse"><option value="">All courses</option>${COURSES.map((s) => `<option>${esc(s)}</option>`).join("")}</select>
          <select class="filter" id="fSection"><option value="">All sections</option>${sections.map((s) => `<option>${esc(s)}</option>`).join("")}</select>
          <select class="filter" id="fSex"><option value="">All</option><option>Male</option><option>Female</option></select>
          <select class="filter" id="fBmi"><option value="">Any BMI</option><option>Underweight</option><option>Normal</option><option>Overweight</option><option>Obese</option></select>
        </div>
        <div class="right">
          <button class="btn btn-soft btn-sm" id="pullRosterManage">⟳ Pull students</button>
          <button class="btn btn-soft btn-sm" id="expCsv">⬇ Export CSV</button>
          <button class="btn btn-soft btn-sm" id="expJson">💾 Backup</button>
          <button class="btn btn-ghost btn-sm" id="impJson">📂 Restore</button>
          <button class="btn btn-primary btn-sm" id="addNew">📚 Classes</button>
        </div>
      </div>
      <div id="tableHost"></div>`;

    const draw = () => {
      const q = $("#q").value.toLowerCase().trim();
      const fCourse = $("#fCourse").value, fSec = $("#fSection").value, fSex = $("#fSex").value, fBmi = $("#fBmi").value;
      let rows = Store.all().filter((r) => {
        if (q && !(r.fullName || "").toLowerCase().includes(q)) return false;
        if (fCourse && r.course !== fCourse) return false;
        if (fSec && r.sectionCode !== fSec) return false;
        if (fSex && !(r.sex || "").toLowerCase().startsWith(fSex[0].toLowerCase())) return false;
        if (fBmi && r.bmiClass !== fBmi) return false;
        return true;
      });
      const host = $("#tableHost");
      if (!rows.length) {
        host.innerHTML = emptyState("No records match", "Try clearing filters or add a new scorecard.", "");
        return;
      }
      host.innerHTML = `
        <div class="table-wrap">
          <table class="data">
            <thead><tr>
              <th>Name</th><th>Course</th><th>Section</th><th>Sex</th><th>Age</th><th>BMI</th><th>Status</th>
              <th>Push-ups</th><th>T-Cone</th><th>Updated</th><th></th>
            </tr></thead>
            <tbody>
              ${rows.map((r) => `
                <tr>
                  <td><strong>${esc(r.fullName || "Unnamed")}</strong></td>
                  <td>${esc(r.course || "—")}</td>
                  <td>${esc(r.sectionCode || "—")}</td>
                  <td>${esc(r.sex || "—")}</td>
                  <td>${esc(r.age || "—")}</td>
                  <td>${r.bmi != null ? r.bmi : "—"}</td>
                  <td>${bmiBadge(r.bmiClass)}</td>
                  <td>${esc(r.pushups || "—")}</td>
                  <td>${r.tCone ? esc(r.tCone) + "s" : "—"}</td>
                  <td>${r.updatedAt ? new Date(r.updatedAt).toLocaleDateString() : "—"}</td>
                  <td class="actions">
                    <button class="btn btn-soft btn-sm" data-edit="${r.id}">Edit</button>
                    <button class="btn btn-ghost btn-sm" data-report="${r.id}">Report</button>
                  </td>
                </tr>`).join("")}
            </tbody>
          </table>
        </div>
        <p class="muted" style="margin-top:10px">${rows.length} record${rows.length === 1 ? "" : "s"} shown</p>`;
      $$("[data-edit]", host).forEach((b) => b.onclick = () => navigate("entry", b.dataset.edit));
      $$("[data-report]", host).forEach((b) => b.onclick = () => navigate("reports", b.dataset.report));
    };

    ["q", "fCourse", "fSection", "fSex", "fBmi"].forEach((idp) => $("#" + idp).addEventListener("input", draw));
    $("#addNew").onclick = () => navigate("classes");
    $("#expCsv").onclick = () => {
      if (!Store.all().length) return toast("No data to export.", "err");
      download(`PFT_scores_${today()}.csv`, Store.exportCSV(), "text/csv");
      toast("CSV exported.", "ok");
    };
    $("#expJson").onclick = () => {
      if (!Store.all().length) return toast("No data to back up.", "err");
      download(`PFT_backup_${today()}.json`, Store.exportJSON(), "application/json");
      toast("Backup downloaded.", "ok");
    };
    $("#impJson").onclick = importFlow;
    const pullMBtn = $("#pullRosterManage");
    pullMBtn.onclick = async () => {
      const orig = pullMBtn.textContent;
      pullMBtn.disabled = true;
      pullMBtn.textContent = "⏳ Pulling…";
      try {
        const n = await pullRoster();
        toast(`Loaded ${n} student${n === 1 ? "" : "s"} from the sheet.`, "ok");
      } catch (e) {
        if (["not-public", "empty"].includes(e.message) || /Failed to fetch|NetworkError|HTTP|CORS/i.test(e.message)) {
          sheetHelpModal();
        } else {
          toast("Could not pull the list. " + e.message, "err");
        }
      } finally {
        pullMBtn.disabled = false;
        pullMBtn.textContent = orig;
      }
    };
    draw();
  }

  function importFlow() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.onchange = () => {
      const file = input.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        modal({
          title: "Restore backup",
          body: `Import <b>${esc(file.name)}</b>. Choose how to apply it:`,
          actions: [
            { label: "Cancel", class: "btn-ghost" },
            { label: "Merge with current", class: "btn-soft", onClick: () => doImport(reader.result, "merge") },
            { label: "Replace all", class: "btn-danger", onClick: () => doImport(reader.result, "replace") },
          ],
        });
      };
      reader.readAsText(file);
    };
    input.click();
  }

  function doImport(text, mode) {
    try {
      const n = Store.importJSON(text, mode);
      toast(`Imported ${n} record${n === 1 ? "" : "s"}.`, "ok");
      navigate("manage");
    } catch (e) {
      toast("Could not read that file. " + e.message, "err");
    }
  }

  /* ============================================================
   * Reports
   * ========================================================== */
  function renderReports(c, id) {
    const rows = visibleRecords();
    if (!rows.length) {
      c.innerHTML = emptyState("No reports yet", "Add scorecards first to generate reports.", "");
      return;
    }
    // Never let someone open a report for a record they can't access.
    let selected = id ? Store.get(id) : rows[0];
    if (selected && !canAccessRecord(selected)) selected = rows[0];

    c.innerHTML = `
      <div class="report-head no-print">
        <div class="left">
          <div class="seg" id="repModes">
            <button class="seg-btn active" data-mode="individual">👤 Individual</button>
            <button class="seg-btn" data-mode="progress">📈 Progress</button>
            <button class="seg-btn" data-mode="summary">📊 Class summary</button>
            <button class="seg-btn" data-mode="custom">🔧 Custom report</button>
          </div>
          <select class="filter" id="repSelect" style="min-width:260px">
            ${rows.map((r) => `<option value="${r.id}" ${selected && r.id === selected.id ? "selected" : ""}>${esc(r.fullName || "Unnamed")} — ${esc(r.course || "")} ${esc(r.sectionCode || "")}</option>`).join("")}
          </select>
        </div>
        <div class="right">
          <button class="btn btn-primary" id="printBtn">🖨 Print / Save PDF</button>
        </div>
      </div>
      <div id="reportBody"></div>`;

    const body = $("#reportBody");
    const setMode = (mode) => {
      if (charts.progress) { charts.progress.destroy(); charts.progress = null; }
      $$("#repModes .seg-btn").forEach((b) => b.classList.toggle("active", b.dataset.mode === mode));
      $("#repSelect").style.display = mode === "individual" ? "" : "none";
      if (mode === "individual") body.innerHTML = scoreCardHTML(selected || rows[0]);
      else if (mode === "progress") renderProgressReport(body, selected || rows[0]);
      else if (mode === "summary") body.innerHTML = classSummaryHTML(visibleRecords());
      else renderCustomReport(body);
    };

    $$("#repModes .seg-btn").forEach((b) => b.onclick = () => setMode(b.dataset.mode));
    $("#repSelect").onchange = (e) => { selected = Store.get(e.target.value); body.innerHTML = scoreCardHTML(selected); };
    $("#printBtn").onclick = () => window.print();
    setMode("individual");
  }

  /* -------- Flexible, sortable & filterable report -------- */
  const RCOLS = [
    { k: "fullName", label: "Name", type: "text" },
    { k: "course", label: "Course", type: "text" },
    { k: "sectionCode", label: "Section", type: "text" },
    { k: "sex", label: "Sex", type: "text" },
    { k: "age", label: "Age", type: "num" },
    { k: "bmi", label: "BMI", type: "num" },
    { k: "bmiClass", label: "BMI Class", type: "text" },
    { k: "pushups", label: "Push-ups", type: "num" },
    { k: "situps", label: "Sit-ups", type: "num" },
    { k: "handEye", label: "Hand-Eye", type: "num" },
    { k: "vJumpBest", label: "V.Jump (cm)", type: "num" },
    { k: "tCone", label: "T-Cone (s)", type: "num" },
    { k: "tConeRating", label: "Agility", type: "text" },
  ];

  function renderCustomReport(host) {
    const state = { course: "", section: "", sex: "", bmi: "", sortKey: "fullName", sortDir: "asc" };

    const draw = () => {
      const sections = Array.from(new Set(visibleRecords().map((r) => r.sectionCode).filter(Boolean))).sort();
      let rows = visibleRecords().filter((r) => {
        if (state.course && r.course !== state.course) return false;
        if (state.section && r.sectionCode !== state.section) return false;
        if (state.sex && !(r.sex || "").toLowerCase().startsWith(state.sex[0].toLowerCase())) return false;
        if (state.bmi && r.bmiClass !== state.bmi) return false;
        return true;
      });
      const col = RCOLS.find((c) => c.k === state.sortKey);
      rows.sort((a, b) => {
        let x = a[state.sortKey], y = b[state.sortKey];
        if (col.type === "num") { x = parseFloat(x); y = parseFloat(y); x = Number.isFinite(x) ? x : -Infinity; y = Number.isFinite(y) ? y : -Infinity; }
        else { x = (x || "").toString().toLowerCase(); y = (y || "").toString().toLowerCase(); }
        if (x < y) return state.sortDir === "asc" ? -1 : 1;
        if (x > y) return state.sortDir === "asc" ? 1 : -1;
        return 0;
      });

      const arrow = (k) => state.sortKey === k ? (state.sortDir === "asc" ? " ▲" : " ▼") : "";
      const activeFilters = [state.course, state.section && "Sec " + state.section, state.sex, state.bmi]
        .filter(Boolean).join(" • ") || "All students";

      host.innerHTML = `
        <div class="toolbar no-print" style="margin-bottom:14px">
          <div class="left">
            <select class="filter" id="rcCourse"><option value="">All courses</option>${COURSES.map((s) => `<option ${s === state.course ? "selected" : ""}>${esc(s)}</option>`).join("")}</select>
            <select class="filter" id="rcSection"><option value="">All sections</option>${sections.map((s) => `<option ${s === state.section ? "selected" : ""}>${esc(s)}</option>`).join("")}</select>
            <select class="filter" id="rcSex"><option value="">Any sex</option><option ${state.sex === "Male" ? "selected" : ""}>Male</option><option ${state.sex === "Female" ? "selected" : ""}>Female</option></select>
            <select class="filter" id="rcBmi"><option value="">Any BMI</option>${["Underweight", "Normal", "Overweight", "Obese"].map((s) => `<option ${s === state.bmi ? "selected" : ""}>${esc(s)}</option>`).join("")}</select>
          </div>
          <div class="right">
            <label class="mini-label">Sort by</label>
            <select class="filter" id="rcSort">${RCOLS.map((c) => `<option value="${c.k}" ${c.k === state.sortKey ? "selected" : ""}>${esc(c.label)}</option>`).join("")}</select>
            <button class="btn btn-ghost btn-sm" id="rcDir">${state.sortDir === "asc" ? "▲ Asc" : "▼ Desc"}</button>
          </div>
        </div>
        <div class="scorecard">
          <div class="sc-title">
            <h2>${esc(CFG.schoolName)}</h2>
            <p>PFT Custom Report — ${esc(activeFilters)}</p>
            <p>${esc(CFG.schoolYear)} • Prepared by ${esc(currentUser.name)} • ${new Date().toLocaleDateString()} • ${rows.length} student${rows.length === 1 ? "" : "s"}</p>
          </div>
          <table class="sc sortable">
            <thead><tr>${RCOLS.map((c) => `<th data-sort="${c.k}">${esc(c.label)}${arrow(c.k)}</th>`).join("")}</tr></thead>
            <tbody>
              ${rows.length ? rows.map((r) => `<tr>${RCOLS.map((c) => `<td>${cellVal(r, c)}</td>`).join("")}</tr>`).join("")
                : `<tr><td colspan="${RCOLS.length}" style="text-align:center;color:#94a3b8">No students match these filters.</td></tr>`}
            </tbody>
          </table>
        </div>`;

      $("#rcCourse").onchange = (e) => { state.course = e.target.value; draw(); };
      $("#rcSection").onchange = (e) => { state.section = e.target.value; draw(); };
      $("#rcSex").onchange = (e) => { state.sex = e.target.value; draw(); };
      $("#rcBmi").onchange = (e) => { state.bmi = e.target.value; draw(); };
      $("#rcSort").onchange = (e) => { state.sortKey = e.target.value; draw(); };
      $("#rcDir").onclick = () => { state.sortDir = state.sortDir === "asc" ? "desc" : "asc"; draw(); };
      $$("th[data-sort]", host).forEach((th) => th.onclick = () => {
        const k = th.dataset.sort;
        if (state.sortKey === k) state.sortDir = state.sortDir === "asc" ? "desc" : "asc";
        else { state.sortKey = k; state.sortDir = "asc"; }
        draw();
      });
    };
    draw();
  }

  function cellVal(r, col) {
    let v = r[col.k];
    if (v === "" || v == null) return "—";
    if (col.k === "tCone") return esc(v) + "s";
    if (col.k === "bmiClass") return bmiBadge(v);
    return esc(v);
  }

  function row(label, value, evalv) {
    return `<tr><td>${label}</td><td>${value === "" || value == null ? "—" : esc(value)}</td><td>${evalv ? esc(evalv) : ""}</td></tr>`;
  }

  function scoreCardHTML(r) {
    const thr = Scoring.targetHeartRate(r.age, r.rhr);
    const thrText = thr && thr.moderateLow
      ? `Max HR <b>${thr.mhr}</b> bpm • Heart Rate Reserve <b>${thr.hrr}</b> • Moderate zone (50–70%) <b>${thr.moderateLow}–${thr.moderateHigh}</b> bpm • Vigorous zone (70–85%) <b>${thr.moderateHigh}–${thr.vigorousHigh}</b> bpm`
      : (thr ? `Max HR <b>${thr.mhr}</b> bpm (220 − age). Add a Resting HR to compute training zones.` : "");
    return `
      <div class="scorecard">
        <div class="sc-title">
          <h2>${esc(CFG.schoolName)}</h2>
          <p>${esc(CFG.courseName)} — Physical Fitness Test (PFT) Scorecard</p>
          <p>${esc(CFG.schoolYear)}</p>
        </div>
        <div class="sc-info">
          <div><b>Name:</b> ${esc(r.fullName || "")}</div>
          <div><b>Student No.:</b> ${esc(r.studentNo || "")}</div>
          <div><b>Academic Year / Term:</b> ${esc(r.academicYear || "")}${r.term ? " • Term " + esc(r.term) : ""}</div>
          <div><b>Course / Section:</b> ${esc(r.course || "PATHFIT")} – ${esc(r.sectionCode || "")}</div>
          <div><b>Sex:</b> ${esc(r.sex || "")}</div>
          <div><b>Age:</b> ${esc(r.age || "")}</div>
          <div><b>Birthday:</b> ${esc(r.birthday || "")}</div>
          <div><b>PE Schedule:</b> ${esc(r.scheduleDay || "")} ${esc(r.scheduleTime || "")}</div>
          <div><b>Gym Wing:</b> ${esc(r.gymWing || "")}</div>
          <div><b>Recorded by:</b> ${esc(r.recordedBy || currentUser.email)}</div>
        </div>

        <div class="sc-part">
          <h4>PART I. HEALTH-RELATED FITNESS TEST</h4>
          <table class="sc">
            <thead><tr><th style="width:45%">Parameter / Activity</th><th style="width:30%">Test Result</th><th>Evaluation</th></tr></thead>
            <tbody>
              ${row("Height (m)", r.heightM)}
              ${row("Weight (kg)", r.weightKg)}
              ${row("Body Mass Index (BMI)", r.bmi, r.bmiClass)}
              ${row("Cardiovascular — Resting HR (before)", r.rhr)}
              ${row("Cardiovascular — HR (after)", r.mhrAfter, ratingStars(r.cardioRating))}
              ${thrText ? `<tr><td>Target Heart Rate (computed)</td><td colspan="2">${thrText}</td></tr>` : ""}
              ${row("Muscular Strength — Push-ups", r.pushups)}
              ${row("Muscular Strength — Basic Plank", r.plankTime, ratingStars(r.strengthRating))}
              ${row("Muscular Endurance — Wall Squat (Right)", r.wallSquatRight, ratingStars(r.wallSquatRightRating))}
              ${row("Muscular Endurance — Wall Squat (Left)", r.wallSquatLeft, ratingStars(r.wallSquatLeftRating))}
              ${row("Muscular Endurance — Sit-ups", r.situps, ratingStars(r.situpsRating))}
              ${row("Flexibility — Zipper (Right, cm)", r.zipperRight, ratingStars(r.zipperRightRating))}
              ${row("Flexibility — Zipper (Left, cm)", r.zipperLeft, ratingStars(r.zipperLeftRating))}
              ${row("Flexibility — Sit & Reach 1st (cm)", r.sitReach1)}
              ${row("Flexibility — Sit & Reach 2nd (cm)", r.sitReach2)}
              ${row("Flexibility — Sit & Reach 3rd (cm)", r.sitReach3)}
              ${row("Flexibility — Sit & Reach Avg (cm)", r.sitReachAvg, ratingStars(r.sitReachAvgRating))}
            </tbody>
          </table>
        </div>

        <div class="sc-part">
          <h4>PART II. SKILL-RELATED FITNESS TEST</h4>
          <table class="sc">
            <thead><tr><th style="width:45%">Parameter / Activity</th><th style="width:30%">Test Result</th><th>Evaluation</th></tr></thead>
            <tbody>
              ${row("Coordination — Hand-Eye (catches)", r.handEye, ratingStars(r.coordRating))}
              ${row("Agility — T-Cone Fastest Time (s)", r.tCone, r.tConeRating)}
              ${row("Speed — Shuttle Run (time)", r.shuttleRun, ratingStars(r.speedRating))}
              ${row("Power — Vertical Jump 1st (cm)", r.vJump1)}
              ${row("Power — Vertical Jump 2nd (cm)", r.vJump2)}
              ${row("Power — Vertical Jump 3rd (cm)", r.vJump3)}
              ${row("Power — Vertical Jump Best (cm)", r.vJumpBest, ratingStars(r.powerRating))}
              ${row("Balance — Stork Right Foot (time)", r.storkRight, ratingStars(r.storkRightRating))}
              ${row("Balance — Stork Left Foot (time)", r.storkLeft, ratingStars(r.storkLeftRating))}
              ${row("Reaction — Ball Drop 1st Trial (cm)", r.ballDrop1)}
              ${row("Reaction — Ball Drop 2nd Trial (cm)", r.ballDrop2)}
              ${row("Reaction — Ball Drop 3rd Trial (cm)", r.ballDrop3)}
              ${row("Reaction — Ball Drop Average (cm)", r.ballDropAvg, ratingStars(r.reactionRating))}
            </tbody>
          </table>
        </div>

        <div class="sc-part">
          <h4>Standards &amp; How Scores Are Computed</h4>
          <div style="font-size:11.5px;color:#475569;display:grid;gap:6px;line-height:1.55;padding:10px 2px">
            <div><b>BMI</b> = Weight (kg) ÷ Height (m)². &nbsp;Underweight &lt;18.5 &nbsp;•&nbsp; Normal 18.5–24.9 &nbsp;•&nbsp; Overweight 25.0–29.9 &nbsp;•&nbsp; Obese ≥30.0.</div>
            <div><b>Target Heart Rate</b> (Karvonen): Max HR = 220 − age; Heart Rate Reserve (HRR) = Max HR − Resting HR; Zone = HRR × intensity% + Resting HR. Moderate = 50–70%, Vigorous = 70–85%.</div>
            <div><b>Agility (T-Cone), seconds</b> — Excellent M&lt;9.50 / F&lt;10.50 &nbsp;•&nbsp; Good 9.51–10.50 / 10.51–11.50 &nbsp;•&nbsp; Average 10.51–11.50 / 11.51–12.50 &nbsp;•&nbsp; Poor &gt;11.50 / &gt;12.50.</div>
            <div><b>Sit &amp; Reach</b> and <b>Ball Drop</b> results = average of 3 trials. &nbsp;<b>Vertical Jump</b> result = best of 3 trials.</div>
            <div><b>Evaluation</b> is a 5-point scale: ★★★★★ Excellent &nbsp;•&nbsp; ★★★★ Good &nbsp;•&nbsp; ★★★ Average &nbsp;•&nbsp; ★★ Fair &nbsp;•&nbsp; ★ Needs Improvement.</div>
          </div>
        </div>

        ${r.notes ? `<p style="margin-top:14px;font-size:13px"><b>Remarks:</b> ${esc(r.notes)}</p>` : ""}

        <div class="sc-sign">
          <div>Signature over Printed Name of Student</div>
          <div>Signature over Printed Name of Parent/Guardian</div>
          <div>${esc(currentUser.name)}<br>Name of PE Instructor</div>
        </div>
      </div>`;
  }

  /* ============================================================
   * Progress report — one student across their test periods
   * ========================================================== */
  // dir: 1 = higher is better, -1 = lower is better, 0 = neutral. dur = mm:ss value.
  const PROGRESS_METRICS = [
    { label: "BMI", k: "bmi", dir: 0 },
    { label: "Weight (kg)", k: "weightKg", dir: 0 },
    { label: "Resting HR (bpm)", k: "rhr", dir: -1 },
    { label: "Push-ups (count)", k: "pushups", dir: 1 },
    { label: "Basic Plank (mm:ss)", k: "plankTime", dir: 1, dur: true },
    { label: "Wall Squat — Left", k: "wallSquatLeft", dir: 1, dur: true },
    { label: "Wall Squat — Right", k: "wallSquatRight", dir: 1, dur: true },
    { label: "Sit-ups (count)", k: "situps", dir: 1 },
    { label: "Zipper — Left (cm)", k: "zipperLeft", dir: 1 },
    { label: "Zipper — Right (cm)", k: "zipperRight", dir: 1 },
    { label: "Sit & Reach Avg (cm)", k: "sitReachAvg", dir: 1 },
    { label: "Hand-Eye (catches)", k: "handEye", dir: 1 },
    { label: "T-Cone (s)", k: "tCone", dir: -1 },
    { label: "Shuttle Run", k: "shuttleRun", dir: -1, dur: true },
    { label: "Vertical Jump (cm)", k: "vJumpBest", dir: 1 },
    { label: "Stork Balance — Left", k: "storkLeft", dir: 1, dur: true },
    { label: "Stork Balance — Right", k: "storkRight", dir: 1, dur: true },
    { label: "Ball Drop Avg (cm)", k: "ballDropAvg", dir: -1 },
  ];

  const studentKey = (r) => (r.studentNo || r.email || r.fullName || "").trim().toLowerCase();

  function periodOrder(a, b) {
    const ay = String(a.academicYear || "").localeCompare(String(b.academicYear || ""));
    if (ay !== 0) return ay;
    const t = (parseInt(a.term, 10) || 0) - (parseInt(b.term, 10) || 0);
    if (t !== 0) return t;
    return (a.createdAt || 0) - (b.createdAt || 0);
  }

  function distinctStudents() {
    const map = new Map();
    visibleRecords().forEach((r) => {
      const k = studentKey(r);
      if (!k) return;
      if (!map.has(k)) map.set(k, { key: k, name: r.fullName, studentNo: r.studentNo, email: r.email, records: [] });
      map.get(k).records.push(r);
    });
    const list = Array.from(map.values());
    list.forEach((s) => s.records.sort(periodOrder));
    return list.sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
  }

  function toNumeric(v, dur) {
    if (v === "" || v == null) return null;
    if (dur && typeof v === "string" && v.includes(":")) {
      const parts = v.split(":").map((x) => parseFloat(x));
      if (parts.every((n) => Number.isFinite(n))) return parts[0] * 60 + (parts[1] || 0);
      return null;
    }
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : null;
  }

  function progCell(metric, rec, prevRec) {
    const raw = rec[metric.k];
    const disp = (raw === "" || raw == null) ? "—" : esc(raw);
    let arrow = "";
    if (prevRec) {
      const cur = toNumeric(raw, metric.dur);
      const prev = toNumeric(prevRec[metric.k], metric.dur);
      if (cur != null && prev != null && cur !== prev) {
        const glyph = cur > prev ? "▲" : "▼";
        let tone = "neutral";
        if (metric.dir === 1) tone = cur > prev ? "up" : "down";
        else if (metric.dir === -1) tone = cur < prev ? "up" : "down";
        arrow = ` <span class="delta ${tone}">${glyph}</span>`;
      }
    }
    return `<td>${disp}${arrow}</td>`;
  }

  function renderProgressReport(host, selected) {
    const students = distinctStudents();
    if (!students.length) {
      host.innerHTML = `<div class="card"><p class="muted">No students to compare yet.</p></div>`;
      return;
    }
    let curKey = selected ? studentKey(selected) : students[0].key;
    if (!students.some((s) => s.key === curKey)) curKey = students[0].key;

    host.innerHTML = `
      <div class="toolbar no-print" style="margin-bottom:14px">
        <div class="left">
          <label class="mini-label">Student</label>
          <select class="filter" id="progSelect" style="min-width:280px">
            ${students.map((s) => `<option value="${esc(s.key)}" ${s.key === curKey ? "selected" : ""}>${esc(s.name || "Unnamed")}${s.studentNo ? " — " + esc(s.studentNo) : ""} (${s.records.length})</option>`).join("")}
          </select>
        </div>
      </div>
      <div id="progBody"></div>`;

    const draw = () => {
      const stu = students.find((s) => s.key === curKey);
      $("#progBody").innerHTML = progressHTML(stu);
      drawProgressChart(stu);
    };
    $("#progSelect").onchange = (e) => { curKey = e.target.value; draw(); };
    draw();
  }

  function progressHTML(stu) {
    const periods = stu.records;
    const head = periods.map((p) =>
      `<th>${esc(p.academicYear || "")}<br><small>Term ${esc(p.term || "?")} • ${esc(p.course || "")} ${esc(p.sectionCode || "")}</small></th>`).join("");

    const metricRows = PROGRESS_METRICS.map((m) =>
      `<tr><td class="prm">${esc(m.label)}</td>${periods.map((p, i) => progCell(m, p, i > 0 ? periods[i - 1] : null)).join("")}</tr>`).join("");

    const bmiClassRow = `<tr><td class="prm">BMI Classification</td>${periods.map((p) => `<td>${p.bmiClass ? bmiBadge(p.bmiClass) : "—"}</td>`).join("")}</tr>`;

    const oneOnly = periods.length < 2
      ? `<p class="muted" style="margin-top:10px">Only one test period recorded — add this student to another term/AY to see progress arrows.</p>` : "";

    return `
      <div class="scorecard">
        <div class="sc-title">
          <h2>${esc(CFG.schoolName)}</h2>
          <p>PFT Progress Report — ${esc(stu.name || "Unnamed")}</p>
          <p>${stu.studentNo ? "Student No. " + esc(stu.studentNo) + " • " : ""}${periods.length} test period${periods.length === 1 ? "" : "s"} • Prepared by ${esc(currentUser.name)} • ${new Date().toLocaleDateString()}</p>
        </div>
        <div class="chart-box" style="margin:6px 0 18px"><canvas id="progChart"></canvas></div>
        <table class="sc prog-table">
          <thead><tr><th style="width:32%">Parameter</th>${head}</tr></thead>
          <tbody>
            ${metricRows}
            ${bmiClassRow}
          </tbody>
        </table>
        <p class="muted prog-legend" style="margin-top:12px">
          <span class="delta up">▲</span>/<span class="delta down">▼</span> shown vs the previous period —
          <b class="imp-up">green</b> = improved, <b class="imp-down">red</b> = declined, grey = changed (no better/worse).
        </p>
        ${oneOnly}
      </div>`;
  }

  function drawProgressChart(stu) {
    if (charts.progress) { charts.progress.destroy(); charts.progress = null; }
    const canvas = $("#progChart");
    if (!canvas) return;
    const periods = stu.records;
    const labels = periods.map((p) => `${p.academicYear || ""} T${p.term || "?"}`);
    const bmiData = periods.map((p) => (p.bmi != null ? p.bmi : null));
    charts.progress = new Chart(canvas, {
      type: "line",
      data: { labels, datasets: [{ label: "BMI", data: bmiData, borderColor: "#1f6feb", backgroundColor: "rgba(31,111,235,.15)", tension: .25, spanGaps: true, fill: true, pointRadius: 4 }] },
      options: baseOpts({ y: true, legend: true }),
    });
  }

  function classSummaryHTML(rows) {
    const total = rows.length;
    const bmiCats = ["Underweight", "Normal", "Overweight", "Obese"];
    const bmiCounts = bmiCats.map((c) => rows.filter((r) => r.bmiClass === c).length);
    const withBMI = rows.filter((r) => r.bmi != null);
    const avgBMI = withBMI.length ? (withBMI.reduce((a, r) => a + r.bmi, 0) / withBMI.length).toFixed(1) : "—";
    const avg = (k) => {
      const v = rows.map((r) => parseFloat(r[k])).filter((n) => Number.isFinite(n));
      return v.length ? (v.reduce((a, b) => a + b, 0) / v.length).toFixed(1) : "—";
    };
    const secMap = {};
    rows.forEach((r) => { const s = r.sectionCode || "Unassigned"; secMap[s] = (secMap[s] || 0) + 1; });

    return `
      <div class="scorecard">
        <div class="sc-title">
          <h2>${esc(CFG.schoolName)}</h2>
          <p>${esc(CFG.courseName)} — PFT Class Summary Report</p>
          <p>${esc(CFG.schoolYear)} • Prepared by ${esc(currentUser.name)} • ${new Date().toLocaleDateString()}</p>
        </div>
        <div class="sc-info">
          <div><b>Total Students:</b> ${total}</div>
          <div><b>Average BMI:</b> ${avgBMI}</div>
          <div><b>Avg Push-ups:</b> ${avg("pushups")}</div>
          <div><b>Avg Sit-ups:</b> ${avg("situps")}</div>
          <div><b>Avg Sit &amp; Reach (cm):</b> ${avg("sitReachAvg")}</div>
          <div><b>Avg Hand-Eye (catches):</b> ${avg("handEye")}</div>
          <div><b>Avg T-Cone (s):</b> ${avg("tCone")}</div>
          <div><b>Avg Vertical Jump (cm):</b> ${avg("vJumpBest")}</div>
          <div><b>Avg Ball Drop (cm):</b> ${avg("ballDropAvg")}</div>
        </div>

        <div class="sc-part">
          <h4>BMI Classification Distribution</h4>
          <table class="sc">
            <thead><tr><th>Category</th><th>Students</th><th>Percentage</th></tr></thead>
            <tbody>${bmiCats.map((c, i) =>
              `<tr><td>${c}</td><td>${bmiCounts[i]}</td><td>${withBMI.length ? Math.round(bmiCounts[i] / withBMI.length * 100) : 0}%</td></tr>`).join("")}
            </tbody>
          </table>
        </div>

        <div class="sc-part">
          <h4>Students per Section</h4>
          <table class="sc">
            <thead><tr><th>Section</th><th>Students</th></tr></thead>
            <tbody>${Object.entries(secMap).map(([s, n]) => `<tr><td>PATHFIT – ${esc(s)}</td><td>${n}</td></tr>`).join("")}</tbody>
          </table>
        </div>

        <div class="sc-part">
          <h4>Roster</h4>
          <table class="sc">
            <thead><tr><th>Name</th><th>Course</th><th>Section</th><th>Sex</th><th>BMI</th><th>Class</th><th>Push-ups</th><th>T-Cone</th></tr></thead>
            <tbody>${rows.map((r) => `<tr>
              <td>${esc(r.fullName || "")}</td><td>${esc(r.course || "")}</td><td>${esc(r.sectionCode || "")}</td><td>${esc(r.sex || "")}</td>
              <td>${r.bmi != null ? r.bmi : "—"}</td><td>${esc(r.bmiClass || "—")}</td>
              <td>${esc(r.pushups || "—")}</td><td>${r.tCone ? esc(r.tCone) + "s" : "—"}</td></tr>`).join("")}
            </tbody>
          </table>
        </div>

        <div class="sc-part">
          <h4>Trial Details — all attempts</h4>
          <table class="sc" style="font-size:11px">
            <thead>
              <tr>
                <th rowspan="2">Name</th>
                <th colspan="4">Sit &amp; Reach (cm)</th>
                <th colspan="4">Vertical Jump (cm)</th>
                <th colspan="4">Ball Drop (cm)</th>
              </tr>
              <tr>
                <th>1st</th><th>2nd</th><th>3rd</th><th>Avg</th>
                <th>1st</th><th>2nd</th><th>3rd</th><th>Best</th>
                <th>1st</th><th>2nd</th><th>3rd</th><th>Avg</th>
              </tr>
            </thead>
            <tbody>${rows.map((r) => {
              const cell = (v) => v === "" || v == null ? "—" : esc(v);
              return `<tr>
                <td style="text-align:left">${esc(r.fullName || "")}</td>
                <td>${cell(r.sitReach1)}</td><td>${cell(r.sitReach2)}</td><td>${cell(r.sitReach3)}</td><td><b>${cell(r.sitReachAvg)}</b></td>
                <td>${cell(r.vJump1)}</td><td>${cell(r.vJump2)}</td><td>${cell(r.vJump3)}</td><td><b>${cell(r.vJumpBest)}</b></td>
                <td>${cell(r.ballDrop1)}</td><td>${cell(r.ballDrop2)}</td><td>${cell(r.ballDrop3)}</td><td><b>${cell(r.ballDropAvg)}</b></td>
              </tr>`;
            }).join("")}
            </tbody>
          </table>
        </div>
      </div>`;
  }

  /* ============================================================
   * Shared bits
   * ========================================================== */
  function bmiBadge(cls) {
    if (!cls) return `<span class="badge muted">—</span>`;
    const tone = Scoring.bmiTone(cls);
    return `<span class="badge ${tone}">${esc(cls)}</span>`;
  }

  function emptyState(title, sub, actionHTML) {
    return `<div class="card"><div class="empty">
      <div class="big">📋</div>
      <h3 style="margin:0 0 6px">${esc(title)}</h3>
      <p class="muted" style="margin:0 0 16px">${esc(sub)}</p>
      ${actionHTML || ""}
    </div></div>`;
  }

  const today = () => new Date().toISOString().slice(0, 10);

  function showHelp() {
    modal({
      title: "How to use this system",
      body: `
        <div style="max-height:68vh;overflow:auto;padding-right:4px">
        <p><b>1. Dashboard</b> — see totals and charts about your class at a glance.</p>
        <p><b>2. New / Edit Scorecard</b> — type a student's test results. BMI, averages,
        best scores, agility rating and target heart rate are computed for you.</p>
        <p><b>3. Manage Data</b> — search, filter, edit or delete records. Use
        <b>Backup</b> to save a file and <b>Restore</b> to load it on another computer.</p>
        <p><b>4. Reports</b> — open a student's printable scorecard or a class summary,
        then click <b>Print / Save PDF</b>.</p>

        <hr style="border:none;border-top:1px solid var(--line);margin:14px 0">
        <p style="margin:0 0 6px"><b>How each ⭐ Evaluation is computed</b></p>
        <p style="margin:0 0 8px;color:var(--ink-3)">Stars are filled in automatically from the
        student's results (and their sex, where standards differ). Tap a star to set your own
        rating; tap the <b>✕</b> to clear it and go back to the automatic one.</p>
        <p style="margin:0 0 4px;color:#15803d"><b>From the PATHFIT lecture (official):</b></p>
        <ul style="margin:0 0 10px;padding-left:18px;line-height:1.6">
          <li><b>BMI classification</b> = Weight (kg) ÷ Height (m)² — slides 12–16.</li>
          <li><b>Target Heart Rate</b> (Max HR = 220 − age → zones) — slides 5–11.</li>
          <li><b>Muscular Strength (push-ups)</b> — official chart by age &amp; sex — slide 20.</li>
          <li><b>Agility (T-Cone)</b> rated from the time, by sex — slide 28.</li>
        </ul>
        <p style="margin:0 0 4px;color:#b45309"><b>From general fitness norms (adjustable):</b></p>
        <ul style="margin:0 0 10px;padding-left:18px;line-height:1.6">
          <li><b>Cardiovascular</b> ← Resting Heart Rate (lower is better)</li>
          <li><b>Muscular Endurance</b> ← wall-squat hold time &amp; number of sit-ups</li>
          <li><b>Flexibility</b> ← zipper test &amp; sit-and-reach average</li>
          <li><b>Coordination</b> ← hand-eye catches</li>
          <li><b>Speed</b> ← shuttle-run time (lower is better)</li>
          <li><b>Power</b> ← vertical jump (best of 3)</li>
          <li><b>Balance</b> ← stork-stand time</li>
          <li><b>Reaction</b> ← ball-drop distance in cm (lower is better)</li>
        </ul>
        <p style="margin:0;color:var(--ink-3)">Scale: ★★★★★ Excellent • ★★★★ Good • ★★★ Average •
        ★★ Fair • ★ Needs Improvement. The general-norm cut-offs can be replaced with CIIT's
        official charts anytime.</p>
        </div>`,
      actions: [{ label: "Got it", class: "btn-primary" }],
    });
  }

  /* ============================================================
   * Boot
   * ========================================================== */
  function boot() {
    applyBranding();

    // Turn on shared login + database if configured; otherwise keep the
    // original per-device behaviour.
    cloudEnabled = Cloud.init(CFG.firebase);
    if (cloudEnabled) {
      Store.setSync((type, payload) => {
        if (type === "record") Cloud.pushRecord(payload);
        else if (type === "record:remove") Cloud.removeRecord(payload);
        else if (type === "class") Cloud.pushClass(payload);
        else if (type === "class:remove") Cloud.removeClass(payload);
        else if (type === "settings") Cloud.pushSettings(payload);
      });
      initCloudAuth();
    } else {
      initGoogle();
    }

    $("#localLoginBtn").onclick = localSignIn;
    $("#teacherEmail").addEventListener("keydown", (e) => { if (e.key === "Enter") localSignIn(); });
    $("#logoutBtn").onclick = logout;
    $("#helpBtn").onclick = showHelp;
    $$(".nav-item[data-view]").forEach((b) => b.onclick = () => navigate(b.dataset.view));

    // Restore session (local mode only — Firebase restores its own session).
    if (!cloudEnabled) {
      try {
        const saved = JSON.parse(localStorage.getItem(AUTH_KEY));
        if (saved && saved.email) { currentUser = saved; enterApp(); }
      } catch (e) {}
    }
  }

  document.addEventListener("DOMContentLoaded", boot);
})();
