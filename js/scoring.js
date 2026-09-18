/* =============================================================
 * CIIT PFT Scorecard System — Scoring & Normative Data
 * -------------------------------------------------------------
 * Pure helper functions that turn raw test results into ratings
 * and useful numbers (BMI, Target Heart Rate zones, etc.).
 * Based on the CIIT PATHFIT 1 PFT Scorecard and lecture deck.
 * ============================================================= */

window.Scoring = (function () {
  // The five-point (5-star) rating scale used across the scorecard.
  // 5 = best. Stored on records as the number (1–5).
  const RATING_SCALE = [
    { value: 5, label: "Excellent" },
    { value: 4, label: "Good" },
    { value: 3, label: "Average" },
    { value: 2, label: "Fair" },
    { value: 1, label: "Needs Improvement" },
  ];

  const RATINGS = RATING_SCALE.map((r) => r.label);

  // Numeric weight of each rating (used for dashboard averages).
  const RATING_POINTS = {
    "Excellent": 5,
    "Good": 4,
    "Average": 3,
    "Fair": 2,
    "Needs Improvement": 1,
    "Poor": 1,
  };

  // Turn a stored rating value into its word label.
  // Accepts a number/numeric string (1–5) or a legacy text label.
  function ratingLabel(value) {
    if (value === null || value === undefined || value === "") return "";
    const n = parseInt(value, 10);
    const found = RATING_SCALE.find((r) => r.value === n);
    return found ? found.label : String(value);
  }

  const num = (v) => {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : null;
  };

  /* ---------------- Age from birthday ---------------- */
  function ageFromBirthday(birthday, asOf) {
    if (!birthday) return null;
    const d = new Date(birthday);
    if (isNaN(d.getTime())) return null;
    const now = asOf ? new Date(asOf) : new Date();
    let age = now.getFullYear() - d.getFullYear();
    const m = now.getMonth() - d.getMonth();
    if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
    return age >= 0 && age < 130 ? age : null;
  }

  /* ---------------- Body Mass Index ---------------- */
  function bmi(weightKg, heightM) {
    const w = num(weightKg);
    const h = num(heightM);
    if (!w || !h) return null;
    return +(w / (h * h)).toFixed(1);
  }

  function bmiClassification(bmiValue) {
    const b = num(bmiValue);
    if (b === null) return "";
    if (b < 18.5) return "Underweight";
    if (b < 25) return "Normal";
    if (b < 30) return "Overweight";
    return "Obese";
  }

  // A colour hint for BMI so the dashboard can show status nicely.
  function bmiTone(classification) {
    switch (classification) {
      case "Normal":
        return "good";
      case "Underweight":
      case "Overweight":
        return "warn";
      case "Obese":
        return "bad";
      default:
        return "muted";
    }
  }

  /* ---------------- Target Heart Rate (from lecture) ----------------
   * MHR = 220 - age
   * HRR = MHR - RHR (Resting Heart Rate)
   * Zone at intensity i% = HRR * i + RHR
   */
  function targetHeartRate(age, restingHR) {
    const a = num(age);
    const rhr = num(restingHR);
    if (!a) return null;
    const mhr = 220 - a;
    const result = { mhr, rhr: rhr };
    if (rhr !== null) {
      const hrr = mhr - rhr;
      result.hrr = hrr;
      result.moderateLow = Math.round(hrr * 0.5 + rhr);
      result.moderateHigh = Math.round(hrr * 0.7 + rhr);
      result.vigorousHigh = Math.round(hrr * 0.85 + rhr);
    }
    return result;
  }

  /* ---------------- Stair Climbing recovery ----------------
   * Records Resting HR (before) and HR after activity.
   * A smaller rise / good recovery suggests better endurance.
   */
  function stairClimb(restingHR, afterHR) {
    const rhr = num(restingHR);
    const ahr = num(afterHR);
    if (rhr === null || ahr === null) return null;
    return { rise: ahr - rhr };
  }

  /* ---------------- T-Cone Agility (seconds) ----------------
   * Male:   Excellent <9.50 | Good 9.51-10.50 | Average 10.51-11.50 | Poor >11.50
   * Female: Excellent <10.50 | Good 10.51-11.50 | Average 11.51-12.50 | Poor >12.50
   */
  function tConeRating(seconds, sex) {
    const s = num(seconds);
    if (s === null) return "";
    const female = String(sex).toLowerCase().startsWith("f");
    const t = female
      ? [10.5, 11.5, 12.5]
      : [9.5, 10.5, 11.5];
    if (s < t[0]) return "Excellent";
    if (s <= t[1]) return "Good";
    if (s <= t[2]) return "Average";
    return "Needs Improvement";
  }

  /* ---------------- Auto evaluations (general fitness norms) ----------------
   * These give each activity a suggested 5-point star rating (5 = best) from
   * widely-used general fitness standards for college-age students, split by
   * sex where the norms differ. They are DEFAULTS — a teacher can override any
   * star. (Note: these are general references, not CIIT's official charts;
   * BMI classification and T-Cone agility use the lecture's own tables.)
   */
  function parseDuration(v) {
    if (v === "" || v == null) return null;
    if (typeof v === "string" && v.includes(":")) {
      const p = v.split(":").map((x) => parseFloat(x));
      if (p.every((n) => Number.isFinite(n))) return p[0] * 60 + (p[1] || 0);
      return null;
    }
    return num(v);
  }

  // thresholds = [t5, t4, t3, t2] (descending). Higher measured value = better.
  function bandHigher(v, t) {
    if (v == null) return null;
    if (v >= t[0]) return 5; if (v >= t[1]) return 4;
    if (v >= t[2]) return 3; if (v >= t[3]) return 2;
    return 1;
  }
  // thresholds = [t5, t4, t3, t2] (ascending). Lower measured value = better.
  function bandLower(v, t) {
    if (v == null) return null;
    if (v <= t[0]) return 5; if (v <= t[1]) return 4;
    if (v <= t[2]) return 3; if (v <= t[3]) return 2;
    return 1;
  }

  /* Official CIIT push-up chart (lecture slide 20) — by age band & sex.
   * Values are the lower bound for each star: [5=Excellent, 4=Above Avg,
   * 3=Average, 2=Below Avg]; anything lower = 1 (Poor). Ages 16+ use 16-19. */
  const PUSHUP_TABLE = {
    male: { "8-9": [13, 9, 5, 1], "10-11": [16, 12, 7, 2], "12-13": [19, 13, 8, 3], "14-15": [26, 18, 10, 4], "16-19": [28, 20, 12, 5] },
    female: { "8-9": [8, 5, 3, 1], "10-11": [10, 7, 4, 1], "12-13": [13, 9, 5, 2], "14-15": [16, 12, 7, 3], "16-19": [19, 13, 8, 4] },
  };
  function ageBand(age) {
    const a = num(age);
    if (a == null) return "16-19"; // default to the college band
    if (a <= 9) return "8-9";
    if (a <= 11) return "10-11";
    if (a <= 13) return "12-13";
    if (a <= 15) return "14-15";
    return "16-19"; // 16-19 and older
  }
  function pushupRating(count, sex, age) {
    const c = num(count);
    if (c == null) return null;
    const female = String(sex || "").toLowerCase().startsWith("f");
    return bandHigher(c, (female ? PUSHUP_TABLE.female : PUSHUP_TABLE.male)[ageBand(age)]);
  }

  function autoRatings(r) {
    const female = String(r.sex || "").toLowerCase().startsWith("f");
    const out = {};
    const set = (key, val) => { if (val != null) out[key] = val; };

    // Cardiovascular — Resting Heart Rate (lower is better)
    set("cardioRating", bandLower(num(r.rhr), female ? [65, 69, 78, 84] : [61, 65, 73, 81]));
    // Muscular Strength — push-ups (official CIIT chart, by age & sex — slide 20)
    set("strengthRating", pushupRating(r.pushups, r.sex, r.age));
    // Muscular Endurance — wall squat hold seconds (higher is better)
    const wallT = female ? [60, 45, 30, 15] : [100, 75, 50, 25];
    set("wallSquatLeftRating", bandHigher(parseDuration(r.wallSquatLeft), wallT));
    set("wallSquatRightRating", bandHigher(parseDuration(r.wallSquatRight), wallT));
    // Muscular Endurance — sit-ups (higher is better)
    set("situpsRating", bandHigher(num(r.situps), female ? [40, 33, 29, 25] : [45, 38, 33, 28]));
    // Flexibility — zipper test overlap(+)/gap(-) in cm (higher is better)
    set("zipperLeftRating", bandHigher(num(r.zipperLeft), [5, 0, -5, -10]));
    set("zipperRightRating", bandHigher(num(r.zipperRight), [5, 0, -5, -10]));
    // Flexibility — sit & reach average cm (higher is better)
    set("sitReachAvgRating", bandHigher(num(r.sitReachAvg), female ? [30, 21, 11, 1] : [27, 17, 6, 0]));
    // Coordination — hand-eye catches (higher is better; lecture catch scale)
    set("coordRating", bandHigher(num(r.handEye), [9, 7, 4, 2]));
    // Speed — shuttle run seconds (lower is better)
    set("speedRating", bandLower(parseDuration(r.shuttleRun), female ? [10.5, 11.5, 12.5, 13.5] : [9.5, 10.5, 11.5, 12.5]));
    // Power — vertical jump best cm (higher is better)
    set("powerRating", bandHigher(num(r.vJumpBest), female ? [46, 36, 26, 16] : [60, 50, 40, 30]));
    // Balance — stork stand seconds (higher is better)
    set("storkLeftRating", bandHigher(parseDuration(r.storkLeft), [50, 40, 25, 10]));
    set("storkRightRating", bandHigher(parseDuration(r.storkRight), [50, 40, 25, 10]));
    // Reaction — ball drop distance cm (lower is better)
    set("reactionRating", bandLower(num(r.ballDropAvg), [7.5, 16, 20.5, 28]));

    return out;
  }

  /* ---------------- Simple math helpers used by the form ---------------- */
  function average(values) {
    const nums = values.map(num).filter((v) => v !== null);
    if (!nums.length) return null;
    return +(nums.reduce((a, b) => a + b, 0) / nums.length).toFixed(2);
  }

  function best(values, mode) {
    const nums = values.map(num).filter((v) => v !== null);
    if (!nums.length) return null;
    return mode === "min" ? Math.min(...nums) : Math.max(...nums);
  }

  function ratingPoints(rating) {
    return RATING_POINTS[rating] || 0;
  }

  return {
    RATINGS,
    RATING_SCALE,
    ratingLabel,
    ageFromBirthday,
    bmi,
    bmiClassification,
    bmiTone,
    targetHeartRate,
    stairClimb,
    tConeRating,
    autoRatings,
    average,
    best,
    ratingPoints,
  };
})();
