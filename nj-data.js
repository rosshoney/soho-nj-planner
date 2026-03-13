// =========================================================
// NJ Location & Transit Database
// =========================================================

// Origin: 543 Broadway, NY, NY 10012 (SoHo, between Prince & Spring)
const ORIGIN = { lat: 40.7234, lng: -73.9987 };

// ---- Manhattan connections FROM 543 Broadway ----
// Walk or subway to reach PATH or NJ Transit departure points
const MANHATTAN_CONNECTIONS = {
  // WTC PATH: walk south (~1 mi) or take subway
  wtcPath: {
    walk: { minutes: 15, label: "Walk south to WTC" },
    subway: { minutes: 12, label: "C/E from Spring St to WTC-Cortlandt", fare: 2.90, trains: "C or E train" },
  },
  // 33rd St PATH (for Hoboken line): subway north
  path33: {
    walk: { minutes: 28, label: "Walk north to 33rd St PATH" },
    subway: { minutes: 14, label: "N/R/W from Prince St to 33rd St", fare: 2.90, trains: "N, R, or W train" },
  },
  // Christopher St PATH: walk west
  christopherPath: {
    walk: { minutes: 14, label: "Walk west to Christopher St PATH" },
    subway: { minutes: 10, label: "1 from Houston to Christopher", fare: 2.90, trains: "1 train" },
  },
  // NY Penn Station (NJ Transit / Amtrak): subway north
  pennStation: {
    walk: { minutes: 30, label: "Walk to Penn Station" },
    subway: { minutes: 15, label: "N/R/W from Prince St to 34th St-Penn", fare: 2.90, trains: "N, R, or W train" },
  },
  // Hoboken Ferry (NY Waterway) — alternative
  hobokenFerry: {
    subway: { minutes: 18, label: "Subway to Brookfield Place + ferry", fare: 2.90, ferryFare: 9.50 },
  },
};

// ---- PATH lines & NJ stations ----
const PATH_LINES = {
  "WTC-NWK": {
    name: "World Trade Center → Newark",
    manhattanStation: "wtcPath",
    stops: [
      { id: "exchange-place", name: "Exchange Place", lat: 40.7163, lng: -74.0327, rideMin: 8 },
      { id: "grove-st", name: "Grove Street", lat: 40.7194, lng: -74.0431, rideMin: 10 },
      { id: "journal-sq", name: "Journal Square", lat: 40.7330, lng: -74.0630, rideMin: 18 },
      { id: "harrison", name: "Harrison", lat: 40.7392, lng: -74.1558, rideMin: 25 },
      { id: "newark-penn", name: "Newark Penn Station", lat: 40.7345, lng: -74.1642, rideMin: 28 },
    ],
  },
  "WTC-HOB": {
    name: "World Trade Center → Hoboken",
    manhattanStation: "wtcPath",
    stops: [
      { id: "exchange-place", name: "Exchange Place", lat: 40.7163, lng: -74.0327, rideMin: 8 },
      { id: "newport", name: "Newport", lat: 40.7268, lng: -74.0339, rideMin: 11 },
      { id: "hoboken", name: "Hoboken Terminal", lat: 40.7352, lng: -74.0282, rideMin: 14 },
    ],
  },
  "33-HOB": {
    name: "33rd Street → Hoboken",
    manhattanStation: "path33",
    stops: [
      { id: "hoboken", name: "Hoboken Terminal", lat: 40.7352, lng: -74.0282, rideMin: 12 },
    ],
  },
  "33-JSQ": {
    name: "33rd Street → Journal Square",
    manhattanStation: "path33",
    stops: [
      { id: "journal-sq", name: "Journal Square", lat: 40.7330, lng: -74.0630, rideMin: 22 },
    ],
  },
};

// PATH fare
const PATH_FARE = 3.00;

// PATH frequency by period
const PATH_FREQ = {
  "am-rush": 5, "pm-rush": 5, midday: 10, evening: 10,
  "late-night": 20, "early-morning": 20, weekend: 15,
};

