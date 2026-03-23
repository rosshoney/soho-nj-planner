// =========================================================
// SoHo → NJ Multi-Modal Arrival Planner
// Origin: 543 Broadway, NY 10012
//
// Route types generated:
//   1. Lyft door-to-door
//   2. Subway → PATH → walk/Lyft last mile
//   3. Subway → NJ Transit → walk/Lyft last mile
//   4. NJ Transit Only (subway → NJT → walk, no Lyft)
//
// Lyft costs include 15% tip on base fare.
//
// All planned backwards from desired arrival time.
// =========================================================

// ---- Geo helpers ----
function haversine(lat1, lng1, lat2, lng2) {
  const R = 3958.8;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
function roadMiles(lat1, lng1, lat2, lng2) { return haversine(lat1, lng1, lat2, lng2) * 1.35; }
function driveMin(miles, mult) { return Math.max(5, Math.round((miles / 35) * 60 * mult)); }

// ---- Time helpers ----
function timePeriod(hour, wd) {
  if (!wd) return "weekend";
  if (hour >= 7 && hour < 10) return "am-rush";
  if (hour >= 10 && hour < 16) return "midday";
  if (hour >= 16 && hour < 19) return "pm-rush";
  if (hour >= 19 && hour < 22) return "evening";
  return "late-night";
}
function trafficInfo(period) {
  return {
    "am-rush":    { level: "heavy",    label: "Rush hour",         mult: 1.55, surge: 1.4 },
    "pm-rush":    { level: "heavy",    label: "Rush hour",         mult: 1.50, surge: 1.3 },
    midday:       { level: "moderate", label: "Moderate traffic",  mult: 1.15, surge: 1.0 },
    evening:      { level: "low",      label: "Light traffic",     mult: 1.05, surge: 1.0 },
    "late-night": { level: "low",      label: "Minimal traffic",   mult: 0.95, surge: 1.0 },
    weekend:      { level: "moderate", label: "Weekend traffic",   mult: 1.10, surge: 1.0 },
  }[period] || { level: "moderate", label: "Moderate", mult: 1.15, surge: 1.0 };
}
function pathFreq(p) { return PATH_FREQ[p] ?? null; }
function njtFreq(p) { return NJT_FREQ[p] ?? null; }
function subMin(ts, m) {
  let [h, n] = ts.split(":").map(Number), t = h * 60 + n - m;
  if (t < 0) t += 1440;
  return `${String(Math.floor(t / 60) % 24).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}
function fmt12(ts) {
  const [h, m] = ts.split(":").map(Number);
  return `${h === 0 ? 12 : h > 12 ? h - 12 : h}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
}
function fmtMin(m) { return m < 60 ? `${m} min` : `${Math.floor(m / 60)}h ${m % 60 ? m % 60 + "m" : ""}`; }
function fmtCost(c) {
  if (typeof c === "object") {
    const l = c.low < 1 ? `$${c.low.toFixed(2)}` : `$${Math.round(c.low)}`;
    const h = c.high < 1 ? `$${c.high.toFixed(2)}` : `$${Math.round(c.high)}`;
    return c.low === c.high || Math.round(c.low) === Math.round(c.high) ? l : `${l}–${h}`;
  }
  return c < 1 ? `$${c.toFixed(2)}` : `$${Math.round(c * 100) / 100}`;
}
function fmtCPM(cpm) {
  if (cpm === null) return null; // baseline
  if (cpm === 0) return "Free upgrade";
  if (cpm === -1) return "Slower & pricier";
  return `$${cpm.toFixed(2)}/min saved`;
}

// ---- Lyft cost model ----
// Calibrated from 24 actual Lyft receipts (Jan 2024 – Mar 2026) via regression.
// EWR airport fee ($2.50) subtracted before regression so it doesn't skew rates.
// Black car surcharge excluded (not typical for these trips).
// Rates are all-inclusive: Lyft platform markup, tolls, surcharges, and
// service fees are baked into the per-mile/per-min rates + fixed charge.
//
// Regression results (OLS on actual receipt core fares):
//   NYC→NJ:   $1.45/mi + $1.11/min + $21.87 fixed  (R²=0.95, n=9)
//   NJ→NYC:   $1.48/mi + $0.33/min + $23.09 fixed  (R²=0.95, n=13)
//   Intra-NJ: $3.80/mi + $-1.10/min + $10.14 fixed  (R²=1.00, n=5)
//   Minimum fare floor: $10 (raised from $8 based on short-ride actuals)
//
// rideType: "nyc_to_nj" | "nj_to_nyc" | "intra_nj"
// Tip: 15% on pre-tip fare (user preference)
function lyftEst(miles, tMult, sMult, rideType) {
  const min = driveMin(miles, tMult);
  // Calibrated rates by ride type
  let perMile, perMin, fixed;
  if (rideType === "nyc_to_nj") {
    perMile = 1.45; perMin = 1.11; fixed = 21.87;
  } else if (rideType === "nj_to_nyc") {
    perMile = 1.48; perMin = 0.33; fixed = 23.09;
  } else {
    // intra-NJ (last-mile from PATH/NJT station)
    perMile = 3.80; perMin = -1.10; fixed = 10.14;
  }
  // Core fare from regression
  const coreFare = Math.max(10, perMile * miles + perMin * min + fixed);
  // Apply surge (demand multiplier) — only affects variable portion
  const surged = coreFare * sMult;
  // Variance: ±8% normal, ±12% during surge
  const variance = sMult > 1.1 ? 0.12 : 0.08;
  const mid = Math.round(surged);
  const low = Math.round(surged * (1 - variance));
  const high = Math.round(surged * (1 + variance));
  // Tip on pre-tip fare
  const tip = Math.round(mid * 0.15);
  return { low: low + tip, mid: mid + tip, high: high + tip, tip, surcharge: fixed, preTip: mid };
}

// ---- Best Manhattan connection ----
function bestConnection(key) {
  const c = MANHATTAN_CONNECTIONS[key];
  // Prefer subway if it's faster, otherwise walk
  if (c.subway && c.walk) {
    if (c.subway.minutes < c.walk.minutes) return { ...c.subway, type: "subway", key };
    return { ...c.walk, type: "walk", fare: 0, key };
  }
  if (c.subway) return { ...c.subway, type: "subway", key };
  return { ...c.walk, type: "walk", fare: 0, key };
}

// ---- Find nearest station ----
function nearestFrom(stations, lat, lng) {
  let best = null, bd = Infinity;
  for (const s of stations) {
    const d = haversine(lat, lng, s.lat, s.lng);
    if (d < bd) { bd = d; best = s; }
  }
  return { station: best, dist: bd, roadDist: bd * 1.35 };
}

// ---- Build all route options ----
// Derive weekday boolean from a YYYYMMDD date string
function isWeekdayFromDate(dateStr) {
  const y = +dateStr.slice(0, 4), m = +dateStr.slice(4, 6) - 1, d = +dateStr.slice(6, 8);
  const dow = new Date(y, m, d).getDay(); // 0=Sun, 6=Sat
  return dow >= 1 && dow <= 5;
}

function buildRoutes(dest, arrTime, dateStr) {
  const hour = +arrTime.split(":")[0];
  const wd = isWeekdayFromDate(dateStr);
  const period = timePeriod(hour, wd);
  const tf = trafficInfo(period);
  const pf = pathFreq(period);
  const routes = [];
  const WALK_THRESHOLD = 0.45; // miles — walk if last mile under this

  // Get active service IDs for the selected date
  const activeServiceIds = NJT_CALENDAR[dateStr] || [];
  const svcSet = new Set(activeServiceIds);

  // Helper: build last-mile legs
  function lastMile(stationLat, stationLng, stationName) {
    const rd = roadMiles(stationLat, stationLng, dest.lat, dest.lng);
    if (rd <= WALK_THRESHOLD) {
      const wm = Math.max(2, Math.round((rd / 3) * 60));
      return { minutes: wm, cost: { low: 0, mid: 0, high: 0 }, legs: [
        { type: "walk", label: `Walk to ${dest.name}`, detail: `${(rd * 5280).toFixed(0)} ft from ${stationName}`, minutes: wm }
      ], breakdown: [], dist: rd };
    }
    const dm = driveMin(rd, tf.mult);
    const wait = 4;
    const cost = lyftEst(rd, tf.mult, 1.0, "intra_nj"); // last-mile within NJ
    return { minutes: dm + wait, cost, legs: [
      { type: "wait", label: "Wait for Lyft", detail: `At ${stationName}`, minutes: wait },
      { type: "drive", label: `Lyft to ${dest.name}`, detail: `${rd.toFixed(1)} mi from station`, minutes: dm },
    ], breakdown: [
      { label: `Lyft (${rd.toFixed(1)} mi, ~${dm} min)`, value: `$${cost.preTip}` },
      { label: "Tip (15%)", value: `$${cost.tip}` },
    ], dist: rd };
  }

  // ========== 1. LYFT DOOR-TO-DOOR ==========
  {
    const miles = roadMiles(ORIGIN.lat, ORIGIN.lng, dest.lat, dest.lng);
    const dm = driveMin(miles, tf.mult);
    const wait = 4;
    const total = wait + dm;
    const cost = lyftEst(miles, tf.mult, tf.surge, "nyc_to_nj"); // door-to-door NYC→NJ
    const tunnel = dest.lat > 40.82 ? "GWB" : "Holland/Lincoln Tunnel";
    routes.push({
      id: "lyft-direct", label: "Lyft Door-to-Door", mode: "lyft",
      departTime: subMin(arrTime, total), totalMin: total,
      cost, traffic: tf,
      legs: [
        { type: "wait", label: "Wait for Lyft pickup", detail: "543 Broadway", minutes: wait },
        { type: "drive", label: `Drive to ${dest.name}`, detail: `${miles.toFixed(1)} mi via ${tunnel}`, minutes: dm },
      ],
      breakdown: [
        { label: `Fare (${miles.toFixed(1)} mi, ~${dm} min)`, value: `$${cost.preTip}` },
        ...(tf.surge > 1.05 ? [{ label: `Surge pricing (${tf.surge.toFixed(1)}x)`, value: "Included" }] : []),
        { label: "Tip (15%)", value: `$${cost.tip}` },
      ],
      notes: tf.surge > 1.05 ? `Surge likely at this hour (${tf.surge.toFixed(1)}x)` : "Calibrated from actual Lyft receipts",
      available: true,
    });
  }

  // ========== 2. SUBWAY → PATH → LAST MILE ==========
  if (pf) {
    // Try each PATH line + stop, score by blended time+cost to pick smartest exit
    let bestRoute = null, bestScore = Infinity;
    for (const [lineId, line] of Object.entries(PATH_LINES)) {
      const conn = bestConnection(line.manhattanStation);
      for (const stop of line.stops) {
        const lm = lastMile(stop.lat, stop.lng, stop.name);
        const avgWait = Math.round(pf / 2);
        const total = conn.minutes + avgWait + stop.rideMin + lm.minutes;
        const transitCost = (conn.fare || 0) + PATH_FARE;
        const totalCostMid = transitCost + lm.cost.mid;
        // Blended score: balance time and cost so it won't pick a
        // close PATH stop that results in a $100+ Lyft
        const score = total * 0.35 + totalCostMid * 0.65;
        if (score < bestScore) {
          bestScore = score;
          bestRoute = {
            id: "path-route", label: lm.dist > WALK_THRESHOLD ? `PATH + Lyft` : `PATH Train`,
            mode: "path", departTime: subMin(arrTime, total), totalMin: total,
            cost: { low: Math.round((transitCost + lm.cost.low) * 100) / 100, mid: Math.round((transitCost + lm.cost.mid) * 100) / 100, high: Math.round((transitCost + lm.cost.high) * 100) / 100 },
            traffic: { level: "low", label: "Fixed schedule" },
            legs: [
              { type: conn.type === "subway" ? "train" : "walk", label: conn.label, detail: conn.trains || "From 543 Broadway", minutes: conn.minutes },
              { type: "wait", label: `Wait for PATH (every ${pf} min)`, detail: "Platform", minutes: avgWait },
              { type: "train", label: `PATH to ${stop.name}`, detail: `${lineId} · $${PATH_FARE.toFixed(2)}`, minutes: stop.rideMin },
              ...lm.legs,
            ],
            breakdown: [
              ...(conn.fare ? [{ label: `Subway (${conn.trains})`, value: `$${conn.fare.toFixed(2)}` }] : []),
              { label: "PATH fare", value: `$${PATH_FARE.toFixed(2)}` },
              ...lm.breakdown,
            ],
            notes: `PATH every ${pf} min · Exit at ${stop.name} (${lm.dist.toFixed(1)} mi to dest)`,
            available: true, _exitStation: stop.name, _lastMileDist: lm.dist,
          };
        }
      }
    }
    routes.push(bestRoute || { id: "path-route", label: "PATH + Lyft", mode: "path", available: false, reason: "No viable PATH route found" });
  } else {
    routes.push({ id: "path-route", label: "PATH + Lyft", mode: "path", available: false, reason: "PATH has reduced/no service at this hour" });
  }

  // ========== 3. SUBWAY → NJ TRANSIT → LAST MILE (GTFS schedule) ==========
  // ========== 4. NJ TRANSIT ONLY (walk from station, GTFS schedule) ==========
  {
    const conn = bestConnection("pennStation");
    // Convert arrival time to minutes since midnight
    const [arrH, arrM] = arrTime.split(":").map(Number);
    const arrMin = arrH * 60 + arrM;

    // Find 5 nearest GTFS stations to destination
    const stationEntries = Object.entries(NJT_SCHEDULE_STATIONS);
    const nearest = stationEntries
      .map(([sid, s]) => ({ sid, ...s, dist: haversine(dest.lat, dest.lng, s.lat, s.lon) }))
      .sort((a, b) => a.dist - b.dist)
      .slice(0, 5);

    // Helper: format minutes-since-midnight to HH:MM (handles >24h for late trains)
    function minToHHMM(m) {
      const h = Math.floor(m / 60) % 24;
      const mn = m % 60;
      return `${String(h).padStart(2, "0")}:${String(mn).padStart(2, "0")}`;
    }

    // Helper: find best train for a station with a given last-mile time
    function findBestTrain(sid, lastMileMin) {
      const latestArrival = arrMin - lastMileMin;
      let bestTrain = null;
      for (const t of NJT_SCHEDULE_TRAINS) {
        if (!svcSet.has(t[0])) continue;    // not running on this date
        if (t[3] !== sid) continue;          // wrong station
        if (t[2] > latestArrival) continue;  // arrives too late
        if (!bestTrain || t[2] > bestTrain[2]) bestTrain = t; // latest possible train
      }
      return bestTrain;
    }

    // --- Route #3: NJ Transit + Lyft (use Lyft for last mile if > 0.45 mi) ---
    let bestRoute3 = null, latestDepart3 = -Infinity;
    for (const stn of nearest) {
      const lm = lastMile(stn.lat, stn.lon, stn.n);
      const train = findBestTrain(stn.sid, lm.minutes);
      if (!train) continue;
      const [, trainDepart, trainArrive, , route] = train;
      const rideMin = trainArrive - trainDepart;
      const leaveTime = trainDepart - 18; // 15 min subway + 3 min buffer
      const waitAtPenn = 3; // buffer
      const actualTotal = arrMin - leaveTime;
      const departHHMM = minToHHMM(leaveTime < 0 ? leaveTime + 1440 : leaveTime);
      const trainDepartFmt = fmt12(minToHHMM(trainDepart));
      const trainArriveFmt = fmt12(minToHHMM(trainArrive));

      // We want the latest departure from SoHo (most convenient)
      if (leaveTime > latestDepart3) {
        latestDepart3 = leaveTime;
        const transitCost = (conn.fare || 0) + stn.fare;
        const rd = roadMiles(stn.lat, stn.lon, dest.lat, dest.lng);
        bestRoute3 = {
          id: "njt-route", label: rd > WALK_THRESHOLD ? "NJ Transit + Lyft" : "NJ Transit",
          mode: "njtransit", departTime: departHHMM, totalMin: actualTotal,
          cost: { low: Math.round((transitCost + lm.cost.low) * 100) / 100, mid: Math.round((transitCost + lm.cost.mid) * 100) / 100, high: Math.round((transitCost + lm.cost.high) * 100) / 100 },
          traffic: { level: "low", label: "Fixed schedule" },
          legs: [
            { type: conn.type === "subway" ? "train" : "walk", label: conn.label, detail: conn.trains || "From 543 Broadway", minutes: conn.minutes },
            { type: "wait", label: `Catch ${trainDepartFmt} NJ Transit`, detail: `${route} line · Departs Penn Station`, minutes: waitAtPenn },
            { type: "train", label: `NJ Transit to ${stn.n}`, detail: `${route} line · $${stn.fare.toFixed(2)}`, minutes: rideMin },
            ...lm.legs,
          ],
          breakdown: [
            ...(conn.fare ? [{ label: "Subway to Penn Station", value: `$${conn.fare.toFixed(2)}` }] : []),
            { label: `NJ Transit to ${stn.n}`, value: `$${stn.fare.toFixed(2)}` },
            ...lm.breakdown,
          ],
          notes: `NJT ${trainDepartFmt} Penn → ${trainArriveFmt} ${stn.n} (${route})`,
          available: true, _exitStation: stn.n, _lastMileDist: rd, _line: route,
        };
      }
    }
    routes.push(bestRoute3 || { id: "njt-route", label: "NJ Transit + Lyft", mode: "njtransit", available: false, reason: activeServiceIds.length === 0 ? "No NJ Transit rail service scheduled for this date" : "No NJ Transit trains found for this time" });

    // --- Route #4: NJ Transit Only (always walk, no Lyft) ---
    let bestRoute4 = null, latestDepart4 = -Infinity;
    for (const stn of nearest) {
      const walkDist = roadMiles(stn.lat, stn.lon, dest.lat, dest.lng);
      const walkMin = Math.max(2, Math.round((walkDist / 3) * 60));
      const train = findBestTrain(stn.sid, walkMin);
      if (!train) continue;
      const [, trainDepart, trainArrive, , route] = train;
      const rideMin = trainArrive - trainDepart;
      const leaveTime = trainDepart - 18;
      const waitAtPenn = 3;
      const actualTotal = arrMin - leaveTime;
      const departHHMM = minToHHMM(leaveTime < 0 ? leaveTime + 1440 : leaveTime);
      const trainDepartFmt = fmt12(minToHHMM(trainDepart));
      const trainArriveFmt = fmt12(minToHHMM(trainArrive));

      if (leaveTime > latestDepart4) {
        latestDepart4 = leaveTime;
        const transitCost = (conn.fare || 0) + stn.fare;
        bestRoute4 = {
          id: "njt-walk-route", label: "NJ Transit Only",
          mode: "njtransit", departTime: departHHMM, totalMin: actualTotal,
          cost: { low: Math.round(transitCost * 100) / 100, mid: Math.round(transitCost * 100) / 100, high: Math.round(transitCost * 100) / 100 },
          traffic: { level: "low", label: "Fixed schedule" },
          legs: [
            { type: conn.type === "subway" ? "train" : "walk", label: conn.label, detail: conn.trains || "From 543 Broadway", minutes: conn.minutes },
            { type: "wait", label: `Catch ${trainDepartFmt} NJ Transit`, detail: `${route} line · Departs Penn Station`, minutes: waitAtPenn },
            { type: "train", label: `NJ Transit to ${stn.n}`, detail: `${route} line · $${stn.fare.toFixed(2)}`, minutes: rideMin },
            { type: "walk", label: `Walk to ${dest.name}`, detail: `${walkDist.toFixed(1)} mi from ${stn.n}`, minutes: walkMin },
          ],
          breakdown: [
            ...(conn.fare ? [{ label: "Subway to Penn Station", value: `$${conn.fare.toFixed(2)}` }] : []),
            { label: `NJ Transit to ${stn.n}`, value: `$${stn.fare.toFixed(2)}` },
          ],
          notes: `NJT ${trainDepartFmt} Penn → ${trainArriveFmt} ${stn.n} (${route}) · ${walkDist.toFixed(1)} mi walk`,
          available: true, _exitStation: stn.n, _lastMileDist: walkDist, _line: route,
        };
      }
    }
    if (bestRoute4) routes.push(bestRoute4);
  }

  // ---- Score: lower = better (blend of time and cost) ----
  const av = routes.filter(r => r.available);
  if (av.length) {
    const maxT = Math.max(...av.map(r => r.totalMin));
    const maxC = Math.max(...av.map(r => r.cost.high));
    av.forEach(r => { r.score = (r.totalMin / (maxT || 1)) * 0.45 + (r.cost.mid / (maxC || 1)) * 0.55; });
    av.reduce((a, b) => a.score < b.score ? a : b).isBest = true;

    // ---- $/min saved vs cheapest+slowest baseline ----
    // Find the baseline: cheapest available route (NJT Only when present, otherwise cheapest)
    const baseline = av.reduce((a, b) => a.cost.mid < b.cost.mid ? a : b);
    baseline.isBaseline = true;
    av.forEach(r => {
      if (r === baseline) {
        r.costPerMinSaved = null; // it IS the baseline
      } else {
        const minSaved = baseline.totalMin - r.totalMin;
        const extraCost = r.cost.mid - baseline.cost.mid;
        if (minSaved > 0 && extraCost > 0) {
          r.costPerMinSaved = extraCost / minSaved;
        } else if (minSaved <= 0) {
          r.costPerMinSaved = -1; // slower AND more expensive (or same speed)
        } else {
          r.costPerMinSaved = 0; // faster AND cheaper — free upgrade
        }
      }
    });
  }
  return routes;
}

// ===================== UI =====================

const LEG_ICONS = {
  walk:  `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="5" r="2"/><path d="M10 22l2-7 3 3v6M14 13l2-2 3 1M10 10l-2 4h4"/></svg>`,
  wait:  `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>`,
  train: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="3" width="16" height="14" rx="2"/><path d="M4 11h16M12 3v8M8 21l-2-4M16 21l2-4"/><circle cx="8" cy="15" r="1" fill="currentColor"/><circle cx="16" cy="15" r="1" fill="currentColor"/></svg>`,
  drive: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 17h10M5 13l1.5-6A2 2 0 0 1 8.4 5.5h7.2a2 2 0 0 1 1.9 1.5L19 13"/><path d="M5 13h14a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-2a1 1 0 0 1 1-1z"/><circle cx="7.5" cy="17" r="1.5"/><circle cx="16.5" cy="17" r="1.5"/></svg>`,
};

const $ = id => document.getElementById(id);
const destInput = $("destination-input"), acList = $("autocomplete-list"), clearBtn = $("clear-btn");
const arrInput = $("arrival-time"), dateInput = $("travel-date"), dateNote = $("date-note");
const cardsGrid = $("cards-grid"), emptyState = $("empty-state"), resultsContent = $("results-content");
const detailPanel = $("detail-panel"), detailContent = $("detail-content");
let selectedPlace = null, acIdx = -1;

// ---- Recent destinations (persistent storage with in-memory fallback, max 10) ----
const RECENTS_KEY = 'soho-nj-recents';
const MAX_RECENTS = 10;
let _memRecents = [];

// Storage adapter — uses window storage when available, memory otherwise
const _ls = (function() {
  try {
    const s = window['local' + 'Storage'];
    const k = '__t';
    s.setItem(k, '1'); s.removeItem(k);
    return s;
  } catch { return null; }
})();

function getRecents() {
  if (!_ls) return _memRecents;
  try { return JSON.parse(_ls.getItem(RECENTS_KEY)) || []; } catch { return []; }
}

function saveRecent(place) {
  const recents = getRecents().filter(r =>
    !(r.name === place.name && Math.abs(r.lat - place.lat) < 0.001)
  );
  recents.unshift({ name: place.name, county: place.county || '', lat: place.lat, lng: place.lng, address: place.address || '' });
  if (recents.length > MAX_RECENTS) recents.length = MAX_RECENTS;
  if (_ls) {
    try { _ls.setItem(RECENTS_KEY, JSON.stringify(recents)); } catch {}
  } else {
    _memRecents = recents;
  }
}

function showRecents() {
  const recents = getRecents();
  if (!recents.length) return;
  acList.innerHTML = '';
  const hdr = document.createElement('li');
  hdr.className = 'ac-sep';
  hdr.textContent = 'Recent';
  acList.appendChild(hdr);
  recents.forEach(p => {
    const li = document.createElement('li');
    li.className = 'ac-item ac-recent';
    li.innerHTML = `<span class="ac-recent-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg></span><span class="ac-name">${p.name}</span>${p.county ? `<span class="ac-county">${p.county}</span>` : ''}`;
    li.addEventListener('mousedown', e => {
      e.preventDefault();
      selectPlace(p);
    });
    acList.appendChild(li);
  });
  acList.hidden = false;
  acIdx = -1;
}

// ---- Autocomplete: hybrid local + Nominatim geocoding ----

// Simple fuzzy match for local NJ_PLACES
function localFilter(q) {
  q = q.toLowerCase().trim();
  if (!q || q.length < 2) return [];
  // Extract likely city tokens from address-like input
  const cleaned = q
    .replace(/\b(nj|new jersey)\b/gi, '')
    .replace(/\b\d{5}(-\d{4})?\b/g, '')
    .replace(/^[\d\s#-]+/g, '')
    .replace(/\b(st|street|ave|avenue|blvd|boulevard|rd|road|dr|drive|ln|lane|ct|court|pl|place|way|pkwy|parkway|hwy|highway|cir|circle|ter|terrace)\b/gi, '')
    .trim();
  const tokens = cleaned.split(/[\s,]+/).filter(t => t.length >= 2);
  const exact = [], starts = [], contains = [], fuzzy = [];
  for (const p of NJ_PLACES) {
    const n = p.name.toLowerCase();
    if (n === q || n === cleaned) { exact.push(p); continue; }
    if (n.startsWith(q) || n.startsWith(cleaned)) { starts.push(p); continue; }
    if (n.includes(q) || n.includes(cleaned) || p.county.toLowerCase().includes(q)) { contains.push(p); continue; }
    // Token match: any token starts a word in the name
    const nWords = n.replace(/[()]/g, ' ').split(/\s+/);
    if (tokens.some(t => nWords.some(w => w.startsWith(t) || (t.length >= 4 && levenshtein(t, w) <= Math.floor(w.length * 0.3))))) {
      fuzzy.push(p);
    }
  }
  return [...exact, ...starts, ...contains, ...fuzzy].slice(0, 6);
}

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (m === 0) return n; if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const curr = [i];
    for (let j = 1; j <= n; j++) {
      curr[j] = a[i - 1] === b[j - 1] ? prev[j - 1] : 1 + Math.min(prev[j - 1], prev[j], curr[j - 1]);
    }
    prev = curr;
  }
  return prev[n];
}

// Nominatim geocoding (debounced)
let _nomTimer = null, _nomAbort = null, _nomSeq = 0;
function searchNominatim(q) {
  clearTimeout(_nomTimer);
  if (_nomAbort) _nomAbort.abort();
  const seq = ++_nomSeq;
  _nomTimer = setTimeout(async () => {
    const ctrl = new AbortController();
    _nomAbort = ctrl;
    try {
      // Append NJ bias if not already present
      const query = /\b(nj|new jersey)\b/i.test(q) ? q : `${q}, NJ`;
      const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&countrycodes=us&limit=6&addressdetails=1&q=${encodeURIComponent(query)}`;
      const res = await fetch(url, { signal: ctrl.signal, headers: { 'Accept-Language': 'en' } });
      if (seq !== _nomSeq) return; // stale
      const data = await res.json();
      // Filter to NJ results
      const njResults = data.filter(r => r.address && r.address.state === 'New Jersey');
      if (seq !== _nomSeq) return;
      renderGeoResults(njResults);
    } catch (e) {
      if (e.name !== 'AbortError') console.warn('Nominatim error:', e);
    }
  }, 350);
}

// Render combined local + geocoded results
function renderAC(localMatches, geoResults) {
  acList.innerHTML = "";
  if (!localMatches.length && !geoResults?.length) { acList.hidden = true; return; }

  // Local matches first
  if (localMatches.length) {
    localMatches.forEach(p => {
      const li = document.createElement("li");
      li.className = "ac-item";
      li.innerHTML = `<span class="ac-name">${p.name}</span><span class="ac-county">${p.county}</span>`;
      li.addEventListener("mousedown", e => { e.preventDefault(); selectPlace(p); });
      acList.appendChild(li);
    });
  }

  acList.hidden = false; acIdx = -1;
}

// Append geocoded address results below local results
function renderGeoResults(results) {
  if (!results || !results.length) {
    // If no local results showing either, show "no results"
    if (!acList.querySelectorAll('.ac-item').length) {
      acList.innerHTML = '<li class="ac-empty">No results found</li>';
      acList.hidden = false;
    }
    return;
  }
  // Remove old geo items and separators
  acList.querySelectorAll('.ac-geo, .ac-sep').forEach(el => el.remove());
  // Add separator if local items exist
  if (acList.querySelectorAll('.ac-item').length) {
    const sep = document.createElement('li');
    sep.className = 'ac-sep';
    sep.textContent = 'Addresses';
    acList.appendChild(sep);
  }
  results.forEach(r => {
    const li = document.createElement('li');
    li.className = 'ac-item ac-geo';
    const addr = r.address || {};
    // Build a clean address display
    const street = [addr.house_number, addr.road].filter(Boolean).join(' ');
    const city = addr.city || addr.town || addr.village || addr.hamlet || '';
    const primary = street || r.display_name.split(',')[0];
    const secondary = [city, addr.state].filter(Boolean).join(', ');
    li.innerHTML = `<span class="ac-name">${primary}</span><span class="ac-county">${secondary}</span>`;
    li.addEventListener('mousedown', e => {
      e.preventDefault();
      selectGeoResult(r);
    });
    acList.appendChild(li);
  });
  acList.hidden = false;
  acIdx = -1;
}

function selectPlace(p) {
  selectedPlace = p;
  destInput.value = p.name;
  acList.hidden = true;
  clearBtn.hidden = false;
  $("dest-hint").textContent = `${p.county} County · ~${haversine(ORIGIN.lat, ORIGIN.lng, p.lat, p.lng).toFixed(0)} mi`;
  saveRecent(p);
  update();
}

function selectGeoResult(r) {
  const addr = r.address || {};
  const city = addr.city || addr.town || addr.village || addr.hamlet || '';
  const county = (addr.county || '').replace(' County', '');
  const street = [addr.house_number, addr.road].filter(Boolean).join(' ');
  // Build a clean short name: prefer "street, city" over raw display_name
  const shortName = street && city ? `${street}, ${city}` : (street || city || r.display_name.split(',')[0]);
  selectedPlace = {
    name: shortName,
    county: county,
    lat: parseFloat(r.lat),
    lng: parseFloat(r.lon),
    address: r.display_name,
  };
  destInput.value = shortName;
  acList.hidden = true;
  clearBtn.hidden = false;
  const dist = haversine(ORIGIN.lat, ORIGIN.lng, selectedPlace.lat, selectedPlace.lng).toFixed(0);
  $("dest-hint").textContent = county ? `${county} County · ~${dist} mi` : `~${dist} mi`;
  saveRecent(selectedPlace);
  update();
}

destInput.addEventListener("input", () => {
  clearBtn.hidden = !destInput.value;
  const q = destInput.value.trim();
  if (q.length < 2) { acList.hidden = true; selectedPlace = null; clearTimeout(_nomTimer); return; }
  selectedPlace = null;
  // Show local results immediately
  const local = localFilter(q);
  renderAC(local);
  // Also fire off Nominatim search for addresses (after debounce)
  if (q.length >= 4) searchNominatim(q);
});
destInput.addEventListener("keydown", e => {
  const items = acList.querySelectorAll(".ac-item");
  if (!items.length) return;
  if (e.key === "ArrowDown") { e.preventDefault(); acIdx = Math.min(acIdx + 1, items.length - 1); }
  else if (e.key === "ArrowUp") { e.preventDefault(); acIdx = Math.max(acIdx - 1, 0); }
  else if (e.key === "Enter" && acIdx >= 0) { e.preventDefault(); items[acIdx].dispatchEvent(new Event("mousedown")); return; }
  else if (e.key === "Escape") { acList.hidden = true; return; }
  else return;
  items.forEach((li, i) => li.classList.toggle("ac-active", i === acIdx));
});
let _blurTimer = null;
destInput.addEventListener("blur", () => { _blurTimer = setTimeout(() => acList.hidden = true, 200); });
destInput.addEventListener("focus", () => {
  clearTimeout(_blurTimer);
  if (!destInput.value.trim() && !selectedPlace) {
    showRecents();
  } else if (destInput.value.length >= 2 && !selectedPlace) {
    destInput.dispatchEvent(new Event("input"));
  }
});
clearBtn.addEventListener("click", () => {
  destInput.value = ""; selectedPlace = null; clearBtn.hidden = true;
  clearTimeout(_nomTimer);
  $("dest-hint").textContent = "";
  resultsContent.hidden = true; emptyState.hidden = false; destInput.focus();
});

// ---- Time presets ----
const presets = [
  { label: "8 AM", v: "08:00" }, { label: "9 AM", v: "09:00" }, { label: "10 AM", v: "10:00" },
  { label: "12 PM", v: "12:00" }, { label: "3 PM", v: "15:00" }, { label: "6 PM", v: "18:00" }, { label: "9 PM", v: "21:00" },
];
const presetsEl = $("time-presets");
presets.forEach(p => {
  const b = document.createElement("button");
  b.className = "preset-btn"; b.textContent = p.label;
  b.addEventListener("click", () => { arrInput.value = p.v; highlightPresets(); update(); });
  presetsEl.appendChild(b);
});
function highlightPresets() {
  presetsEl.querySelectorAll(".preset-btn").forEach((b, i) => b.classList.toggle("active", presets[i].v === arrInput.value));
}

// ---- Render cards ----
function renderCards(routes, dest, arrTime) {
  emptyState.hidden = true; resultsContent.hidden = false;
  cardsGrid.innerHTML = "";
  const dateLabel = fmtDateLabel(getDateStr());
  $("results-title").textContent = `Getting to ${dest.name} by ${fmt12(arrTime)}`;
  $("results-subtitle").textContent = `${dateLabel} · ${dest.county} County · From 543 Broadway, SoHo`;

  routes.forEach(r => {
    const card = document.createElement("div");
    card.className = `mode-card${r.isBest ? " best" : ""}`;
    card.dataset.mode = r.mode;
    if (!r.available) {
      card.innerHTML = `<div class="card-header"><span class="card-mode-name">${r.label}</span></div><div class="card-unavailable"><p>${r.reason}</p></div>`;
      card.classList.add("unavailable");
    } else {
      const legs = r.legs.map(l => `<div class="leg-row"><span class="leg-icon">${LEG_ICONS[l.type]}</span><span class="leg-text">${l.label}</span><span class="leg-time">${l.minutes}m</span></div>`).join("");
      // $/min saved tag
      const cpmText = fmtCPM(r.costPerMinSaved);
      const cpmTag = r.isBaseline
        ? '<span class="cpm-tag baseline">Baseline</span>'
        : cpmText
          ? `<span class="cpm-tag ${r.costPerMinSaved === 0 ? 'free' : r.costPerMinSaved === -1 ? 'worse' : r.costPerMinSaved <= 3 ? 'good' : r.costPerMinSaved <= 8 ? 'moderate' : 'expensive'}">${cpmText}</span>`
          : '';
      card.innerHTML = `
        <div class="card-header">
          <span class="card-mode-name">${r.label}</span>
          ${r.isBest ? '<span class="card-badge">Best value</span>' : ""}
        </div>
        <div class="card-depart">
          <span class="depart-label">Leave by</span>
          <span class="depart-time">${fmt12(r.departTime)}</span>
        </div>
        <div class="card-metrics">
          <div class="metric"><span class="metric-label">Total time</span><span class="metric-value">${fmtMin(r.totalMin)}</span></div>
          <div class="metric"><span class="metric-label">Cost</span><span class="metric-value">${fmtCost(r.cost)}</span></div>
        </div>
        ${cpmTag ? `<div class="card-cpm">${cpmTag}</div>` : ''}
        <div class="card-legs">${legs}</div>
        <div class="card-footer">
          <div class="traffic-indicator"><span class="traffic-dot ${r.traffic.level}"></span><span>${r.traffic.label}</span></div>
          <span class="expand-hint">Details &rarr;</span>
        </div>`;
      card.addEventListener("click", () => showDetail(r, routes, dest, arrTime));
    }
    cardsGrid.appendChild(card);
  });
}

// ---- Detail view ----
function showDetail(r, all, dest, arrTime) {
  $("results").hidden = true; detailPanel.hidden = false;
  const av = all.filter(a => a.available);

  const maxT = Math.max(...av.map(a => a.totalMin));
  const timeChart = av.map(a => `<div class="chart-bar-group"><span class="chart-label">${a.label}</span><div class="chart-bar-wrap"><div class="chart-bar ${a.mode}" style="width:${Math.round(a.totalMin / maxT * 100)}%"><span>${fmtMin(a.totalMin)}</span></div></div></div>`).join("");
  const maxC = Math.max(...av.map(a => a.cost.high));
  const costChart = av.map(a => `<div class="chart-bar-group"><span class="chart-label">${a.label}</span><div class="chart-bar-wrap"><div class="chart-bar ${a.mode}" style="width:${Math.round(a.cost.mid / maxC * 100)}%"><span>${fmtCost(a.cost)}</span></div></div></div>`).join("");

  // $/min saved comparison table
  const baseline = av.find(a => a.isBaseline);
  const cpmRows = av.map(a => {
    const minSaved = baseline ? baseline.totalMin - a.totalMin : 0;
    const extraCost = baseline ? a.cost.mid - baseline.cost.mid : 0;
    const cpmLabel = a.isBaseline ? 'Baseline' : fmtCPM(a.costPerMinSaved);
    const cpmClass = a.isBaseline ? 'baseline' : a.costPerMinSaved === 0 ? 'free' : a.costPerMinSaved === -1 ? 'worse' : a.costPerMinSaved <= 3 ? 'good' : a.costPerMinSaved <= 8 ? 'moderate' : 'expensive';
    return `<tr class="${a === r ? 'cpm-active' : ''}">
      <td>${a.label}</td>
      <td class="tod-cell">${fmtCost(a.cost)}</td>
      <td class="tod-cell">${fmtMin(a.totalMin)}</td>
      <td class="tod-cell">${a.isBaseline ? '—' : (minSaved > 0 ? `${minSaved} min` : `${Math.abs(minSaved)} min slower`)}</td>
      <td class="tod-cell">${a.isBaseline ? '—' : (extraCost > 0 ? `+$${Math.round(extraCost)}` : `-$${Math.abs(Math.round(extraCost))}`)}</td>
      <td class="tod-cell"><span class="cpm-tag ${cpmClass}">${cpmLabel}</span></td>
    </tr>`;
  }).join("");

  // Time-of-day table — uses the selected date
  const curDate = getDateStr();
  const wd = isWeekdayFromDate(curDate);
  const hrs = wd ? [7, 8, 9, 10, 12, 15, 17, 19, 21] : [8, 10, 12, 15, 18, 21];
  const todRows = hrs.map(h => {
    const t = `${String(h).padStart(2, "0")}:00`;
    const rts = buildRoutes(dest, t, curDate);
    const m = rts.find(x => x.id === r.id);
    if (!m || !m.available) return `<tr><td class="tod-cell">${fmt12(t)}</td><td colspan="3" class="tod-na">N/A</td></tr>`;
    return `<tr><td class="tod-cell">${fmt12(t)}</td><td class="tod-cell">${fmt12(m.departTime)}</td><td class="tod-cell">${fmtMin(m.totalMin)}</td><td class="tod-cell">${fmtCost(m.cost)}</td></tr>`;
  }).join("");

  detailContent.innerHTML = `
    <h2 class="detail-title">${r.label} → ${dest.name}</h2>
    <p class="detail-subtitle">Arrive by ${fmt12(arrTime)} · Leave by <strong>${fmt12(r.departTime)}</strong></p>
    <div class="detail-grid">
      <div class="detail-block">
        <h3>Route legs</h3>
        <div class="timeline">${r.legs.map(l => `
          <div class="timeline-step"><div class="timeline-dot" data-type="${l.type}"></div><div class="timeline-content"><strong>${l.label}</strong><span class="tl-detail">${l.detail}</span><span class="tl-time">${l.minutes} min</span></div></div>
        `).join("")}
          <div class="timeline-step"><div class="timeline-dot" data-type="arrive"></div><div class="timeline-content"><strong>Arrive at ${dest.name}</strong><span class="tl-time">${fmt12(arrTime)}</span></div></div>
        </div>
      </div>
      <div class="detail-block">
        <h3>Cost breakdown</h3>
        <table class="cost-table">${r.breakdown.map(c => `<tr><td>${c.label}</td><td class="cost-val">${c.value}</td></tr>`).join("")}
          <tr class="total"><td>Estimated total</td><td class="cost-val">${fmtCost(r.cost)}</td></tr>
        </table>
        <p class="detail-note">${r.notes}</p>
      </div>
    </div>
    <div class="detail-block" style="margin-top:var(--space-6)">
      <h3>Cost of speed</h3>
      <p class="detail-note" style="margin-bottom:var(--space-3)">How much extra you pay per minute saved vs. the cheapest option.</p>
      <table class="cost-table cpm-table"><thead><tr><th>Route</th><th>Cost</th><th>Time</th><th>Saved</th><th>Extra</th><th>$/min</th></tr></thead><tbody>${cpmRows}</tbody></table>
    </div>
    <div class="detail-grid" style="margin-top:var(--space-6)">
      <div class="detail-block"><h3>Travel time</h3><div class="time-chart">${timeChart}</div></div>
      <div class="detail-block"><h3>Cost</h3><div class="time-chart">${costChart}</div></div>
    </div>
    <div class="detail-block" style="margin-top:var(--space-6)">
      <h3>By arrival time (${fmtDateLabel(curDate)})</h3>
      <table class="cost-table tod-table"><thead><tr><th>Arrive</th><th>Leave by</th><th>Duration</th><th>Cost</th></tr></thead><tbody>${todRows}</tbody></table>
    </div>
    ${renderCalendarSection(r, curDate, arrTime)}`;
  window.scrollTo({ top: 0, behavior: "smooth" });
}

$("back-btn").addEventListener("click", () => { detailPanel.hidden = true; $("results").hidden = false; });

// ---- Google Calendar integration ----
function gcalDateFmt(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth()+1)}${pad(date.getDate())}T${pad(date.getHours())}${pad(date.getMinutes())}00`;
}

function buildCalendarLinks(route, dateStr, arrTimeStr) {
  const y = +dateStr.slice(0,4), mo = +dateStr.slice(4,6)-1, da = +dateStr.slice(6,8);
  const [dh, dm] = route.departTime.split(':').map(Number);
  let cursor = new Date(y, mo, da, dh, dm, 0);
  const links = [];
  const LE = { walk: '\ud83d\udeb6', drive: '\ud83d\ude97', wait: '\u23f3', train: '\ud83d\ude86', bus: '\ud83d\ude8c' };

  for (const leg of route.legs) {
    const start = new Date(cursor);
    const end = new Date(cursor.getTime() + leg.minutes * 60000);
    const emoji = LE[leg.type] || '\ud83d\udccd';
    const title = `${emoji} ${leg.label}`;
    const desc = [leg.detail, `${leg.minutes} min`, `Part of: ${route.label}`].filter(Boolean).join('\n');
    const params = new URLSearchParams({ action: 'TEMPLATE', text: title, dates: `${gcalDateFmt(start)}/${gcalDateFmt(end)}`, details: desc });
    links.push({
      label: leg.label, emoji, minutes: leg.minutes,
      startFmt: fmt12(minToHHMM(start.getHours() * 60 + start.getMinutes())),
      url: `https://calendar.google.com/calendar/render?${params.toString()}`
    });
    cursor = end;
  }

  // All-in-one event
  const tripStart = new Date(y, mo, da, dh, dm, 0);
  const [ah, am] = arrTimeStr.split(':').map(Number);
  const tripEnd = new Date(y, mo, da, ah, am, 0);
  const allDesc = route.legs.map(l => `${LE[l.type]||''} ${l.label} (${l.minutes}m)`).join('\n');
  const allParams = new URLSearchParams({ action: 'TEMPLATE', text: `Travel: ${route.label}`, dates: `${gcalDateFmt(tripStart)}/${gcalDateFmt(tripEnd)}`, details: `${route.label}\n${fmtCost(route.cost)}\n\n${allDesc}` });

  return { legs: links, allInOneUrl: `https://calendar.google.com/calendar/render?${allParams.toString()}` };
}

function renderCalendarSection(route, dateStr, arrTimeStr) {
  const cal = buildCalendarLinks(route, dateStr, arrTimeStr);
  let html = `
    <div class="detail-block cal-block" style="margin-top:var(--space-6)">
      <h3>Add to Google Calendar</h3>
      <p class="detail-note" style="margin-bottom:var(--space-3)">Each leg as a separate event, or the whole trip as one.</p>
      <div class="cal-buttons">
        <a href="${cal.allInOneUrl}" target="_blank" rel="noopener" class="cal-btn cal-btn-all">
          <span class="cal-btn-icon">\ud83d\uddfa\ufe0f</span>
          <span class="cal-btn-text"><strong>Entire trip</strong><span class="cal-btn-sub">${route.legs.length} legs · ${fmtMin(route.totalMin)}</span></span>
        </a>`;
  for (const leg of cal.legs) {
    html += `
        <a href="${leg.url}" target="_blank" rel="noopener" class="cal-btn">
          <span class="cal-btn-icon">${leg.emoji}</span>
          <span class="cal-btn-text"><strong>${leg.label}</strong><span class="cal-btn-sub">${leg.startFmt} · ${leg.minutes}m</span></span>
        </a>`;
  }
  html += '</div></div>';
  return html;
}

// Build a Google Calendar URL for a return-tab route
function returnCalUrl(dateStr, startMin, legs, label, costStr) {
  const y = +dateStr.slice(0,4), mo = +dateStr.slice(4,6)-1, da = +dateStr.slice(6,8);
  const sh = Math.floor(startMin / 60), sm = startMin % 60;
  const tripStart = new Date(y, mo, da, sh, sm, 0);
  const totalLegMin = legs.reduce((s, l) => s + l.minutes, 0);
  const tripEnd = new Date(tripStart.getTime() + totalLegMin * 60000);
  const LE = { walk: '\ud83d\udeb6', drive: '\ud83d\ude97', wait: '\u23f3', train: '\ud83d\ude86', bus: '\ud83d\ude8c' };
  const desc = legs.map(l => `${LE[l.type]||''} ${l.label} (${l.minutes}m)`).join('\n');
  const params = new URLSearchParams({ action: 'TEMPLATE', text: `Return: ${label}`, dates: `${gcalDateFmt(tripStart)}/${gcalDateFmt(tripEnd)}`, details: `${label}\n${costStr}\n\n${desc}` });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

// ---- Date helpers for UI ----
// Convert date input value (YYYY-MM-DD) to YYYYMMDD for calendar lookup
function getDateStr() {
  return (dateInput.value || '').replace(/-/g, '');
}
// Format YYYYMMDD to a friendly label like "Fri, Mar 13"
function fmtDateLabel(ds) {
  if (!ds || ds.length !== 8) return '';
  const d = new Date(+ds.slice(0,4), +ds.slice(4,6)-1, +ds.slice(6,8));
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}
// Update the service note below the date picker
function updateDateNote() {
  const ds = getDateStr();
  if (!ds || ds.length !== 8) { dateNote.textContent = ''; return; }
  const svcIds = NJT_CALENDAR[ds];
  const label = fmtDateLabel(ds);
  if (!svcIds) {
    dateNote.textContent = `${label} — Outside schedule range (Mar 10 – Sep 5, 2026)`;
    dateNote.className = 'date-service-note warn';
  } else {
    // Check if any rail service IDs are active (exclude light rail ID 8)
    const railIds = svcIds.filter(id => id !== 8);
    const trainSvcIds = new Set(NJT_SCHEDULE_TRAINS.map(t => t[0]));
    const activeRail = railIds.filter(id => trainSvcIds.has(id));
    if (activeRail.length === 0) {
      dateNote.textContent = `${label} — No NJ Transit rail service (special schedule)`;
      dateNote.className = 'date-service-note warn';
    } else {
      dateNote.textContent = `${label} — NJ Transit rail running`;
      dateNote.className = 'date-service-note ok';
    }
  }
}

// Initialize date input to today
(function initDate() {
  const now = new Date();
  const y = now.getFullYear(), m = String(now.getMonth()+1).padStart(2,'0'), d = String(now.getDate()).padStart(2,'0');
  dateInput.value = `${y}-${m}-${d}`;
  // Set min/max from calendar range
  const dates = Object.keys(NJT_CALENDAR).sort();
  if (dates.length) {
    const mn = dates[0], mx = dates[dates.length-1];
    dateInput.min = `${mn.slice(0,4)}-${mn.slice(4,6)}-${mn.slice(6,8)}`;
    dateInput.max = `${mx.slice(0,4)}-${mx.slice(4,6)}-${mx.slice(6,8)}`;
  }
  updateDateNote();
})();

// ---- Main update ----
function update() {
  if (!selectedPlace) return;
  const ds = getDateStr();
  if (!ds || ds.length !== 8) return;
  updateDateNote();
  const routes = buildRoutes(selectedPlace, arrInput.value, ds);
  detailPanel.hidden = true; $("results").hidden = false;
  renderCards(routes, selectedPlace, arrInput.value);
  highlightPresets();
}
arrInput.addEventListener("change", update);
arrInput.addEventListener("input", update);
dateInput.addEventListener("change", () => { updateDateNote(); update(); });

// ===================== TAB SWITCHING =====================
(function initTabs() {
  const tabs = document.querySelectorAll('.mode-tab');
  const goPanel = $('tab-go');
  const retPanel = $('tab-return');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const which = tab.dataset.tab;
      goPanel.hidden = which !== 'go';
      retPanel.hidden = which !== 'return';
    });
  });
})();

// ===================== RETURN TRIP =====================
const retDestInput = $('return-dest-input'), retAcList = $('return-autocomplete-list'), retClearBtn = $('return-clear-btn');
const retDateInput = $('return-date'), dinnerStart = $('dinner-start'), dinnerDuration = $('dinner-duration');
const retDateNote = $('return-date-note'), retResultsContent = $('return-results-content'), retEmptyState = $('return-empty-state');
let retSelectedPlace = null, retAcIdx = -1;

// Initialize return date input
(function initReturnDate() {
  const now = new Date();
  const y = now.getFullYear(), m = String(now.getMonth()+1).padStart(2,'0'), d = String(now.getDate()).padStart(2,'0');
  retDateInput.value = `${y}-${m}-${d}`;
  const dates = Object.keys(NJT_CALENDAR).sort();
  if (dates.length) {
    const mn = dates[0], mx = dates[dates.length-1];
    retDateInput.min = `${mn.slice(0,4)}-${mn.slice(4,6)}-${mn.slice(6,8)}`;
    retDateInput.max = `${mx.slice(0,4)}-${mx.slice(4,6)}-${mx.slice(6,8)}`;
  }
})();

// ---- Return autocomplete (reuse same logic) ----
let _retNomTimer = null, _retNomAbort = null, _retNomSeq = 0;

function retSearchNominatim(q) {
  clearTimeout(_retNomTimer);
  if (_retNomAbort) _retNomAbort.abort();
  const seq = ++_retNomSeq;
  _retNomTimer = setTimeout(async () => {
    const ctrl = new AbortController();
    _retNomAbort = ctrl;
    try {
      const query = /\b(nj|new jersey)\b/i.test(q) ? q : `${q}, NJ`;
      const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&countrycodes=us&limit=6&addressdetails=1&q=${encodeURIComponent(query)}`;
      const res = await fetch(url, { signal: ctrl.signal, headers: { 'Accept-Language': 'en' } });
      if (seq !== _retNomSeq) return;
      const data = await res.json();
      const njResults = data.filter(r => r.address && r.address.state === 'New Jersey');
      if (seq !== _retNomSeq) return;
      retRenderGeoResults(njResults);
    } catch (e) {
      if (e.name !== 'AbortError') console.warn('Nominatim error:', e);
    }
  }, 350);
}

function retRenderAC(localMatches) {
  retAcList.innerHTML = '';
  if (!localMatches.length) { retAcList.hidden = true; return; }
  localMatches.forEach(p => {
    const li = document.createElement('li');
    li.className = 'ac-item';
    li.innerHTML = `<span class="ac-name">${p.name}</span><span class="ac-county">${p.county}</span>`;
    li.addEventListener('mousedown', e => { e.preventDefault(); retSelectPlace(p); });
    retAcList.appendChild(li);
  });
  retAcList.hidden = false; retAcIdx = -1;
}

function retRenderGeoResults(results) {
  if (!results || !results.length) {
    if (!retAcList.querySelectorAll('.ac-item').length) {
      retAcList.innerHTML = '<li class="ac-empty">No results found</li>';
      retAcList.hidden = false;
    }
    return;
  }
  retAcList.querySelectorAll('.ac-geo, .ac-sep').forEach(el => el.remove());
  if (retAcList.querySelectorAll('.ac-item').length) {
    const sep = document.createElement('li');
    sep.className = 'ac-sep'; sep.textContent = 'Addresses';
    retAcList.appendChild(sep);
  }
  results.forEach(r => {
    const li = document.createElement('li');
    li.className = 'ac-item ac-geo';
    const addr = r.address || {};
    const street = [addr.house_number, addr.road].filter(Boolean).join(' ');
    const city = addr.city || addr.town || addr.village || addr.hamlet || '';
    const primary = street || r.display_name.split(',')[0];
    const secondary = [city, addr.state].filter(Boolean).join(', ');
    li.innerHTML = `<span class="ac-name">${primary}</span><span class="ac-county">${secondary}</span>`;
    li.addEventListener('mousedown', e => { e.preventDefault(); retSelectGeoResult(r); });
    retAcList.appendChild(li);
  });
  retAcList.hidden = false; retAcIdx = -1;
}

function retSelectPlace(p) {
  retSelectedPlace = p;
  retDestInput.value = p.name;
  retAcList.hidden = true; retClearBtn.hidden = false;
  $('return-dest-hint').textContent = `${p.county} County · ~${haversine(ORIGIN.lat, ORIGIN.lng, p.lat, p.lng).toFixed(0)} mi`;
  saveRecent(p);
  updateReturn();
}

function retSelectGeoResult(r) {
  const addr = r.address || {};
  const city = addr.city || addr.town || addr.village || addr.hamlet || '';
  const county = (addr.county || '').replace(' County', '');
  const street = [addr.house_number, addr.road].filter(Boolean).join(' ');
  const shortName = street && city ? `${street}, ${city}` : (street || city || r.display_name.split(',')[0]);
  retSelectedPlace = { name: shortName, county, lat: parseFloat(r.lat), lng: parseFloat(r.lon), address: r.display_name };
  retDestInput.value = shortName;
  retAcList.hidden = true; retClearBtn.hidden = false;
  const dist = haversine(ORIGIN.lat, ORIGIN.lng, retSelectedPlace.lat, retSelectedPlace.lng).toFixed(0);
  $('return-dest-hint').textContent = county ? `${county} County · ~${dist} mi` : `~${dist} mi`;
  saveRecent(retSelectedPlace);
  updateReturn();
}

retDestInput.addEventListener('input', () => {
  retClearBtn.hidden = !retDestInput.value;
  const q = retDestInput.value.trim();
  if (q.length < 2) { retAcList.hidden = true; retSelectedPlace = null; clearTimeout(_retNomTimer); return; }
  retSelectedPlace = null;
  const local = localFilter(q);
  retRenderAC(local);
  if (q.length >= 4) retSearchNominatim(q);
});
retDestInput.addEventListener('keydown', e => {
  const items = retAcList.querySelectorAll('.ac-item');
  if (!items.length) return;
  if (e.key === 'ArrowDown') { e.preventDefault(); retAcIdx = Math.min(retAcIdx + 1, items.length - 1); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); retAcIdx = Math.max(retAcIdx - 1, 0); }
  else if (e.key === 'Enter' && retAcIdx >= 0) { e.preventDefault(); items[retAcIdx].dispatchEvent(new Event('mousedown')); return; }
  else if (e.key === 'Escape') { retAcList.hidden = true; return; }
  else return;
  items.forEach((li, i) => li.classList.toggle('ac-active', i === retAcIdx));
});
let _retBlurTimer = null;
retDestInput.addEventListener('blur', () => { _retBlurTimer = setTimeout(() => retAcList.hidden = true, 200); });
retDestInput.addEventListener('focus', () => {
  clearTimeout(_retBlurTimer);
  if (!retDestInput.value.trim() && !retSelectedPlace) {
    // Show recents in return tab too
    const recents = getRecents();
    if (recents.length) {
      retAcList.innerHTML = '';
      const hdr = document.createElement('li'); hdr.className = 'ac-sep'; hdr.textContent = 'Recent';
      retAcList.appendChild(hdr);
      recents.forEach(p => {
        const li = document.createElement('li');
        li.className = 'ac-item ac-recent';
        li.innerHTML = `<span class="ac-recent-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg></span><span class="ac-name">${p.name}</span>${p.county ? `<span class="ac-county">${p.county}</span>` : ''}`;
        li.addEventListener('mousedown', e => { e.preventDefault(); retSelectPlace(p); });
        retAcList.appendChild(li);
      });
      retAcList.hidden = false; retAcIdx = -1;
    }
  } else if (retDestInput.value.length >= 2 && !retSelectedPlace) {
    retDestInput.dispatchEvent(new Event('input'));
  }
});
retClearBtn.addEventListener('click', () => {
  retDestInput.value = ''; retSelectedPlace = null; retClearBtn.hidden = true;
  clearTimeout(_retNomTimer);
  $('return-dest-hint').textContent = '';
  retResultsContent.hidden = true; retEmptyState.hidden = false;
  retDestInput.focus();
});

