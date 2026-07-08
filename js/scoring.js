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
    average,
    best,
    ratingPoints,
  };
})();