// ---- NJ Transit lines & stations (from NY Penn) ----
const NJT_LINES = {
  NEC: { name: "Northeast Corridor", terminal: "pennStation" },
  NJCL: { name: "North Jersey Coast", terminal: "pennStation" },
  "M&E": { name: "Morris & Essex", terminal: "pennStation" },
  "M-B": { name: "Montclair-Boonton", terminal: "pennStation" },
  RVL: { name: "Raritan Valley", terminal: "pennStation" },
  MBL: { name: "Main/Bergen Line", terminal: "pennStation" },
  PVL: { name: "Pascack Valley", terminal: "pennStation" },
  ACRL: { name: "Atlantic City Rail", terminal: "pennStation" },
};

const NJT_STATIONS = [
  // NEC
  { id: "secaucus", name: "Secaucus Jct", lat: 40.7617, lng: -74.0755, line: "NEC", rideMin: 10, fare: 4.25 },
  { id: "newark-penn", name: "Newark Penn", lat: 40.7345, lng: -74.1642, line: "NEC", rideMin: 18, fare: 5.75 },
  { id: "newark-airport", name: "EWR Airport", lat: 40.6895, lng: -74.1745, line: "NEC", rideMin: 30, fare: 15.25, note: "Includes AirTrain" },
  { id: "elizabeth", name: "Elizabeth", lat: 40.6684, lng: -74.2154, line: "NEC", rideMin: 25, fare: 6.75 },
  { id: "linden", name: "Linden", lat: 40.6271, lng: -74.2505, line: "NEC", rideMin: 30, fare: 7.50 },
  { id: "rahway", name: "Rahway", lat: 40.6082, lng: -74.2774, line: "NEC", rideMin: 32, fare: 8.25 },
  { id: "metuchen", name: "Metuchen", lat: 40.5431, lng: -74.3632, line: "NEC", rideMin: 40, fare: 10.50 },
  { id: "edison", name: "Edison", lat: 40.5172, lng: -74.4118, line: "NEC", rideMin: 45, fare: 11.75 },
  { id: "new-brunswick", name: "New Brunswick", lat: 40.4958, lng: -74.4444, line: "NEC", rideMin: 55, fare: 13.75 },
  { id: "princeton-jct", name: "Princeton Jct", lat: 40.3162, lng: -74.6220, line: "NEC", rideMin: 65, fare: 17.00, note: "Transfer to Dinky for Princeton campus" },
  { id: "trenton", name: "Trenton", lat: 40.2171, lng: -74.7554, line: "NEC", rideMin: 75, fare: 19.50 },

  // NJCL
  { id: "woodbridge", name: "Woodbridge", lat: 40.5569, lng: -74.2786, line: "NJCL", rideMin: 35, fare: 8.50 },
  { id: "perth-amboy", name: "Perth Amboy", lat: 40.5076, lng: -74.2654, line: "NJCL", rideMin: 45, fare: 10.00 },
  { id: "red-bank", name: "Red Bank", lat: 40.3476, lng: -74.0765, line: "NJCL", rideMin: 60, fare: 12.75 },
  { id: "long-branch", name: "Long Branch", lat: 40.2930, lng: -73.9875, line: "NJCL", rideMin: 75, fare: 14.50 },
  { id: "asbury-park", name: "Asbury Park", lat: 40.2200, lng: -74.0121, line: "NJCL", rideMin: 85, fare: 15.25 },
  { id: "spring-lake", name: "Spring Lake", lat: 40.1532, lng: -74.0283, line: "NJCL", rideMin: 90, fare: 16.00 },
  { id: "bay-head", name: "Bay Head", lat: 40.0765, lng: -74.0488, line: "NJCL", rideMin: 100, fare: 17.50 },

  // M&E
  { id: "newark-broad", name: "Newark Broad St", lat: 40.7439, lng: -74.1704, line: "M&E", rideMin: 22, fare: 5.75 },
  { id: "orange", name: "Orange", lat: 40.7707, lng: -74.2327, line: "M&E", rideMin: 30, fare: 6.75 },
  { id: "south-orange", name: "South Orange", lat: 40.7484, lng: -74.2625, line: "M&E", rideMin: 38, fare: 7.50 },
  { id: "maplewood", name: "Maplewood", lat: 40.7313, lng: -74.2737, line: "M&E", rideMin: 35, fare: 7.50 },
  { id: "millburn", name: "Millburn", lat: 40.7258, lng: -74.3067, line: "M&E", rideMin: 40, fare: 8.25 },
  { id: "short-hills", name: "Short Hills", lat: 40.7253, lng: -74.3244, line: "M&E", rideMin: 42, fare: 8.75 },
  { id: "summit", name: "Summit", lat: 40.7156, lng: -74.3577, line: "M&E", rideMin: 50, fare: 9.50 },
  { id: "chatham", name: "Chatham", lat: 40.7407, lng: -74.3850, line: "M&E", rideMin: 48, fare: 9.25 },
  { id: "madison", name: "Madison", lat: 40.7588, lng: -74.4168, line: "M&E", rideMin: 52, fare: 9.75 },
  { id: "convent", name: "Convent Station", lat: 40.7784, lng: -74.4431, line: "M&E", rideMin: 58, fare: 10.50 },
  { id: "morristown", name: "Morristown", lat: 40.7977, lng: -74.4771, line: "M&E", rideMin: 65, fare: 11.25 },
  { id: "dover", name: "Dover", lat: 40.8840, lng: -74.5586, line: "M&E", rideMin: 80, fare: 13.25 },

  // M-B
  { id: "montclair-state", name: "Montclair State U", lat: 40.8624, lng: -74.1991, line: "M-B", rideMin: 55, fare: 8.75 },
  { id: "wayne", name: "Wayne", lat: 40.9261, lng: -74.2260, line: "M-B", rideMin: 60, fare: 9.50 },

  // RVL
  { id: "cranford", name: "Cranford", lat: 40.6571, lng: -74.3032, line: "RVL", rideMin: 35, fare: 8.00 },
  { id: "westfield", name: "Westfield", lat: 40.6518, lng: -74.3473, line: "RVL", rideMin: 40, fare: 8.75 },
  { id: "plainfield", name: "Plainfield", lat: 40.6176, lng: -74.4173, line: "RVL", rideMin: 45, fare: 9.50 },
  { id: "bound-brook", name: "Bound Brook", lat: 40.5684, lng: -74.5381, line: "RVL", rideMin: 55, fare: 11.00 },
  { id: "somerville", name: "Somerville", lat: 40.5716, lng: -74.6160, line: "RVL", rideMin: 65, fare: 12.75 },

  // Main/Bergen
  { id: "rutherford", name: "Rutherford", lat: 40.8263, lng: -74.1082, line: "MBL", rideMin: 25, fare: 6.25 },
  { id: "passaic", name: "Passaic", lat: 40.8565, lng: -74.1244, line: "MBL", rideMin: 30, fare: 6.75 },
  { id: "clifton", name: "Clifton", lat: 40.8700, lng: -74.1537, line: "MBL", rideMin: 35, fare: 7.50 },
  { id: "paterson", name: "Paterson", lat: 40.9143, lng: -74.1715, line: "MBL", rideMin: 45, fare: 8.75 },
  { id: "ridgewood", name: "Ridgewood", lat: 40.9800, lng: -74.1160, line: "MBL", rideMin: 50, fare: 9.50 },
  { id: "ramsey", name: "Ramsey", lat: 41.0575, lng: -74.1412, line: "MBL", rideMin: 55, fare: 10.50 },
  { id: "suffern", name: "Suffern", lat: 41.1130, lng: -74.1487, line: "MBL", rideMin: 60, fare: 11.25 },

  // PVL
  { id: "hackensack", name: "Hackensack", lat: 40.8903, lng: -74.0437, line: "PVL", rideMin: 45, fare: 8.25 },
];