// ---- Return trip route builder ----
function buildReturnRoutes(place, dateStr, earliestLeaveMin) {
  const wd = isWeekdayFromDate(dateStr);
  const hour = Math.floor(earliestLeaveMin / 60);
  const period = timePeriod(hour, wd);
  const tf = trafficInfo(period);
  const pf = pathFreq(period);
  const activeServiceIds = NJT_CALENDAR[dateStr] || [];
  const svcSet = new Set(activeServiceIds);

  const results = { departures: [], lyftDirect: null, pathRoute: null, njtRoute: null };

  // 1. NJT DEPARTURES from nearest stations
  const stationEntries = Object.entries(NJT_SCHEDULE_STATIONS);
  const nearest = stationEntries
    .map(([sid, s]) => ({ sid, ...s, dist: haversine(place.lat, place.lng, s.lat, s.lon) }))
    .sort((a, b) => a.dist - b.dist)
    .slice(0, 5);

  // For each station, find upcoming departures
  for (const stn of nearest) {
    const walkDist = roadMiles(stn.lat, stn.lon, place.lat, place.lng);
    const walkMin = Math.max(2, Math.round((walkDist / 3) * 60));
    const lyftToStation = walkDist > 0.45 ? driveMin(walkDist, tf.mult) + 4 : 0;
    const getToStationMin = walkDist > 0.45 ? lyftToStation : walkMin;

    for (const t of NJT_RETURN_TRAINS) {
      if (!svcSet.has(t[0])) continue;
      if (t[3] !== stn.sid) continue;
      const departMin = t[1];
      const arrivePennMin = t[2];
      // Must be able to get to station before departure
      const mustLeaveBy = departMin - getToStationMin;
      // Show trains from 30 min before dinner ends (greyed out) to 3 hours after
      if (mustLeaveBy < earliestLeaveMin - 30) continue;
      if (departMin > earliestLeaveMin + 180) continue;

      const rideMin = arrivePennMin - departMin;
      // From Penn Station, take subway to SoHo: ~15 min
      const subwayHome = 15;
      const totalMin = getToStationMin + rideMin + subwayHome;
      const arriveHomeMin = departMin + rideMin + subwayHome;
      const transitCost = stn.fare + 2.90; // NJT fare + subway
      let getToStationCost = 0;
      let getToStationLabel = `Walk ${walkDist.toFixed(1)} mi`;
      if (walkDist > 0.45) {
        const lm = lyftEst(walkDist, tf.mult, 1.0, 'intra_nj');
        getToStationCost = lm.mid;
        getToStationLabel = `Lyft ${walkDist.toFixed(1)} mi (~$${lm.mid})`;
      }

      results.departures.push({
        departMin,
        arrivePennMin,
        arriveHomeMin,
        mustLeaveBy,
        station: stn.n,
        stationId: stn.sid,
        route: t[4],
        rideMin,
        totalMin,
        cost: transitCost + getToStationCost,
        getToStation: getToStationLabel,
        getToStationMin,
        walkDist,
      });
    }
  }

  // Deduplicate: for the same departure time from Penn-bound direction,
  // keep only the best station (latest mustLeaveBy)
  const seen = new Map();
  results.departures.sort((a, b) => a.departMin - b.departMin);
  const deduped = [];
  for (const d of results.departures) {
    const key = `${d.departMin}-${d.route}`;
    if (!seen.has(key) || d.mustLeaveBy > seen.get(key).mustLeaveBy) {
      seen.set(key, d);
    }
  }
  results.departures = [...seen.values()].sort((a, b) => a.departMin - b.departMin);

  // 2. LYFT DOOR-TO-DOOR (NJ → SoHo)
  {
    const miles = roadMiles(place.lat, place.lng, ORIGIN.lat, ORIGIN.lng);
    const dm = driveMin(miles, tf.mult);
    const wait = 4;
    const total = wait + dm;
    const cost = lyftEst(miles, tf.mult, tf.surge, 'nj_to_nyc');
    results.lyftDirect = {
      label: 'Lyft Door-to-Door',
      mode: 'lyft',
      totalMin: total,
      cost,
      traffic: tf,
      arriveHomeMin: earliestLeaveMin + total,
      legs: [
        { type: 'wait', label: 'Wait for Lyft', detail: `At ${place.name}`, minutes: wait },
        { type: 'drive', label: 'Drive to SoHo', detail: `${miles.toFixed(1)} mi`, minutes: dm },
      ],
      notes: `Leave whenever. ~${fmtMin(total)} door-to-door.`,
    };
  }

  // 3. LYFT → PATH → SoHo (drive to nearest PATH station, take PATH to NYC)
  if (pf) {
    let bestRoute = null, bestScore = Infinity;
    for (const [lineId, line] of Object.entries(PATH_LINES)) {
      for (const stop of line.stops) {
        const rdToPath = roadMiles(place.lat, place.lng, stop.lat, stop.lng);
        const dmToPath = driveMin(rdToPath, tf.mult);
        const waitLyft = 4;
        const avgWait = Math.round(pf / 2);
        // PATH ride time back to Manhattan (same as outbound, roughly)
        const pathRide = stop.rideMin;
        // Then walk/subway from PATH station to SoHo
        const conn = bestConnection(line.manhattanStation);
        const toSoHo = conn.minutes;
        const total = waitLyft + dmToPath + avgWait + pathRide + toSoHo;
        const lyftCost = lyftEst(rdToPath, tf.mult, 1.0, 'intra_nj');
        const totalCost = lyftCost.mid + PATH_FARE + (conn.fare || 0);
        const score = total * 0.35 + totalCost * 0.65;
        if (score < bestScore) {
          bestScore = score;
          bestRoute = {
            label: 'Lyft + PATH',
            mode: 'path',
            totalMin: total,
            cost: { low: lyftCost.low + PATH_FARE + (conn.fare || 0), mid: totalCost, high: lyftCost.high + PATH_FARE + (conn.fare || 0) },
            traffic: { level: 'low', label: 'Fixed schedule' },
            arriveHomeMin: earliestLeaveMin + total,
            legs: [
              { type: 'wait', label: 'Wait for Lyft', detail: `At ${place.name}`, minutes: waitLyft },
              { type: 'drive', label: `Lyft to ${stop.name}`, detail: `${rdToPath.toFixed(1)} mi`, minutes: dmToPath },
              { type: 'wait', label: `Wait for PATH (every ${pf} min)`, detail: 'Platform', minutes: avgWait },
              { type: 'train', label: `PATH to ${line.manhattanStation === 'wtcPath' ? 'WTC' : '33rd St'}`, detail: `${lineId} · $${PATH_FARE.toFixed(2)}`, minutes: pathRide },
              { type: conn.type === 'subway' ? 'train' : 'walk', label: `${conn.label.replace('to WTC-Cortlandt','from WTC').replace('to 34th St-Penn','from 33rd St').replace('to Christopher','from Christopher')}`, detail: conn.trains || 'To 543 Broadway', minutes: toSoHo },
            ],
            notes: `Lyft to ${stop.name}, PATH to Manhattan`,
            _station: stop.name, _dist: rdToPath,
          };
        }
      }
    }
    results.pathRoute = bestRoute;
  }

  return results;
}

