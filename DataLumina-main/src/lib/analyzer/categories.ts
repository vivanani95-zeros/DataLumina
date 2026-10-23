import type { CategoryGroup } from "./types.ts";

export type CategoryDef = {
  id: string;
  group: CategoryGroup;
  label: string;
  description: string;
  keys: string[];
};

export const CATEGORIES: CategoryDef[] = [
  {
    id: "legal_identity",
    group: "biometric",
    label: "Legal Identity",
    description: "Full name, aliases, government IDs, date of birth, and gender.",
    keys: [
      "full_name", "fullname", "name", "first_name", "last_name", "given_name", "surname",
      "alias", "aka", "nickname", "legal_name", "dob", "date_of_birth", "birthdate", "birthday",
      "gender", "sex", "ssn", "social_security", "national_id", "govt_id", "government_id",
      "passport", "driver_license", "dl_number", "id_number", "citizen_id",
      "email", "email_address", "phone", "mobile", "telephone", "tel",
    ],
  },
  {
    id: "facial_geometry",
    group: "biometric",
    label: "Facial Geometry",
    description: "Relative distances between eyes, nose, and jawline structure vectors.",
    keys: [
      "facial", "face_vector", "jawline", "interocular", "eye_distance", "nose_bridge",
      "landmark", "face_embedding", "face_id", "facial_geometry",
    ],
  },
  {
    id: "voiceprint",
    group: "biometric",
    label: "Voiceprint Architecture",
    description: "Vocal frequency, fundamental pitch, resonance, and speech impediments.",
    keys: [
      "voiceprint", "pitch", "fundamental_frequency", "f0", "formant", "resonance",
      "speech_rate", "voice_id", "vocal", "mfcc",
    ],
  },
  {
    id: "fingerprint",
    group: "biometric",
    label: "Fingerprint Topology",
    description: "Minutiae points, ridge counts, and friction ridge patterns.",
    keys: ["fingerprint", "minutiae", "ridge_count", "ridge", "friction_ridge", "finger_id"],
  },
  {
    id: "iris",
    group: "biometric",
    label: "Retinal / Iris Patterns",
    description: "Iris cellular structure and retinal blood-vessel layouts.",
    keys: ["iris", "retina", "retinal", "pupil", "pupillary", "iris_code"],
  },
  {
    id: "gait",
    group: "biometric",
    label: "Gait Analysis",
    description: "Walking speed, stride length, hip bounce, and skeletal swing angles.",
    keys: ["gait", "stride", "walking_speed", "hip_bounce", "swing_angle", "step_length", "cadence_walk"],
  },
  {
    id: "typing",
    group: "biometric",
    label: "Typing Cadence",
    description: "Keystroke dynamics, hold time, flight time, and error rates.",
    keys: [
      "keystroke", "dwell_time", "hold_time", "flight_time", "typing_speed", "wpm",
      "error_rate", "keydown", "keyup", "typing_cadence",
    ],
  },
  {
    id: "swipe",
    group: "biometric",
    label: "Swiping Signature",
    description: "Finger pressure, swipe velocity, curvature, and lift-off angles.",
    keys: ["swipe", "swipe_velocity", "pressure", "lift_off", "touch_pressure", "curvature", "arc"],
  },
  {
    id: "hrv",
    group: "biometric",
    label: "Heart Rate Variability",
    description: "Passive pulse metrics from optical sensors or wearables.",
    keys: ["hrv", "heart_rate", "bpm", "rri", "rmssd", "pulse", "sdnn", "ppg"],
  },
  {
    id: "spo2",
    group: "biometric",
    label: "Blood Oxygenation",
    description: "Photoplethysmography (PPG) log variations over time.",
    keys: ["spo2", "blood_oxygen", "oxygenation", "o2sat", "oxygen_sat"],
  },
  {
    id: "sleep",
    group: "biometric",
    label: "Sleep Architecture",
    description: "REM, deep sleep, and light sleep cycle durations.",
    keys: ["sleep", "rem", "deep_sleep", "light_sleep", "sleep_stage", "sleep_cycle", "awake_min"],
  },
  {
    id: "hardware",
    group: "device",
    label: "Hardware Profile",
    description: "Manufacturer, motherboard, CPU architecture, and GPU specs.",
    keys: [
      "manufacturer", "motherboard", "cpu", "gpu", "chipset", "device_model", "model",
      "architecture", "hardware", "device_name", "product_name", "soc",
    ],
  },
  {
    id: "peripherals",
    group: "device",
    label: "Peripheral Inventory",
    description: "Paired Bluetooth devices, external monitors, and audio inputs.",
    keys: ["bluetooth", "monitor", "peripheral", "headset", "audio_jack", "paired_device", "hid"],
  },
  {
    id: "battery",
    group: "device",
    label: "Battery Degradation",
    description: "Maximum charge capacity, discharge curves, and cell temperature.",
    keys: ["battery", "charge_capacity", "discharge", "battery_health", "cycle_count", "cell_temp"],
  },
  {
    id: "storage",
    group: "device",
    label: "Storage Matrix",
    description: "Capacity, free blocks, directory structure, and media counts.",
    keys: ["storage", "disk", "capacity_gb", "free_space", "directory", "media_count", "filesystem"],
  },
  {
    id: "os",
    group: "device",
    label: "Operating System State",
    description: "Kernel version, patch levels, daemons, and uptime.",
    keys: ["os", "operating_system", "kernel", "patch", "uptime", "daemon", "build_number", "os_version"],
  },
  {
    id: "apps",
    group: "device",
    label: "App Ecosystem",
    description: "Installed packages, granted permissions, and usage frequencies.",
    keys: ["installed_app", "package", "permission", "usage_minutes", "app_name", "bundle_id"],
  },
  {
    id: "network",
    group: "device",
    label: "Network Fingerprint",
    description: "Local IP, public IP, MAC address, ISP, and VPN signatures.",
    keys: [
      "ip", "local_ip", "public_ip", "ip_address", "mac", "mac_address", "isp", "vpn",
      "asn", "hostname", "interface",
    ],
  },
  {
    id: "wifi",
    group: "device",
    label: "Wi-Fi Environment",
    description: "SSIDs, BSSIDs, and signal strengths of surrounding routers.",
    keys: ["ssid", "bssid", "wifi", "rssi", "wifi_signal", "router", "access_point"],
  },
  {
    id: "cellular",
    group: "device",
    label: "Cellular Data",
    description: "Tower ID, signal attenuation, roaming, and carrier config.",
    keys: ["cell_tower", "tower_id", "carrier", "roaming", "mcc", "mnc", "lac", "cid", "cellular"],
  },
  {
    id: "browser",
    group: "device",
    label: "Browser Signature",
    description: "User-agent, canvas seed, screen resolution, and font lists.",
    keys: [
      "user_agent", "useragent", "ua", "canvas_hash", "canvas_seed", "screen_resolution",
      "fonts", "font_list", "webgl_hash", "timezone", "language", "platform",
    ],
  },
  {
    id: "gps",
    group: "spatial",
    label: "GPS Coordinates",
    description: "Latitude, longitude, and altitude vectors.",
    keys: ["gps", "latitude", "longitude", "lat", "lng", "lon", "altitude", "alt", "geolocation", "coords"],
  },
  {
    id: "velocity",
    group: "spatial",
    label: "Velocity Metrics",
    description: "Accelerometer speed, braking forces, and cornering gravity.",
    keys: ["velocity", "speed", "accelerometer", "braking", "accel", "g_force", "cornering"],
  },
  {
    id: "orientation",
    group: "spatial",
    label: "Spatial Orientation",
    description: "Gyroscope tilt, rotation, roll, and device orientation.",
    keys: ["gyroscope", "tilt", "roll", "yaw", "orientation", "rotation", "heading", "compass"],
  },
  {
    id: "baro",
    group: "spatial",
    label: "Barometric Pressure",
    description: "Atmospheric weight indicating floor level or elevation.",
    keys: ["barometer", "barometric", "pressure_hpa", "atm_pressure", "elevation", "floor_level"],
  },
  {
    id: "light",
    group: "spatial",
    label: "Ambient Light",
    description: "Lux levels tracking outdoor brightness vs indoor illumination.",
    keys: ["lux", "ambient_light", "illuminance", "brightness_lux"],
  },
  {
    id: "acoustic",
    group: "spatial",
    label: "Acoustic Noise Floor",
    description: "Decibel levels of surrounding noise.",
    keys: ["decibel", "db", "noise_floor", "ambient_noise", "spl"],
  },
  {
    id: "proximity",
    group: "spatial",
    label: "Proximity Status",
    description: "Infrared logs showing pocket, bag, or ear placement.",
    keys: ["proximity", "in_pocket", "near_ear", "ir_proximity"],
  },
  {
    id: "thermal",
    group: "spatial",
    label: "Thermal Telemetry",
    description: "Internal temperatures indicating heat exposure or heavy processing.",
    keys: ["temperature", "thermal", "cpu_temp", "battery_temp", "skin_temp"],
  },
  {
    id: "hover",
    group: "clickstream",
    label: "Micro-Hovering",
    description: "Millisecond pauses of a cursor or finger over specific pixels.",
    keys: ["hover", "hover_ms", "mouse_pause", "dwell_px", "pointer_pause"],
  },
  {
    id: "scroll",
    group: "clickstream",
    label: "Scroll Speed",
    description: "Acceleration and deceleration through feeds or articles.",
    keys: ["scroll", "scroll_speed", "scroll_accel", "scroll_depth"],
  },
  {
    id: "click",
    group: "clickstream",
    label: "Click / Tap Vectors",
    description: "Coordinates of every screen touch and misclick.",
    keys: ["click_x", "click_y", "tap_x", "tap_y", "touch_x", "touch_y", "page_x", "page_y", "client_x"],
  },
  {
    id: "search",
    group: "clickstream",
    label: "Search Context",
    description: "Search text, skipped suggestions, and query refinements.",
    keys: ["search_query", "query", "search_text", "refinement", "suggest_skipped", "q"],
  },
  {
    id: "watch",
    group: "clickstream",
    label: "Watch Time",
    description: "Video consumption down to the frame, including loops and skips.",
    keys: ["watch_time", "video_progress", "playback", "seek", "replay", "timecode"],
  },
  {
    id: "audio_metrics",
    group: "clickstream",
    label: "Audio Metrics",
    description: "Volume adjustments, track skips, and headphone plug events.",
    keys: ["volume", "skip_track", "headphone", "audio_event", "mute"],
  },
  {
    id: "tabs",
    group: "clickstream",
    label: "Tab Behavior",
    description: "Open windows, background idle time, and rapid tab switching.",
    keys: ["tab_count", "idle_time", "tab_switch", "window_count", "hidden_ms"],
  },
  {
    id: "notification",
    group: "clickstream",
    label: "Notification Response",
    description: "Time elapsed between a banner appearing and a user click.",
    keys: ["notification", "notif_latency", "banner_click", "push_open"],
  },
  {
    id: "vocab",
    group: "language",
    label: "Vocabulary Breadth",
    description: "Lexical diversity, preferred synonyms, and reading level.",
    keys: ["vocabulary", "lexical", "ttr", "reading_level", "word_count", "unique_words"],
  },
  {
    id: "syntax",
    group: "language",
    label: "Syntactic Structure",
    description: "Sentence complexity, punctuation frequencies, and grammar.",
    keys: ["sentence_length", "punctuation", "syntax", "grammar", "complexity"],
  },
  {
    id: "slang",
    group: "language",
    label: "Slang & Dialect",
    description: "Regional colloquialisms, emoji use, and code-switching.",
    keys: ["slang", "dialect", "emoji", "colloquial", "code_switch", "locale_lang"],
  },
  {
    id: "sentiment",
    group: "language",
    label: "Sentiment Metrics",
    description: "Polarity of emotion, mood shifts, and underlying tone.",
    keys: ["sentiment", "polarity", "mood", "tone", "emotion"],
  },
  {
    id: "topics",
    group: "language",
    label: "Topic Distribution",
    description: "Clustering of conversation subjects across channels.",
    keys: ["topic", "subject", "category_label", "cluster"],
  },
  {
    id: "spam",
    group: "language",
    label: "Spam Tendencies",
    description: "Phishing keywords, deceptive links, and outbound velocity.",
    keys: ["phishing", "spam", "deceptive", "scam", "outbound_rate"],
  },
  {
    id: "purchasing",
    group: "financial",
    label: "Purchasing Power",
    description: "Bank balances, card types, and available credit limits.",
    keys: [
      "balance", "credit_limit", "bank", "account_balance", "available_credit",
      "card_type", "iban", "account_number",
    ],
  },
  {
    id: "transactions",
    group: "financial",
    label: "Transaction Velocity",
    description: "Purchase frequency, average basket size, and weekend surges.",
    keys: [
      "transaction", "purchase", "amount", "basket", "spend", "payment_amount",
      "txn", "debit", "credit", "merchant",
    ],
  },
  {
    id: "payment",
    group: "financial",
    label: "Payment Formats",
    description: "Preferred checkouts: Apple Pay, PayPal, crypto, card entry.",
    keys: ["payment_method", "apple_pay", "paypal", "checkout", "card_brand", "crypto_pay"],
  },
  {
    id: "subscriptions",
    group: "financial",
    label: "Subscription Overhead",
    description: "Recurring monthly bills, streaming packages, and utilities.",
    keys: ["subscription", "recurring", "monthly_bill", "plan", "renewal"],
  },
  {
    id: "risk",
    group: "financial",
    label: "Risk Score",
    description: "Default probabilities, late payments, and overdraft history.",
    keys: ["risk_score", "default_prob", "late_payment", "overdraft", "delinquency", "fico", "credit_score"],
  },
  {
    id: "investment",
    group: "financial",
    label: "Investment Profile",
    description: "Stock holdings, crypto wallets, and risk tolerance.",
    keys: [
      "stock", "holding", "portfolio", "wallet", "crypto", "btc", "eth", "ticker",
      "risk_tolerance", "brokerage",
    ],
  },
  {
    id: "interaction",
    group: "social",
    label: "Interaction Nodes",
    description: "Strongest communication links by call and message volume.",
    keys: ["call_count", "message_count", "contact", "thread_id", "chat_partner", "sms_count"],
  },
  {
    id: "colocation",
    group: "social",
    label: "Social Proximity",
    description: "Co-location events showing who a user spends time with.",
    keys: ["colocation", "co_location", "nearby_user", "together_min", "shared_location"],
  },
  {
    id: "influence",
    group: "social",
    label: "Influence Metrics",
    description: "Centrality, follower counts, and shared-link virality.",
    keys: ["followers", "centrality", "influence", "virality", "following", "impressions"],
  },
  {
    id: "relationship",
    group: "social",
    label: "Relationship Status",
    description: "Inferred relationship changes from contact graph shifts.",
    keys: ["relationship", "marital", "partner", "spouse", "status_rel"],
  },
  {
    id: "professional",
    group: "social",
    label: "Professional Hierarchy",
    description: "Job titles, workplace peer groups, and reporting lines.",
    keys: ["job_title", "title", "employer", "workplace", "manager", "reports_to", "department", "company"],
  },
  {
    id: "cognitive",
    group: "psychological",
    label: "Cognitive Load",
    description: "Slower reactions and typing errors indicating fatigue.",
    keys: ["reaction_time", "fatigue", "cognitive_load", "attention", "error_count"],
  },
  {
    id: "impulsivity",
    group: "psychological",
    label: "Impulsivity Index",
    description: "Late-night purchases and rapid app hopping.",
    keys: ["impulsivity", "late_night", "app_hop", "impulse_buy"],
  },
  {
    id: "insecurity",
    group: "psychological",
    label: "Insecurity Vectors",
    description: "Health symptoms searched, relationship advice, financial stress.",
    keys: ["insecurity", "health_search", "stress", "anxiety_query"],
  },
  {
    id: "ideology",
    group: "psychological",
    label: "Ideological Stance",
    description: "Political leaning, religious adherence, sensitive-topic alignment.",
    keys: ["political", "religion", "ideology", "affiliation"],
  },
  {
    id: "susceptibility",
    group: "psychological",
    label: "Susceptibility Vectors",
    description: "Vulnerability to fear, urgency, and FOMO advertising frames.",
    keys: ["fomo", "urgency", "susceptibility", "ad_frame"],
  },
  {
    id: "lifestage",
    group: "psychological",
    label: "Life Stage Prediction",
    description: "Inferred pregnancy, retirement, divorce, or home purchase.",
    keys: ["pregnancy", "retirement", "divorce", "home_purchase", "life_stage"],
  },
  {
    id: "addiction",
    group: "psychological",
    label: "Addiction Tendencies",
    description: "Gambling patterns, infinite-scroll loops, gaming session length.",
    keys: ["gambling", "infinite_scroll", "gaming_session", "addiction", "session_length"],
  },
  {
    id: "embeddings",
    group: "training",
    label: "Semantic Embeddings",
    description: "High-dimensional vector coordinates representing text meaning.",
    keys: ["embedding", "vector", "latent", "dim"],
  },
  {
    id: "corrections",
    group: "training",
    label: "Correction Vectors",
    description: "Rephrased inputs, spell-check acceptances, and translation fixes.",
    keys: ["correction", "spellcheck", "rephrase", "translation_fix"],
  },
  {
    id: "anomalous",
    group: "training",
    label: "Anomalous Profiles",
    description: "Outlier behavior flags used to establish statistical baselines.",
    keys: ["outlier", "anomaly", "anomalous", "zscore", "baseline_flag"],
  },
  {
    id: "labels",
    group: "training",
    label: "Labels & Ground Truth",
    description: "Captcha selections, image tags, and content reports.",
    keys: ["label", "captcha", "ground_truth", "image_tag", "content_report"],
  },
];