// NJ Transit frequency by period
const NJT_FREQ = {
  "am-rush": 12, "pm-rush": 15, midday: 30, evening: 30,
  "late-night": null, "early-morning": null, weekend: 60,
};

// ---- PATH → NJT Transfer Points ----
// Where you can exit PATH and board NJ Transit
const PATH_NJT_TRANSFERS = [
  {
    pathStation: "newark-penn",
    njtStation: "newark-penn",
    name: "Newark Penn Station",
    lat: 40.7345, lng: -74.1642,
    transferMin: 8, // walk between PATH and NJT platforms
    pathLine: "WTC-NWK",
    pathRideMin: 28,
    njtLines: ["NEC", "NJCL", "M&E", "RVL"], // NJT lines accessible here
  },
  {
    pathStation: "hoboken",
    njtStation: "hoboken",
    name: "Hoboken Terminal",
    lat: 40.7352, lng: -74.0282,
    transferMin: 5,
    pathLine: "WTC-HOB",
    pathRideMin: 14,
    pathLine33: "33-HOB",
    pathRideMin33: 12,
    njtLines: ["M-B", "MBL", "PVL"], // NJT lines from Hoboken
  },
];

// NJT stations reachable from Hoboken Terminal (different set from Penn)
const NJT_FROM_HOBOKEN = [
  { id: "secaucus-hob", name: "Secaucus Jct", lat: 40.7617, lng: -74.0755, line: "MBL", rideMin: 8, fare: 3.50 },
  { id: "rutherford-hob", name: "Rutherford", lat: 40.8263, lng: -74.1082, line: "MBL", rideMin: 20, fare: 5.00 },
  { id: "passaic-hob", name: "Passaic", lat: 40.8565, lng: -74.1244, line: "MBL", rideMin: 25, fare: 5.50 },
  { id: "clifton-hob", name: "Clifton", lat: 40.8700, lng: -74.1537, line: "MBL", rideMin: 30, fare: 6.25 },
  { id: "paterson-hob", name: "Paterson", lat: 40.9143, lng: -74.1715, line: "MBL", rideMin: 40, fare: 7.50 },
  { id: "ridgewood-hob", name: "Ridgewood", lat: 40.9800, lng: -74.1160, line: "MBL", rideMin: 45, fare: 8.25 },
  { id: "montclair-hob", name: "Montclair State U", lat: 40.8624, lng: -74.1991, line: "M-B", rideMin: 45, fare: 7.50 },
  { id: "wayne-hob", name: "Wayne", lat: 40.9261, lng: -74.2260, line: "M-B", rideMin: 50, fare: 8.25 },
  { id: "hackensack-hob", name: "Hackensack", lat: 40.8903, lng: -74.0437, line: "PVL", rideMin: 35, fare: 6.50 },
];