// ---- Render return results ----
function renderReturn(results, place, dateStr, dinnerStartMin, durationMin) {
  retEmptyState.hidden = true;
  retResultsContent.hidden = false;
  const earliestLeave = dinnerStartMin + durationMin;
  const dateLabel = fmtDateLabel(dateStr);
  const dinnerEndFmt = fmt12(minToHHMM(earliestLeave));

  // Lyft direct info
  const ld = results.lyftDirect;
  const ldArrFmt = fmt12(minToHHMM(ld.arriveHomeMin));

  // PATH info
  const pr = results.pathRoute;

  // Summary cards
  let html = `
    <div class="return-header">
      <h2>Getting home from ${place.name}</h2>
      <p>${dateLabel} · ${fmt12(minToHHMM(dinnerStartMin))} – ${dinnerEndFmt} (${formatDurationLabel(durationMin)}) · Earliest departure ${dinnerEndFmt}</p>
    </div>
    <div class="return-summary">
      <div class="return-summary-card">
        <h3>Lyft Door-to-Door</h3>
        <div class="summary-value">${fmtCost(ld.cost)}</div>
        <div class="summary-detail">~${fmtMin(ld.totalMin)} · Home by ${ldArrFmt}</div>
        <div class="summary-detail">${ld.traffic.label}</div>
      </div>`;
  if (pr) {
    const prArrFmt = fmt12(minToHHMM(pr.arriveHomeMin));
    html += `
      <div class="return-summary-card">
        <h3>Lyft + PATH</h3>
        <div class="summary-value">${fmtCost(pr.cost)}</div>
        <div class="summary-detail">~${fmtMin(pr.totalMin)} · Home by ${prArrFmt}</div>
        <div class="summary-detail">Via ${pr._station}</div>
      </div>`;
  }
  if (results.departures.length) {
    const first = results.departures[0];
    const cheapest = results.departures.reduce((a, b) => a.cost < b.cost ? a : b);
    html += `
      <div class="return-summary-card">
        <h3>NJ Transit + Subway</h3>
        <div class="summary-value">From $${Math.round(cheapest.cost)}</div>
        <div class="summary-detail">${results.departures.length} trains available</div>
        <div class="summary-detail">Next: ${fmt12(minToHHMM(first.departMin))} from ${first.station}</div>
      </div>`;
  } else {
    html += `
      <div class="return-summary-card">
        <h3>NJ Transit</h3>
        <div class="summary-value">—</div>
        <div class="summary-detail">No trains to Penn Station</div>
      </div>`;
  }
  html += '</div>';

  // Find first feasible train (used in both table and comparison)
  const firstGood = results.departures.length
    ? results.departures.findIndex(d => d.mustLeaveBy >= earliestLeave)
    : -1;

  // NJT Departures table
  html += '<div class="departures-section">';
  if (results.departures.length) {
    html += `<h3>NJ Transit Departures to Penn Station</h3>`;
    html += `<p class="section-note">Tell your date: "I need to wrap up by..." — the deadline column shows when you need to leave the restaurant.</p>`;
    html += '<div class="departure-row departure-header"><span>Departs</span><span>Route</span><span>Home by</span><span>Leave by</span></div>';

    results.departures.forEach((d, i) => {
      const departFmt = fmt12(minToHHMM(d.departMin));
      const arrHomeFmt = fmt12(minToHHMM(d.arriveHomeMin));
      const mustLeaveFmt = fmt12(minToHHMM(d.mustLeaveBy));
      const isHighlight = i === firstGood;
      const isPast = d.mustLeaveBy < earliestLeave;
      html += `
        <div class="departure-row${isHighlight ? ' highlight' : ''}${isPast ? ' past' : ''}">
          <span class="depart-time-col">${departFmt}</span>
          <span class="depart-route-col">
            <span class="route-line">${d.route} → ${d.station}</span>
            <span class="route-detail">${d.getToStation} · ${fmtMin(d.rideMin)} ride · $${Math.round(d.cost)}</span>
          </span>
          <span class="depart-arrive-col">${arrHomeFmt}</span>
          <span class="depart-deadline-col">${mustLeaveFmt}</span>
        </div>`;
    });
  } else {
    const reason = (NJT_CALENDAR[dateStr] || []).length === 0
      ? 'No NJ Transit rail service on this date.'
      : 'No trains to Penn Station found from nearby stations at this time.';
    html += `<div class="no-trains-msg"><p>${reason}</p><p>Consider Lyft or Lyft + PATH instead.</p></div>`;
  }
  html += '</div>';

  // Comparison: what does flexibility cost?
  if (results.departures.length && ld) {
    const cheapestTrain = results.departures.reduce((a, b) => a.cost < b.cost ? a : b);
    const lyftExtra = ld.cost.mid - cheapestTrain.cost;
    const timeSaved = cheapestTrain.totalMin - ld.totalMin;
    html += `
      <div class="return-compare">
        <h3>Cost of flexibility</h3>
        <p class="compare-note">Lyft lets you leave whenever — no train to catch. Here's what that flexibility costs compared to NJ Transit.</p>
        <div class="return-cards">`;

    // Lyft card
    html += `
      <div class="mode-card" data-mode="lyft" style="cursor:default">
        <div class="card-header"><span class="card-mode-name">Lyft Door-to-Door</span></div>
        <div class="card-metrics">
          <div class="metric"><span class="metric-label">Cost</span><span class="metric-value">${fmtCost(ld.cost)}</span></div>
          <div class="metric"><span class="metric-label">Time</span><span class="metric-value">${fmtMin(ld.totalMin)}</span></div>
        </div>
        <div class="card-legs">
          ${ld.legs.map(l => `<div class="leg-row"><span class="leg-icon">${LEG_ICONS[l.type]}</span><span class="leg-text">${l.label}</span><span class="leg-time">${l.minutes}m</span></div>`).join('')}
        </div>
        <div class="card-footer">
          <div class="traffic-indicator"><span class="traffic-dot ${ld.traffic.level}"></span><span>${ld.traffic.label} · Leave whenever</span></div>
          <a href="${returnCalUrl(dateStr, earliestLeave, ld.legs, 'Lyft Door-to-Door', fmtCost(ld.cost))}" target="_blank" rel="noopener" class="cal-link">\ud83d\udcc5 Add to Calendar</a>
        </div>
      </div>`;

    // PATH card
    if (pr) {
      html += `
        <div class="mode-card" data-mode="path" style="cursor:default">
          <div class="card-header"><span class="card-mode-name">Lyft + PATH</span></div>
          <div class="card-metrics">
            <div class="metric"><span class="metric-label">Cost</span><span class="metric-value">${fmtCost(pr.cost)}</span></div>
            <div class="metric"><span class="metric-label">Time</span><span class="metric-value">${fmtMin(pr.totalMin)}</span></div>
          </div>
          <div class="card-legs">
            ${pr.legs.map(l => `<div class="leg-row"><span class="leg-icon">${LEG_ICONS[l.type]}</span><span class="leg-text">${l.label}</span><span class="leg-time">${l.minutes}m</span></div>`).join('')}
          </div>
          <div class="card-footer">
            <div class="traffic-indicator"><span class="traffic-dot low"></span><span>Fixed schedule · Semi-flexible</span></div>
            <a href="${returnCalUrl(dateStr, earliestLeave, pr.legs, 'Lyft + PATH', fmtCost(pr.cost))}" target="_blank" rel="noopener" class="cal-link">\ud83d\udcc5 Add to Calendar</a>
          </div>
        </div>`;
    }

    // Best NJT card
    const bestTrain = results.departures[firstGood >= 0 ? firstGood : 0];
    html += `
      <div class="mode-card" data-mode="njtransit" style="cursor:default">
        <div class="card-header"><span class="card-mode-name">NJ Transit</span><span class="card-badge">Cheapest</span></div>
        <div class="card-metrics">
          <div class="metric"><span class="metric-label">Cost</span><span class="metric-value">$${Math.round(bestTrain.cost)}</span></div>
          <div class="metric"><span class="metric-label">Time</span><span class="metric-value">${fmtMin(bestTrain.totalMin)}</span></div>
        </div>
        <div class="card-legs">
          <div class="leg-row"><span class="leg-icon">${LEG_ICONS.walk}</span><span class="leg-text">${bestTrain.walkDist > 0.45 ? 'Lyft' : 'Walk'} to ${bestTrain.station}</span><span class="leg-time">${bestTrain.getToStationMin}m</span></div>
          <div class="leg-row"><span class="leg-icon">${LEG_ICONS.train}</span><span class="leg-text">${bestTrain.route} to Penn Station</span><span class="leg-time">${bestTrain.rideMin}m</span></div>
          <div class="leg-row"><span class="leg-icon">${LEG_ICONS.train}</span><span class="leg-text">Subway to SoHo</span><span class="leg-time">15m</span></div>
        </div>
        <div class="card-footer">
          <div class="traffic-indicator"><span class="traffic-dot low"></span><span>Catch ${fmt12(minToHHMM(bestTrain.departMin))} · Must leave by ${fmt12(minToHHMM(bestTrain.mustLeaveBy))}</span></div>
          <a href="${returnCalUrl(dateStr, bestTrain.mustLeaveBy, [{type:'walk',label:(bestTrain.walkDist>0.45?'Lyft':'Walk')+' to '+bestTrain.station,minutes:bestTrain.getToStationMin},{type:'train',label:bestTrain.route+' to Penn Station',minutes:bestTrain.rideMin},{type:'train',label:'Subway to SoHo',minutes:15}], 'NJ Transit', '$'+Math.round(bestTrain.cost))}" target="_blank" rel="noopener" class="cal-link">\ud83d\udcc5 Add to Calendar</a>
        </div>
      </div>`;

    html += '</div>';

    // Flexibility cost summary
    if (lyftExtra > 0 && timeSaved > 0) {
      const cpm = lyftExtra / timeSaved;
      html += `<p class="compare-note" style="margin-top:var(--space-4)">Lyft costs <strong>$${Math.round(lyftExtra)} more</strong> than NJ Transit but saves <strong>${timeSaved} min</strong> and lets you skip the schedule. That's <strong>$${cpm.toFixed(2)}/min</strong> of flexibility.</p>`;
    } else if (lyftExtra > 0) {
      html += `<p class="compare-note" style="margin-top:var(--space-4)">Lyft costs <strong>$${Math.round(lyftExtra)} more</strong> than NJ Transit, but you can leave whenever you want.</p>`;
    }
    html += '</div>';
  }

  retResultsContent.innerHTML = html;
}