export const CATEGORY_BY_ID = new Map(CATEGORIES.map((c) => [c.id, c]));

export const GROUP_LABEL: Record<CategoryGroup, string> = {
  biometric: "Biometric & Physiological",
  device: "Device & Network Telemetry",
  spatial: "Spatial & Environmental",
  clickstream: "Digital Consumption & Clickstream",
  language: "Natural Language & Communication",
  financial: "Financial Profile & Transactions",
  social: "Social Graph & Relationship Context",
  psychological: "Psychological & Inferred States",
  training: "AI Training & Feedback Loops",
};

const KEY_INDEX = new Map<string, string[]>();
for (const cat of CATEGORIES) {
  for (const key of cat.keys) {
    const list = KEY_INDEX.get(key) ?? [];
    list.push(cat.id);
    KEY_INDEX.set(key, list);
  }
}

export function normalizeKey(input: string): string {
  return input
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

// Field names repeat across rows, and the answer depends only on the name: memoise it (bounded).
const MATCH_MEMO = new Map<string, { id: string; score: number }[]>();

export function matchCategoryIds(field: string): { id: string; score: number }[] {
  const hit = MATCH_MEMO.get(field);
  if (hit) return hit.slice();
  const result = matchCategoryIdsUncached(field);
  if (MATCH_MEMO.size < 5_000) MATCH_MEMO.set(field, result);
  return result.slice();
}

function matchCategoryIdsUncached(field: string): { id: string; score: number }[] {
  const n = normalizeKey(field);
  if (!n) return [];
  const hits = new Map<string, number>();
  const tokens = n.split("_").filter(Boolean);

  const exact = KEY_INDEX.get(n);
  if (exact) {
    for (const id of exact) hits.set(id, Math.max(hits.get(id) ?? 0, 0.95));
  }

  for (const cat of CATEGORIES) {
    for (const key of cat.keys) {
      if (key === n) continue;
      const keyTokens = key.split("_").filter(Boolean);
      const tokenHit =
        (key.length >= 3 && tokens.includes(key)) ||
        (keyTokens.length > 1 && keyTokens.every((kt) => kt.length > 2 && tokens.includes(kt)));
      if (tokenHit) {
        hits.set(cat.id, Math.max(hits.get(cat.id) ?? 0, 0.84));
        continue;
      }
      if (key.length >= 5 && n.includes(key)) {
        const score = key.length / n.length;
        if (score >= 0.55) hits.set(cat.id, Math.max(hits.get(cat.id) ?? 0, 0.72 + score * 0.15));
      }
    }
  }

  return [...hits.entries()]
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score);
}