// ---- NJ Places for Autocomplete ----
const NJ_PLACES = [
  // Hudson County
  { name: "Hoboken", county: "Hudson", lat: 40.7440, lng: -74.0324 },
  { name: "Jersey City (Downtown)", county: "Hudson", lat: 40.7163, lng: -74.0327 },
  { name: "Jersey City (Journal Square)", county: "Hudson", lat: 40.7330, lng: -74.0630 },
  { name: "Jersey City (Heights)", county: "Hudson", lat: 40.7490, lng: -74.0530 },
  { name: "Bayonne", county: "Hudson", lat: 40.6687, lng: -74.1143 },
  { name: "Weehawken", county: "Hudson", lat: 40.7696, lng: -74.0206 },
  { name: "Union City", county: "Hudson", lat: 40.7679, lng: -74.0327 },
  { name: "North Bergen", county: "Hudson", lat: 40.8040, lng: -74.0121 },
  { name: "Secaucus", county: "Hudson", lat: 40.7868, lng: -74.0566 },
  { name: "Harrison", county: "Hudson", lat: 40.7465, lng: -74.1557 },
  { name: "Kearny", county: "Hudson", lat: 40.7538, lng: -74.1207 },
  { name: "Guttenberg", county: "Hudson", lat: 40.7921, lng: -74.0038 },
  { name: "West New York", county: "Hudson", lat: 40.7879, lng: -74.0143 },

  // Essex County
  { name: "Newark (Downtown)", county: "Essex", lat: 40.7357, lng: -74.1724 },
  { name: "Newark (Ironbound)", county: "Essex", lat: 40.7280, lng: -74.1530 },
  { name: "Newark Airport (EWR)", county: "Essex", lat: 40.6895, lng: -74.1745 },
  { name: "East Orange", county: "Essex", lat: 40.7673, lng: -74.2090 },
  { name: "West Orange", county: "Essex", lat: 40.7988, lng: -74.2391 },
  { name: "Orange", county: "Essex", lat: 40.7707, lng: -74.2327 },
  { name: "South Orange", county: "Essex", lat: 40.7484, lng: -74.2625 },
  { name: "Maplewood", county: "Essex", lat: 40.7313, lng: -74.2737 },
  { name: "Montclair", county: "Essex", lat: 40.8259, lng: -74.2090 },
  { name: "Bloomfield", county: "Essex", lat: 40.8068, lng: -74.1855 },
  { name: "Nutley", county: "Essex", lat: 40.8223, lng: -74.1590 },
  { name: "Millburn", county: "Essex", lat: 40.7258, lng: -74.3067 },
  { name: "Short Hills", county: "Essex", lat: 40.7253, lng: -74.3244 },
  { name: "Livingston", county: "Essex", lat: 40.7898, lng: -74.3150 },
  { name: "Caldwell", county: "Essex", lat: 40.8397, lng: -74.2776 },
  { name: "Glen Ridge", county: "Essex", lat: 40.8040, lng: -74.2037 },
  { name: "Verona", county: "Essex", lat: 40.8340, lng: -74.2418 },
  { name: "Cedar Grove", county: "Essex", lat: 40.8574, lng: -74.2286 },

  // Bergen County
  { name: "Fort Lee", county: "Bergen", lat: 40.8510, lng: -73.9712 },
  { name: "Hackensack", county: "Bergen", lat: 40.8861, lng: -74.0435 },
  { name: "Paramus", county: "Bergen", lat: 40.9448, lng: -74.0696 },
  { name: "Ridgewood", county: "Bergen", lat: 40.9793, lng: -74.1166 },
  { name: "Englewood", county: "Bergen", lat: 40.8929, lng: -73.9726 },
  { name: "Teaneck", county: "Bergen", lat: 40.8976, lng: -74.0115 },
  { name: "Bergenfield", county: "Bergen", lat: 40.9276, lng: -74.0014 },
  { name: "Glen Rock", county: "Bergen", lat: 40.9599, lng: -74.1318 },
  { name: "Rutherford", county: "Bergen", lat: 40.8263, lng: -74.1082 },
  { name: "Fair Lawn", county: "Bergen", lat: 40.9404, lng: -74.1318 },
  { name: "Edgewater", county: "Bergen", lat: 40.8270, lng: -73.9754 },
  { name: "Ramsey", county: "Bergen", lat: 41.0575, lng: -74.1412 },
  { name: "Mahwah", county: "Bergen", lat: 41.0887, lng: -74.1437 },
  { name: "Saddle Brook", county: "Bergen", lat: 40.8993, lng: -74.0924 },

  // Passaic County
  { name: "Paterson", county: "Passaic", lat: 40.9168, lng: -74.1718 },
  { name: "Passaic", county: "Passaic", lat: 40.8568, lng: -74.1285 },
  { name: "Clifton", county: "Passaic", lat: 40.8584, lng: -74.1638 },
  { name: "Wayne", county: "Passaic", lat: 40.9251, lng: -74.2429 },
  { name: "Totowa", county: "Passaic", lat: 40.9051, lng: -74.2265 },
  { name: "Little Falls", county: "Passaic", lat: 40.8818, lng: -74.2196 },
  { name: "Hawthorne", county: "Passaic", lat: 40.9488, lng: -74.1538 },

  // Union County
  { name: "Elizabeth", county: "Union", lat: 40.6640, lng: -74.2107 },
  { name: "Plainfield", county: "Union", lat: 40.6176, lng: -74.4173 },
  { name: "Westfield", county: "Union", lat: 40.6518, lng: -74.3473 },
  { name: "Summit", county: "Union", lat: 40.7156, lng: -74.3577 },
  { name: "Cranford", county: "Union", lat: 40.6571, lng: -74.3032 },
  { name: "Linden", county: "Union", lat: 40.6220, lng: -74.2446 },
  { name: "Rahway", county: "Union", lat: 40.6082, lng: -74.2774 },
  { name: "Scotch Plains", county: "Union", lat: 40.6548, lng: -74.3897 },
  { name: "New Providence", county: "Union", lat: 40.6984, lng: -74.4015 },
  { name: "Springfield", county: "Union", lat: 40.7041, lng: -74.3208 },
  { name: "Berkeley Heights", county: "Union", lat: 40.6796, lng: -74.4363 },
  { name: "Clark", county: "Union", lat: 40.6193, lng: -74.3088 },
  { name: "Roselle", county: "Union", lat: 40.6518, lng: -74.2614 },
  { name: "Kenilworth", county: "Union", lat: 40.6770, lng: -74.2907 },
  { name: "Union", county: "Union", lat: 40.6976, lng: -74.2632 },

  // Middlesex County
  { name: "New Brunswick", county: "Middlesex", lat: 40.4862, lng: -74.4518 },
  { name: "Edison", county: "Middlesex", lat: 40.5187, lng: -74.4121 },
  { name: "Woodbridge", county: "Middlesex", lat: 40.5576, lng: -74.2846 },
  { name: "Perth Amboy", county: "Middlesex", lat: 40.5076, lng: -74.2654 },
  { name: "Metuchen", county: "Middlesex", lat: 40.5431, lng: -74.3632 },
  { name: "Piscataway", county: "Middlesex", lat: 40.5529, lng: -74.4615 },
  { name: "Old Bridge", county: "Middlesex", lat: 40.4153, lng: -74.3076 },
  { name: "Sayreville", county: "Middlesex", lat: 40.4592, lng: -74.3610 },
  { name: "South Brunswick", county: "Middlesex", lat: 40.3835, lng: -74.5331 },
  { name: "East Brunswick", county: "Middlesex", lat: 40.4276, lng: -74.4159 },
  { name: "North Brunswick", county: "Middlesex", lat: 40.4515, lng: -74.4773 },

  // Mercer County
  { name: "Princeton", county: "Mercer", lat: 40.3573, lng: -74.6672 },
  { name: "Trenton", county: "Mercer", lat: 40.2171, lng: -74.7429 },
  { name: "Hamilton", county: "Mercer", lat: 40.2273, lng: -74.6776 },
  { name: "West Windsor", county: "Mercer", lat: 40.3162, lng: -74.6220 },
  { name: "Lawrence", county: "Mercer", lat: 40.2952, lng: -74.7243 },

  // Morris County
  { name: "Morristown", county: "Morris", lat: 40.7968, lng: -74.4815 },
  { name: "Parsippany", county: "Morris", lat: 40.8579, lng: -74.4257 },
  { name: "Dover", county: "Morris", lat: 40.8840, lng: -74.5586 },
  { name: "Madison", county: "Morris", lat: 40.7598, lng: -74.4168 },
  { name: "Chatham", county: "Morris", lat: 40.7407, lng: -74.3850 },
  { name: "Denville", county: "Morris", lat: 40.8932, lng: -74.4776 },
  { name: "Boonton", county: "Morris", lat: 40.9040, lng: -74.4071 },
  { name: "Morris Plains", county: "Morris", lat: 40.8232, lng: -74.4816 },
  { name: "Randolph", county: "Morris", lat: 40.8482, lng: -74.5769 },
  { name: "Rockaway", county: "Morris", lat: 40.9006, lng: -74.5141 },

  // Somerset County
  { name: "Somerville", county: "Somerset", lat: 40.5740, lng: -74.6099 },
  { name: "Bound Brook", county: "Somerset", lat: 40.5684, lng: -74.5381 },
  { name: "Bridgewater", county: "Somerset", lat: 40.5934, lng: -74.6329 },
  { name: "Franklin (Somerset)", county: "Somerset", lat: 40.4960, lng: -74.5541 },
  { name: "Basking Ridge", county: "Somerset", lat: 40.7087, lng: -74.5548 },

  // Monmouth County
  { name: "Red Bank", county: "Monmouth", lat: 40.3476, lng: -74.0646 },
  { name: "Long Branch", county: "Monmouth", lat: 40.2987, lng: -73.9924 },
  { name: "Asbury Park", county: "Monmouth", lat: 40.2201, lng: -74.0121 },
  { name: "Freehold", county: "Monmouth", lat: 40.2596, lng: -74.2735 },
  { name: "Middletown", county: "Monmouth", lat: 40.3941, lng: -74.1148 },
  { name: "Holmdel", county: "Monmouth", lat: 40.3736, lng: -74.1818 },
  { name: "Spring Lake", county: "Monmouth", lat: 40.1531, lng: -74.0283 },
  { name: "Bay Head", county: "Monmouth", lat: 40.0765, lng: -74.0488 },
  { name: "Matawan", county: "Monmouth", lat: 40.4134, lng: -74.2293 },
  { name: "Marlboro", county: "Monmouth", lat: 40.3429, lng: -74.2468 },
  { name: "Colts Neck", county: "Monmouth", lat: 40.2921, lng: -74.1729 },
  { name: "Tinton Falls", county: "Monmouth", lat: 40.2598, lng: -74.0885 },

  // Ocean County
  { name: "Toms River", county: "Ocean", lat: 39.9537, lng: -74.1979 },
  { name: "Lakewood", county: "Ocean", lat: 40.0968, lng: -74.2179 },
  { name: "Point Pleasant", county: "Ocean", lat: 40.0835, lng: -74.0681 },
  { name: "Brick", county: "Ocean", lat: 40.0579, lng: -74.1094 },
  { name: "Jackson", county: "Ocean", lat: 40.0993, lng: -74.3585 },

  // Camden County
  { name: "Cherry Hill", county: "Camden", lat: 39.9357, lng: -75.0231 },
  { name: "Camden", county: "Camden", lat: 39.9260, lng: -75.1196 },
  { name: "Haddonfield", county: "Camden", lat: 39.8915, lng: -75.0366 },
  { name: "Voorhees", county: "Camden", lat: 39.8416, lng: -74.9529 },
  { name: "Collingswood", county: "Camden", lat: 39.9185, lng: -75.0712 },

  // Atlantic County
  { name: "Atlantic City", county: "Atlantic", lat: 39.3643, lng: -74.4229 },
  { name: "Egg Harbor Township", county: "Atlantic", lat: 39.3817, lng: -74.5786 },
  { name: "Hammonton", county: "Atlantic", lat: 39.6415, lng: -74.8023 },

  // Other
  { name: "Cape May", county: "Cape May", lat: 38.9351, lng: -74.9060 },
  { name: "Wildwood", county: "Cape May", lat: 38.9920, lng: -74.8149 },
  { name: "Suffern", county: "Rockland", lat: 41.1130, lng: -74.1487 },
];