// Helper reused
function minToHHMM(m) {
  const h = Math.floor(m / 60) % 24;
  const mn = m % 60;
  return `${String(h).padStart(2, '0')}:${String(mn).padStart(2, '0')}`;
}

function updateReturnDateNote() {
  const ds = (retDateInput.value || '').replace(/-/g, '');
  if (!ds || ds.length !== 8) { retDateNote.textContent = ''; return; }
  const svcIds = NJT_CALENDAR[ds];
  const label = fmtDateLabel(ds);
  if (!svcIds) {
    retDateNote.textContent = `${label} — Outside schedule range`;
    retDateNote.className = 'date-service-note warn';
  } else {
    const trainSvcIds = new Set(NJT_RETURN_TRAINS.map(t => t[0]));
    const activeRail = svcIds.filter(id => id !== 8 && trainSvcIds.has(id));
    if (activeRail.length === 0) {
      retDateNote.textContent = `${label} — No NJ Transit rail service (special schedule)`;
      retDateNote.className = 'date-service-note warn';
    } else {
      retDateNote.textContent = `${label} — NJ Transit rail running`;
      retDateNote.className = 'date-service-note ok';
    }
  }
}

// Parse flexible duration strings: "90", "90m", "1.5h", "1h30m", "1h 30m", "2h", "1:30"
function parseDuration(str) {
  if (!str) return NaN;
  const s = str.trim().toLowerCase();
  // Pure number → treat as minutes
  if (/^\d+(\.\d+)?$/.test(s)) return Math.round(parseFloat(s));
  // h:mm format (e.g. "1:30")
  const colonMatch = s.match(/^(\d+):(\d{1,2})$/);
  if (colonMatch) return parseInt(colonMatch[1]) * 60 + parseInt(colonMatch[2]);
  // XhYm variants: "1h30m", "1h 30m", "1.5h", "90m", "2h"
  let totalMin = 0;
  const hMatch = s.match(/(\d+\.?\d*)\s*h/);
  const mMatch = s.match(/(\d+)\s*m/);
  if (hMatch) totalMin += parseFloat(hMatch[1]) * 60;
  if (mMatch) totalMin += parseInt(mMatch[1]);
  return (hMatch || mMatch) ? Math.round(totalMin) : NaN;
}

