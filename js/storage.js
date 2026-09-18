/* =============================================================
 * CIIT PFT Scorecard System — Local Data Storage
 * -------------------------------------------------------------
 * All records are saved safely inside this browser (localStorage).
 * Nothing is uploaded anywhere. Use Export to make a backup file
 * and Import to restore it or move data to another computer.
 * ============================================================= */

window.Store = (function () {
  const KEY = "ciit_pft_records_v1";
  const ROSTER_KEY = "ciit_pft_roster_v1";
  const CLASS_KEY = "ciit_pft_classes_v1";
  const SETTINGS_KEY = "ciit_pft_settings_v1";

  // Optional listener the app can register to mirror local changes to a shared
  // cloud database. It is only fired for changes made *on this device* — never
  // while applying data received from the cloud (to avoid echo loops).
  let syncHandler = null;
  let applyingRemote = false;
  function setSync(fn) { syncHandler = fn; }
  function notify(type, payload) {
    if (syncHandler && !applyingRemote) {
      try { syncHandler(type, payload); } catch (e) { console.error(e); }
    }
  }

  // Replace local records/classes/settings with a snapshot received from the
  // cloud, without re-broadcasting the change back out.
  function applyRemote(records, classes, settings) {
    applyingRemote = true;
    try {
      if (Array.isArray(records)) _write(records);
      if (Array.isArray(classes)) _writeClasses(classes);
      if (settings && typeof settings === "object") _writeSettings(settings);
    } finally {
      applyingRemote = false;
    }
  }

  function _read() {
    try {
      return JSON.parse(localStorage.getItem(KEY)) || [];
    } catch (e) {
      return [];
    }
  }

  function _write(list) {
    localStorage.setItem(KEY, JSON.stringify(list));
  }

  function uid() {
    return "s_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function all() {
    return _read().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  }

  function get(id) {
    return _read().find((r) => r.id === id) || null;
  }

  function save(record) {
    const list = _read();
    const now = Date.now();
    if (record.id) {
      const idx = list.findIndex((r) => r.id === record.id);
      if (idx >= 0) {
        record.updatedAt = now;
        list[idx] = record;
      } else {
        record.createdAt = now;
        record.updatedAt = now;
        list.push(record);
      }
    } else {
      record.id = uid();
      record.createdAt = now;
      record.updatedAt = now;
      list.push(record);
    }
    _write(list);
    notify("record", record);
    return record;
  }

  function remove(id) {
    _write(_read().filter((r) => r.id !== id));
    notify("record:remove", id);
  }

  function clearAll() {
    _write([]);
  }

  /* ---------------- Student roster (from Google Sheet) ---------------- */
  function getRoster() {
    try {
      const data = JSON.parse(localStorage.getItem(ROSTER_KEY));
      return data && Array.isArray(data.students) ? data : { students: [], syncedAt: null };
    } catch (e) {
      return { students: [], syncedAt: null };
    }
  }

  function setRoster(students) {
    const data = { students: students || [], syncedAt: Date.now() };
    localStorage.setItem(ROSTER_KEY, JSON.stringify(data));
    return data;
  }

  /* ---------------- Shared settings (e.g. teacher list) ---------------- */
  function _writeSettings(obj) {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(obj || {}));
  }
  function getSettings() {
    try {
      return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {};
    } catch (e) {
      return {};
    }
  }
  function setSettings(obj) {
    const data = Object.assign({}, getSettings(), obj || {});
    _writeSettings(data);
    notify("settings", data);
    return data;
  }

  /* ---------------- Classes ---------------- */
  function _readClasses() {
    try {
      return JSON.parse(localStorage.getItem(CLASS_KEY)) || [];
    } catch (e) {
      return [];
    }
  }

  function _writeClasses(list) {
    localStorage.setItem(CLASS_KEY, JSON.stringify(list));
  }

  function classesAll() {
    return _readClasses().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  }

  function classGet(id) {
    return _readClasses().find((c) => c.id === id) || null;
  }

  function classSave(cls) {
    const list = _readClasses();
    const now = Date.now();
    if (cls.id) {
      const idx = list.findIndex((c) => c.id === cls.id);
      if (idx >= 0) { cls.updatedAt = now; list[idx] = cls; }
      else { cls.createdAt = now; cls.updatedAt = now; list.push(cls); }
    } else {
      cls.id = "c_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
      cls.createdAt = now;
      cls.updatedAt = now;
      list.push(cls);
    }
    _writeClasses(list);
    notify("class", cls);
    return cls;
  }

  function classRemove(id) {
    _writeClasses(_readClasses().filter((c) => c.id !== id));
    notify("class:remove", id);
  }

  /* ---------------- Backup (JSON) ---------------- */
  function exportJSON() {
    const data = {
      type: "ciit-pft-backup",
      exportedAt: new Date().toISOString(),
      classes: _readClasses(),
      records: _read(),
    };
    return JSON.stringify(data, null, 2);
  }

  function importJSON(text, mode = "merge") {
    const parsed = JSON.parse(text);
    const incoming = Array.isArray(parsed) ? parsed : parsed.records;
    if (!Array.isArray(incoming)) throw new Error("This file is not a valid backup.");
    let list = mode === "replace" ? [] : _read();
    const byId = new Map(list.map((r) => [r.id, r]));
    incoming.forEach((r) => {
      if (!r.id) r.id = uid();
      byId.set(r.id, r);
    });
    list = Array.from(byId.values());
    _write(list);

    // Classes (only present in newer backups)
    const incomingClasses = Array.isArray(parsed.classes) ? parsed.classes : [];
    let clsList = mode === "replace" ? [] : _readClasses();
    const clsById = new Map(clsList.map((c) => [c.id, c]));
    incomingClasses.forEach((c) => { if (c && c.id) clsById.set(c.id, c); });
    _writeClasses(Array.from(clsById.values()));

    return incoming.length;
  }

  /* ---------------- Spreadsheet (CSV) ---------------- */
  function exportCSV() {
    const rows = _read();
    const cols = [
      ["academicYear", "Academic Year"],
      ["term", "Term"],
      ["fullName", "Name"],
      ["studentNo", "Student No."],
      ["email", "Email"],
      ["course", "Course"],
      ["sectionCode", "Section"],
      ["sex", "Sex"],
      ["age", "Age"],
      ["scheduleDay", "Day"],
      ["scheduleTime", "Time"],
      ["gymWing", "Gym Wing"],
      ["heightM", "Height (m)"],
      ["weightKg", "Weight (kg)"],
      ["bmi", "BMI"],
      ["bmiClass", "BMI Classification"],
      ["rhr", "Resting HR"],
      ["mhrAfter", "HR After"],
      ["pushups", "Push-ups"],
      ["plankTime", "Plank"],
      ["wallSquatLeft", "Wall Squat L"],
      ["wallSquatRight", "Wall Squat R"],
      ["situps", "Sit-ups"],
      ["zipperLeft", "Zipper L (cm)"],
      ["zipperRight", "Zipper R (cm)"],
      ["sitReach1", "Sit & Reach 1 (cm)"],
      ["sitReach2", "Sit & Reach 2 (cm)"],
      ["sitReach3", "Sit & Reach 3 (cm)"],
      ["sitReachAvg", "Sit & Reach Avg (cm)"],
      ["handEye", "Hand-Eye Catches"],
      ["tCone", "T-Cone (s)"],
      ["tConeRating", "T-Cone Rating"],
      ["shuttleRun", "Shuttle Run"],
      ["vJump1", "Vertical Jump 1 (cm)"],
      ["vJump2", "Vertical Jump 2 (cm)"],
      ["vJump3", "Vertical Jump 3 (cm)"],
      ["vJumpBest", "Vertical Jump Best (cm)"],
      ["storkRight", "Stork R"],
      ["storkLeft", "Stork L"],
      ["ballDrop1", "Ball Drop 1 (cm)"],
      ["ballDrop2", "Ball Drop 2 (cm)"],
      ["ballDrop3", "Ball Drop 3 (cm)"],
      ["ballDropAvg", "Ball Drop Avg"],
    ];
    const esc = (v) => {
      const s = v === null || v === undefined ? "" : String(v);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const header = cols.map((c) => esc(c[1])).join(",");
    const lines = rows.map((r) => cols.map((c) => esc(r[c[0]])).join(","));
    return [header, ...lines].join("\n");
  }

  return {
    all,
    get,
    save,
    remove,
    clearAll,
    getRoster,
    setRoster,
    getSettings,
    setSettings,
    classesAll,
    classGet,
    classSave,
    classRemove,
    setSync,
    applyRemote,
    exportJSON,
    importJSON,
    exportCSV,
  };
})();