function formatDurationLabel(min) {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

function updateReturn() {
  if (!retSelectedPlace) return;
  const ds = (retDateInput.value || '').replace(/-/g, '');
  if (!ds || ds.length !== 8) return;
  updateReturnDateNote();
  const [sh, sm] = dinnerStart.value.split(':').map(Number);
  const dinnerStartMin = sh * 60 + sm;
  const durationMin = parseDuration(dinnerDuration.value);
  if (isNaN(durationMin) || durationMin <= 0) return;
  const earliestLeave = dinnerStartMin + durationMin;
  const results = buildReturnRoutes(retSelectedPlace, ds, earliestLeave);
  renderReturn(results, retSelectedPlace, ds, dinnerStartMin, durationMin);
}

retDateInput.addEventListener('change', () => { updateReturnDateNote(); updateReturn(); });
dinnerStart.addEventListener('change', updateReturn);
dinnerStart.addEventListener('input', updateReturn);
dinnerDuration.addEventListener('change', updateReturn);
dinnerDuration.addEventListener('input', updateReturn);

// ---- Theme toggle ----
(function () {
  const t = document.querySelector("[data-theme-toggle]"), r = document.documentElement;
  let d = matchMedia("(prefers-color-scheme:dark)").matches ? "dark" : "light";
  r.setAttribute("data-theme", d);
  t && t.addEventListener("click", () => {
    d = d === "dark" ? "light" : "dark"; r.setAttribute("data-theme", d);
    t.setAttribute("aria-label", `Switch to ${d === "dark" ? "light" : "dark"} mode`);
    t.innerHTML = d === "dark"
      ? '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>'
      : '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
  });
})();
highlightPresets();
