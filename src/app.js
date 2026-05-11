(() => {
const { GAME_CONFIG, MODES, OBJECTS } = window.AGE_GAME_DATA;
const backend = window.AGE_GAME_SUPABASE;

const app = document.querySelector("#app");
const todayKey = new Date().toISOString().slice(0, 10);

let state = {
  mode: "timeline",
  timelineObjectId: null,
  imaginedObjectId: null,
  dailyGuess: GAME_CONFIG.defaultGuessYear,
  timelineGuess: GAME_CONFIG.defaultGuessYear,
  imaginedGuess: GAME_CONFIG.defaultGuessYear,
  timelineResult: null,
  imaginedResult: null,
  olderResult: null,
  olderChoice: null,
  olderGapGuess: "",
  olderDifficulty: "medium",
  olderPair: null,
  submitImage: "",
  submitFile: null,
  submitMessage: "",
  hintIndex: 0,
  serverObjects: [],
  backendLoading: false,
  backendMessage: "",
  backendError: "",
  user: null,
  isAdmin: false,
};

function readJson(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function getUploads() {
  return readJson(GAME_CONFIG.localStorageKeys.uploads, []);
}

function getDailyResults() {
  return readJson(GAME_CONFIG.localStorageKeys.daily, {});
}

function getObjects() {
  return [...getSeedObjects(), ...getPlayableServerObjects(), ...getFallbackUploads()].filter((item) => {
    return item.yearStart >= GAME_CONFIG.yearMin && item.yearEnd <= GAME_CONFIG.yearMax;
  });
}

function getSeedObjects() {
  return GAME_CONFIG.seedObjectsEnabled ? OBJECTS : [];
}

function getPlayableServerObjects() {
  return state.serverObjects.filter((item) => item.status === "approved");
}

function getFallbackUploads() {
  return backend?.isReady() ? [] : getUploads();
}

function getPendingObjects() {
  return state.serverObjects.filter((item) => item.status === "pending");
}

function getObjectById(id) {
  return getObjects().find((item) => item.id === id) ?? getTimelinePool()[0];
}

function getTimelinePool() {
  return getObjects().filter((item) => item.sourceType !== "imagined");
}

function getImaginedPool() {
  return getObjects().filter((item) => item.sourceType === "imagined");
}

function midpoint(item) {
  return Math.round((item.yearStart + item.yearEnd) / 2);
}

function getYearDistance(item, guess) {
  if (guess >= item.yearStart && guess <= item.yearEnd) return 0;
  if (guess < item.yearStart) return item.yearStart - guess;
  return guess - item.yearEnd;
}

function scoreTimeline(item, guess) {
  const distance = getYearDistance(item, guess);
  if (distance === 0) return 1000;
  return Math.max(0, Math.round(1000 - distance * 18));
}

function scoreGapBonus(pair, guess) {
  if (!guess) return 0;
  const numericGuess = Number(guess);
  if (!Number.isFinite(numericGuess)) return 0;
  const actualGap = Math.abs(midpoint(pair.left) - midpoint(pair.right));
  const miss = Math.abs(numericGuess - actualGap);
  return Math.max(0, 250 - miss * 35);
}

function hashString(value) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash);
}

function chooseBySeed(pool, seed) {
  return pool[seed % pool.length];
}

function chooseRandom(pool, excludeId = "") {
  const available = pool.filter((item) => item.id !== excludeId);
  return available[Math.floor(Math.random() * available.length)] ?? pool[0];
}

function startTimelineRound() {
  const item = chooseRandom(getTimelinePool(), state.timelineObjectId);
  state.timelineObjectId = item.id;
  state.timelineGuess = GAME_CONFIG.defaultGuessYear;
  state.timelineResult = null;
  state.hintIndex = 0;
  render();
}

function startImaginedRound() {
  const item = chooseRandom(getImaginedPool(), state.imaginedObjectId);
  state.imaginedObjectId = item.id;
  state.imaginedGuess = GAME_CONFIG.defaultGuessYear;
  state.imaginedResult = null;
  state.hintIndex = 0;
  render();
}

function startOlderRound() {
  const pair = makeOlderPair(state.olderDifficulty);
  state.olderPair = pair;
  state.olderChoice = null;
  state.olderGapGuess = "";
  state.olderResult = null;
  render();
}

function makeOlderPair(difficulty) {
  const pool = getTimelinePool();
  const rule = GAME_CONFIG.olderNewerDifficulty[difficulty];
  const shuffled = [...pool].sort(() => Math.random() - 0.5);

  for (const left of shuffled) {
    const match = shuffled.find((right) => {
      if (right.id === left.id) return false;
      const gap = Math.abs(midpoint(left) - midpoint(right));
      return gap >= rule.minGap && gap <= rule.maxGap;
    });
    if (match) {
      return Math.random() > 0.5 ? { left, right: match } : { left: match, right: left };
    }
  }

  const left = chooseRandom(pool);
  const right = chooseRandom(pool, left.id);
  return { left, right };
}

function getDailyObject() {
  const pool = getTimelinePool();
  return chooseBySeed(pool, hashString(todayKey));
}

function setMode(mode) {
  state.mode = mode;
  state.hintIndex = 0;

  if (mode === "timeline" && !state.timelineObjectId) startTimelineRound();
  if (mode === "imagined" && !state.imaginedObjectId) startImaginedRound();
  if (mode === "olderNewer" && !state.olderPair) startOlderRound();

  render();
}

async function initializeBackend() {
  if (!backend?.isReady()) {
    state.backendMessage = backend?.getDisabledReason?.() || "Supabase is not configured yet.";
    render();
    return;
  }

  state.backendLoading = true;
  state.backendError = "";
  render();

  try {
    const session = await backend.getSession();
    state.user = session.user;
    state.isAdmin = await backend.isAdmin();
    await refreshBackendObjects(false);
    state.backendMessage = state.isAdmin
      ? "Connected as admin."
      : state.user
        ? "Connected. Your submissions will wait for admin approval."
        : "Connected. Sign in to submit objects.";
  } catch (error) {
    state.backendError = error.message || "Could not connect to Supabase.";
  } finally {
    state.backendLoading = false;
    render();
  }
}

async function refreshBackendObjects(shouldRender = true) {
  if (!backend?.isReady()) return;
  if (shouldRender) {
    state.backendLoading = true;
    render();
  }

  try {
    state.serverObjects = await backend.fetchObjects();
    state.backendError = "";
  } catch (error) {
    state.backendError = error.message || "Could not load Supabase objects.";
  } finally {
    state.backendLoading = false;
    if (shouldRender) render();
  }
}

async function signIn(form) {
  const formData = new FormData(form);
  const email = String(formData.get("email")).trim();
  if (!email) return;

  state.backendLoading = true;
  state.backendError = "";
  render();

  try {
    await backend.signIn(email);
    state.backendMessage = `Check ${email} for the sign-in link.`;
  } catch (error) {
    state.backendError = error.message || "Could not send sign-in link.";
  } finally {
    state.backendLoading = false;
    render();
  }
}

async function signOut() {
  state.backendLoading = true;
  render();

  try {
    await backend.signOut();
    state.user = null;
    state.isAdmin = false;
    state.serverObjects = [];
    state.backendMessage = "Signed out.";
    await refreshBackendObjects(false);
  } catch (error) {
    state.backendError = error.message || "Could not sign out.";
  } finally {
    state.backendLoading = false;
    render();
  }
}

async function reviewObject(id, status) {
  if (!state.isAdmin) return;
  state.backendLoading = true;
  render();

  try {
    await backend.updateStatus(id, status);
    state.backendMessage = status === "approved" ? "Object approved." : "Object rejected.";
    await refreshBackendObjects(false);
  } catch (error) {
    state.backendError = error.message || "Could not update object status.";
  } finally {
    state.backendLoading = false;
    render();
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeXml(value) {
  return escapeHtml(value);
}

function imageForObject(item) {
  if (item.imageUrl) return item.imageUrl;
  const svg = renderObjectSvg(item);
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function renderObjectMedia(item) {
  const image = imageForObject(item);
  if (item.imageUrl) {
    return `<div class="object-photo-image" role="img" aria-label="${escapeHtml(item.title)}" style="background-image: url('${escapeHtml(image)}')"></div>`;
  }

  return `<img src="${image}" alt="${escapeHtml(item.title)}" />`;
}

function renderObjectSvg(item) {
  const asset = item.asset ?? {};
  const primary = asset.primary ?? "#2F3542";
  const secondary = asset.secondary ?? "#F4F1E8";
  const accent = asset.accent ?? "#E8553E";
  const label = escapeXml(asset.label ?? item.category);
  const detail = escapeXml(asset.detail ?? item.brand);
  const title = escapeXml(item.title);

  const objectMarkup = getShapeMarkup(asset.shape, {
    primary,
    secondary,
    accent,
    label,
    detail,
  });

  return `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 650" role="img" aria-label="${title}">
      <defs>
        <pattern id="dots" width="28" height="28" patternUnits="userSpaceOnUse">
          <circle cx="2" cy="2" r="1.3" fill="#B8B2A2" opacity="0.35" />
        </pattern>
        <filter id="shadow" x="-20%" y="-20%" width="140%" height="150%">
          <feDropShadow dx="0" dy="18" stdDeviation="18" flood-color="#111820" flood-opacity="0.20"/>
        </filter>
      </defs>
      <rect width="900" height="650" fill="#F3F0E8"/>
      <rect width="900" height="650" fill="url(#dots)" />
      <rect x="120" y="520" width="660" height="38" rx="19" fill="#1C222A" opacity="0.08" />
      <g filter="url(#shadow)">
        ${objectMarkup}
      </g>
      <text x="450" y="600" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="22" font-weight="700" fill="#1B2028">${title}</text>
    </svg>
  `;
}

function getShapeMarkup(shape, colors) {
  const { primary, secondary, accent, label, detail } = colors;

  const shapes = {
    mixer: `
      <path d="M340 212 C360 152 494 146 526 216 L560 288 L330 288 Z" fill="${primary}"/>
      <rect x="310" y="282" width="270" height="82" rx="28" fill="${primary}"/>
      <rect x="392" y="356" width="104" height="84" rx="20" fill="${secondary}"/>
      <path d="M350 438 H544 C548 500 344 500 350 438 Z" fill="${secondary}" stroke="#1D242C" stroke-width="9"/>
      <circle cx="514" cy="244" r="20" fill="${accent}"/>
      <text x="447" y="257" text-anchor="middle" font-family="Arial" font-size="29" font-weight="800" fill="#fff">${label}</text>
      <text x="444" y="331" text-anchor="middle" font-family="Arial" font-size="18" font-weight="700" fill="#fff">${detail}</text>
    `,
    radio: `
      <rect x="285" y="205" width="330" height="245" rx="34" fill="${primary}"/>
      <rect x="318" y="244" width="142" height="152" rx="15" fill="${secondary}"/>
      <g stroke="#1E252D" stroke-width="7">
        <line x1="342" y1="270" x2="435" y2="270"/><line x1="342" y1="300" x2="435" y2="300"/>
        <line x1="342" y1="330" x2="435" y2="330"/><line x1="342" y1="360" x2="435" y2="360"/>
      </g>
      <rect x="488" y="250" width="88" height="38" rx="7" fill="#111820"/>
      <circle cx="532" cy="355" r="45" fill="${accent}"/>
      <circle cx="532" cy="355" r="19" fill="#101820"/>
      <text x="532" y="276" text-anchor="middle" font-family="Arial" font-size="18" font-weight="800" fill="#fff">${label}</text>
      <text x="532" y="424" text-anchor="middle" font-family="Arial" font-size="15" font-weight="700" fill="#fff">${detail}</text>
    `,
    "car-key": `
      <path d="M292 337 L455 242 L592 242 L628 286 L592 332 L628 374 L587 418 L455 418 Z" fill="${secondary}" stroke="#1B2028" stroke-width="10"/>
      <circle cx="376" cy="330" r="52" fill="${primary}" stroke="#1B2028" stroke-width="10"/>
      <path d="M502 286 H580 L546 322 L588 362 H501 Z" fill="${accent}"/>
      <circle cx="376" cy="330" r="22" fill="#F3F0E8" stroke="#1B2028" stroke-width="8"/>
      <text x="531" y="351" text-anchor="middle" font-family="Arial" font-size="28" font-weight="900" fill="#fff">${label}</text>
      <text x="376" y="410" text-anchor="middle" font-family="Arial" font-size="17" font-weight="700" fill="#1B2028">${detail}</text>
    `,
    "rotary-phone": `
      <path d="M268 337 C276 272 322 246 450 246 C578 246 624 272 632 337 L650 436 H250 Z" fill="${primary}"/>
      <rect x="272" y="182" width="356" height="72" rx="34" fill="${primary}"/>
      <circle cx="450" cy="358" r="91" fill="${secondary}" stroke="#0E1116" stroke-width="12"/>
      <circle cx="450" cy="358" r="35" fill="#F3F0E8" stroke="#0E1116" stroke-width="8"/>
      <g fill="#202630">
        <circle cx="450" cy="283" r="12"/><circle cx="519" cy="330" r="12"/><circle cx="493" cy="410" r="12"/>
        <circle cx="407" cy="410" r="12"/><circle cx="381" cy="330" r="12"/>
      </g>
      <text x="450" y="365" text-anchor="middle" font-family="Arial" font-size="20" font-weight="900" fill="${accent}">${label}</text>
      <text x="450" y="482" text-anchor="middle" font-family="Arial" font-size="18" font-weight="800" fill="#fff">${detail}</text>
    `,
    "instant-camera": `
      <rect x="272" y="230" width="356" height="230" rx="28" fill="${primary}"/>
      <rect x="300" y="258" width="300" height="82" rx="14" fill="${secondary}"/>
      <circle cx="450" cy="378" r="62" fill="#10151B" stroke="${accent}" stroke-width="16"/>
      <circle cx="450" cy="378" r="27" fill="#6C7883"/>
      <rect x="514" y="358" width="64" height="48" rx="9" fill="${secondary}"/>
      <rect x="319" y="364" width="72" height="26" rx="5" fill="${accent}"/>
      <text x="450" y="309" text-anchor="middle" font-family="Arial" font-size="21" font-weight="900" fill="#1B2028">${label}</text>
      <text x="355" y="425" text-anchor="middle" font-family="Arial" font-size="16" font-weight="800" fill="#fff">${detail}</text>
    `,
    calculator: `
      <path d="M302 190 H598 L638 460 H262 Z" fill="${primary}"/>
      <rect x="336" y="230" width="228" height="60" rx="9" fill="#170D0D"/>
      <text x="450" y="271" text-anchor="middle" font-family="monospace" font-size="42" font-weight="900" fill="${accent}">${label}</text>
      ${keyGrid(326, 318, secondary, accent)}
      <text x="450" y="486" text-anchor="middle" font-family="Arial" font-size="17" font-weight="900" fill="${secondary}">${detail}</text>
    `,
    joystick: `
      <rect x="304" y="332" width="292" height="122" rx="20" fill="${primary}"/>
      <path d="M450 206 C488 206 514 238 504 276 L484 348 H416 L396 276 C386 238 412 206 450 206 Z" fill="#1B2028"/>
      <circle cx="450" cy="196" r="43" fill="${secondary}"/>
      <circle cx="539" cy="392" r="32" fill="${accent}"/>
      <rect x="342" y="382" width="88" height="18" rx="9" fill="#59626C"/>
      <text x="381" y="424" text-anchor="middle" font-family="Arial" font-size="18" font-weight="900" fill="#fff">${label}</text>
      <text x="539" y="397" text-anchor="middle" font-family="Arial" font-size="15" font-weight="900" fill="#fff">${detail}</text>
    `,
    "cassette-player": `
      <rect x="276" y="202" width="348" height="250" rx="30" fill="${primary}"/>
      <rect x="318" y="256" width="264" height="116" rx="16" fill="${secondary}" stroke="#1B2028" stroke-width="8"/>
      <circle cx="389" cy="314" r="35" fill="#1C222A"/>
      <circle cx="511" cy="314" r="35" fill="#1C222A"/>
      <rect x="356" y="404" width="188" height="28" rx="8" fill="#1B2028"/>
      <g fill="${accent}">
        <rect x="330" y="218" width="40" height="20" rx="4"/><rect x="382" y="218" width="40" height="20" rx="4"/>
        <rect x="434" y="218" width="40" height="20" rx="4"/><rect x="486" y="218" width="40" height="20" rx="4"/>
      </g>
      <text x="450" y="244" text-anchor="middle" font-family="Arial" font-size="18" font-weight="900" fill="#1B2028">${label}</text>
      <text x="450" y="427" text-anchor="middle" font-family="Arial" font-size="15" font-weight="800" fill="#fff">${detail}</text>
    `,
    camcorder: `
      <rect x="270" y="246" width="376" height="162" rx="18" fill="${primary}"/>
      <rect x="308" y="210" width="184" height="54" rx="12" fill="${secondary}"/>
      <path d="M626 280 L716 256 V398 L626 374 Z" fill="${secondary}"/>
      <circle cx="660" cy="327" r="40" fill="#10151B"/>
      <circle cx="660" cy="327" r="21" fill="#6E7D8A"/>
      <rect x="322" y="292" width="188" height="70" rx="10" fill="#59636F"/>
      <circle cx="548" cy="327" r="30" fill="${accent}"/>
      <text x="416" y="337" text-anchor="middle" font-family="Arial" font-size="22" font-weight="900" fill="#fff">${label}</text>
      <text x="548" y="333" text-anchor="middle" font-family="Arial" font-size="15" font-weight="900" fill="#fff">${detail}</text>
    `,
    discman: `
      <circle cx="450" cy="330" r="142" fill="${primary}" stroke="#1B2028" stroke-width="10"/>
      <circle cx="450" cy="330" r="86" fill="${secondary}" stroke="#78838C" stroke-width="9"/>
      <circle cx="450" cy="330" r="18" fill="#1B2028"/>
      <rect x="372" y="456" width="156" height="34" rx="10" fill="#1B2028"/>
      <circle cx="560" cy="246" r="22" fill="${accent}"/>
      <text x="450" y="282" text-anchor="middle" font-family="Arial" font-size="19" font-weight="900" fill="#1B2028">${label}</text>
      <text x="450" y="479" text-anchor="middle" font-family="Arial" font-size="15" font-weight="800" fill="#fff">${detail}</text>
    `,
    sneaker: `
      <path d="M246 392 C330 386 374 332 424 294 L528 294 C540 334 584 362 665 382 C688 388 699 417 678 438 C584 462 378 464 244 438 C230 428 228 404 246 392 Z" fill="${primary}" stroke="#1B2028" stroke-width="9"/>
      <path d="M413 300 L510 300 L548 382 L328 382 C352 346 374 320 413 300 Z" fill="${secondary}"/>
      <path d="M330 388 C428 412 544 409 665 382 L680 422 C552 452 373 452 239 428 Z" fill="${accent}"/>
      <g stroke="#1B2028" stroke-width="7">
        <line x1="430" y1="322" x2="384" y2="371"/><line x1="473" y1="322" x2="430" y2="371"/>
        <line x1="514" y1="333" x2="474" y2="374"/>
      </g>
      <text x="535" y="363" text-anchor="middle" font-family="Arial" font-size="26" font-weight="900" fill="#1B2028">${label}</text>
      <text x="444" y="432" text-anchor="middle" font-family="Arial" font-size="15" font-weight="900" fill="#fff">${detail}</text>
    `,
    "brick-phone": `
      <rect x="363" y="190" width="174" height="320" rx="26" fill="${primary}"/>
      <line x1="505" y1="189" x2="558" y2="101" stroke="#1B2028" stroke-width="12" stroke-linecap="round"/>
      <rect x="393" y="235" width="114" height="62" rx="8" fill="${secondary}"/>
      <text x="450" y="273" text-anchor="middle" font-family="monospace" font-size="24" font-weight="900" fill="#1B2028">${label}</text>
      ${phoneKeys(394, 322, accent)}
      <text x="450" y="486" text-anchor="middle" font-family="Arial" font-size="15" font-weight="800" fill="#fff">${detail}</text>
    `,
    pager: `
      <rect x="304" y="244" width="292" height="166" rx="26" fill="${primary}"/>
      <rect x="342" y="286" width="216" height="55" rx="10" fill="${secondary}"/>
      <circle cx="361" cy="372" r="16" fill="${accent}"/>
      <rect x="394" y="360" width="142" height="25" rx="12" fill="#505963"/>
      <text x="450" y="323" text-anchor="middle" font-family="monospace" font-size="25" font-weight="900" fill="#1B2028">${label}</text>
      <text x="450" y="455" text-anchor="middle" font-family="Arial" font-size="16" font-weight="900" fill="#1B2028">${detail}</text>
    `,
    vhs: `
      <rect x="240" y="230" width="420" height="230" rx="20" fill="${primary}"/>
      <rect x="286" y="266" width="328" height="76" rx="9" fill="${secondary}"/>
      <circle cx="354" cy="390" r="46" fill="#0D1117" stroke="#626A74" stroke-width="11"/>
      <circle cx="546" cy="390" r="46" fill="#0D1117" stroke="#626A74" stroke-width="11"/>
      <rect x="390" y="365" width="120" height="50" rx="10" fill="#111820"/>
      <text x="450" y="314" text-anchor="middle" font-family="Arial" font-size="24" font-weight="900" fill="#1B2028">${label}</text>
      <text x="450" y="446" text-anchor="middle" font-family="Arial" font-size="22" font-weight="900" fill="${accent}">${detail}</text>
    `,
    desktop: `
      <rect x="286" y="182" width="328" height="282" rx="48" fill="${primary}" opacity="0.95"/>
      <rect x="338" y="228" width="224" height="152" rx="18" fill="${secondary}"/>
      <circle cx="450" cy="420" r="18" fill="${accent}"/>
      <rect x="382" y="478" width="136" height="22" rx="11" fill="${primary}"/>
      <text x="450" y="311" text-anchor="middle" font-family="Arial" font-size="34" font-weight="900" fill="#1B2028">${label}</text>
      <text x="450" y="456" text-anchor="middle" font-family="Arial" font-size="17" font-weight="800" fill="#1B2028">${detail}</text>
    `,
    "mp3-player": `
      <rect x="352" y="178" width="196" height="332" rx="32" fill="${primary}" stroke="#1B2028" stroke-width="8"/>
      <rect x="382" y="222" width="136" height="74" rx="10" fill="${secondary}"/>
      <circle cx="450" cy="388" r="70" fill="${secondary}" stroke="#C4CCD2" stroke-width="8"/>
      <circle cx="450" cy="388" r="27" fill="${primary}" stroke="#C4CCD2" stroke-width="5"/>
      <text x="450" y="266" text-anchor="middle" font-family="Arial" font-size="16" font-weight="900" fill="#1B2028">${label}</text>
      <text x="450" y="393" text-anchor="middle" font-family="Arial" font-size="14" font-weight="900" fill="#1B2028">${detail}</text>
    `,
    "flip-phone": `
      <g transform="rotate(-10 450 340)">
        <rect x="336" y="162" width="178" height="176" rx="20" fill="${primary}"/>
        <rect x="362" y="195" width="126" height="86" rx="10" fill="${accent}"/>
        <rect x="346" y="332" width="178" height="176" rx="20" fill="${secondary}"/>
        ${phoneKeys(371, 374, primary)}
      </g>
      <text x="450" y="247" text-anchor="middle" font-family="Arial" font-size="20" font-weight="900" fill="#fff">${label}</text>
      <text x="450" y="503" text-anchor="middle" font-family="Arial" font-size="15" font-weight="900" fill="#1B2028">${detail}</text>
    `,
    dslr: `
      <rect x="270" y="245" width="360" height="190" rx="24" fill="${primary}"/>
      <path d="M345 206 H456 L486 245 H316 Z" fill="${primary}"/>
      <circle cx="472" cy="340" r="82" fill="#0D1117" stroke="${secondary}" stroke-width="21"/>
      <circle cx="472" cy="340" r="38" fill="#677586"/>
      <rect x="310" y="282" width="76" height="58" rx="9" fill="${secondary}"/>
      <circle cx="588" cy="264" r="17" fill="${accent}"/>
      <text x="348" y="318" text-anchor="middle" font-family="Arial" font-size="16" font-weight="900" fill="#1B2028">${label}</text>
      <text x="588" y="269" text-anchor="middle" font-family="Arial" font-size="12" font-weight="900" fill="#fff">${detail}</text>
    `,
    smartphone: `
      <rect x="350" y="150" width="200" height="384" rx="38" fill="${primary}"/>
      <rect x="373" y="188" width="154" height="286" rx="18" fill="${secondary}"/>
      <rect x="416" y="164" width="68" height="9" rx="4" fill="#65707B"/>
      <circle cx="450" cy="500" r="14" fill="#65707B"/>
      <g fill="${accent}">
        <rect x="397" y="228" width="31" height="31" rx="7"/><rect x="436" y="228" width="31" height="31" rx="7"/>
        <rect x="475" y="228" width="31" height="31" rx="7"/><rect x="397" y="268" width="31" height="31" rx="7"/>
        <rect x="436" y="268" width="31" height="31" rx="7"/><rect x="475" y="268" width="31" height="31" rx="7"/>
      </g>
      <text x="450" y="361" text-anchor="middle" font-family="Arial" font-size="26" font-weight="900" fill="#1B2028">${label}</text>
      <text x="450" y="446" text-anchor="middle" font-family="Arial" font-size="16" font-weight="900" fill="#1B2028">${detail}</text>
    `,
    ereader: `
      <rect x="320" y="150" width="260" height="390" rx="28" fill="${primary}" stroke="#1B2028" stroke-width="8"/>
      <rect x="350" y="202" width="200" height="250" rx="8" fill="${secondary}"/>
      <g stroke="#7A807B" stroke-width="5">
        <line x1="382" y1="278" x2="518" y2="278"/><line x1="382" y1="313" x2="518" y2="313"/>
        <line x1="382" y1="348" x2="518" y2="348"/><line x1="382" y1="383" x2="498" y2="383"/>
      </g>
      <text x="450" y="244" text-anchor="middle" font-family="Georgia" font-size="25" font-weight="700" fill="#1B2028">${label}</text>
      <text x="450" y="505" text-anchor="middle" font-family="Arial" font-size="17" font-weight="900" fill="#1B2028">${detail}</text>
    `,
    smartwatch: `
      <rect x="410" y="118" width="80" height="118" rx="28" fill="${secondary}"/>
      <rect x="410" y="415" width="80" height="118" rx="28" fill="${secondary}"/>
      <rect x="345" y="225" width="210" height="210" rx="52" fill="${primary}"/>
      <circle cx="450" cy="330" r="73" fill="#0D1117"/>
      <circle cx="450" cy="330" r="47" fill="none" stroke="${accent}" stroke-width="12"/>
      <text x="450" y="319" text-anchor="middle" font-family="Arial" font-size="26" font-weight="900" fill="#fff">${label}</text>
      <text x="450" y="365" text-anchor="middle" font-family="Arial" font-size="16" font-weight="900" fill="${accent}">${detail}</text>
    `,
    earbuds: `
      <rect x="326" y="366" width="248" height="92" rx="40" fill="${secondary}" stroke="#1B2028" stroke-width="7"/>
      <path d="M382 219 C422 219 438 255 420 285 C405 310 391 322 391 369 H354 C354 315 342 289 342 262 C342 238 358 219 382 219 Z" fill="${primary}" stroke="#1B2028" stroke-width="7"/>
      <path d="M518 219 C478 219 462 255 480 285 C495 310 509 322 509 369 H546 C546 315 558 289 558 262 C558 238 542 219 518 219 Z" fill="${primary}" stroke="#1B2028" stroke-width="7"/>
      <circle cx="382" cy="260" r="17" fill="${accent}"/>
      <circle cx="518" cy="260" r="17" fill="${accent}"/>
      <text x="450" y="423" text-anchor="middle" font-family="Arial" font-size="25" font-weight="900" fill="#1B2028">${label}</text>
      <text x="450" y="492" text-anchor="middle" font-family="Arial" font-size="16" font-weight="900" fill="#1B2028">${detail}</text>
    `,
    "smart-speaker": `
      <path d="M338 234 C338 188 562 188 562 234 V423 C562 468 338 468 338 423 Z" fill="${primary}" stroke="#1B2028" stroke-width="8"/>
      <ellipse cx="450" cy="234" rx="112" ry="42" fill="${secondary}"/>
      <g fill="#6D7478">
        ${dotRows()}
      </g>
      <circle cx="413" cy="260" r="7" fill="${accent}"/><circle cx="438" cy="260" r="7" fill="${accent}"/>
      <circle cx="463" cy="260" r="7" fill="${accent}"/><circle cx="488" cy="260" r="7" fill="${accent}"/>
      <text x="450" y="466" text-anchor="middle" font-family="Arial" font-size="17" font-weight="900" fill="#1B2028">${detail}</text>
      <text x="450" y="321" text-anchor="middle" font-family="Arial" font-size="28" font-weight="900" fill="#1B2028">${label}</text>
    `,
    "ring-light": `
      <circle cx="450" cy="290" r="122" fill="none" stroke="${primary}" stroke-width="34"/>
      <circle cx="450" cy="290" r="83" fill="none" stroke="#1B2028" stroke-width="9"/>
      <rect x="413" y="274" width="74" height="134" rx="18" fill="${secondary}" stroke="#1B2028" stroke-width="8"/>
      <rect x="426" y="293" width="48" height="83" rx="10" fill="${accent}"/>
      <line x1="450" y1="412" x2="450" y2="513" stroke="#1B2028" stroke-width="12" stroke-linecap="round"/>
      <line x1="450" y1="513" x2="376" y2="546" stroke="#1B2028" stroke-width="10" stroke-linecap="round"/>
      <line x1="450" y1="513" x2="524" y2="546" stroke="#1B2028" stroke-width="10" stroke-linecap="round"/>
      <text x="450" y="344" text-anchor="middle" font-family="Arial" font-size="20" font-weight="900" fill="#fff">${label}</text>
      <text x="450" y="226" text-anchor="middle" font-family="Arial" font-size="16" font-weight="900" fill="#1B2028">${detail}</text>
    `,
    handheld: `
      <rect x="220" y="246" width="460" height="198" rx="74" fill="${primary}"/>
      <rect x="350" y="273" width="200" height="132" rx="13" fill="#0D1117"/>
      <circle cx="293" cy="322" r="26" fill="${secondary}"/>
      <circle cx="607" cy="322" r="26" fill="${secondary}"/>
      <g fill="${accent}">
        <rect x="259" y="374" width="26" height="26" rx="7"/><rect x="293" y="374" width="26" height="26" rx="7"/>
        <circle cx="589" cy="374" r="12"/><circle cx="626" cy="374" r="12"/>
      </g>
      <text x="450" y="341" text-anchor="middle" font-family="Arial" font-size="25" font-weight="900" fill="#fff">${label}</text>
      <text x="450" y="478" text-anchor="middle" font-family="Arial" font-size="17" font-weight="900" fill="#1B2028">${detail}</text>
    `,
    "smart-glasses": `
      <path d="M262 296 C310 262 391 264 422 313 L478 313 C509 264 590 262 638 296" fill="none" stroke="${primary}" stroke-width="20" stroke-linecap="round"/>
      <rect x="286" y="286" width="132" height="88" rx="32" fill="${secondary}" stroke="#1B2028" stroke-width="8"/>
      <rect x="482" y="286" width="132" height="88" rx="32" fill="${secondary}" stroke="#1B2028" stroke-width="8"/>
      <circle cx="592" cy="302" r="14" fill="${accent}"/>
      <text x="450" y="449" text-anchor="middle" font-family="Arial" font-size="31" font-weight="900" fill="#1B2028">${label}</text>
      <text x="450" y="490" text-anchor="middle" font-family="Arial" font-size="17" font-weight="900" fill="#1B2028">${detail}</text>
    `,
    "atomic-lamp": `
      <path d="M376 222 L560 174 L526 316 L336 356 Z" fill="${primary}" stroke="#1B2028" stroke-width="8"/>
      <circle cx="366" cy="352" r="26" fill="${accent}"/>
      <line x1="444" y1="334" x2="444" y2="505" stroke="#1B2028" stroke-width="13" stroke-linecap="round"/>
      <path d="M346 532 C376 486 512 486 554 532 Z" fill="${secondary}" stroke="#1B2028" stroke-width="8"/>
      <g stroke="${accent}" stroke-width="7">
        <line x1="577" y1="167" x2="634" y2="119"/><line x1="602" y1="222" x2="682" y2="207"/>
        <line x1="557" y1="303" x2="620" y2="355"/>
      </g>
      <text x="445" y="267" text-anchor="middle" font-family="Arial" font-size="28" font-weight="900" fill="#1B2028">${label}</text>
      <text x="450" y="557" text-anchor="middle" font-family="Arial" font-size="17" font-weight="900" fill="#1B2028">${detail}</text>
    `,
    pda: `
      <rect x="330" y="164" width="240" height="370" rx="38" fill="${primary}" stroke="#1B2028" stroke-width="8" opacity="0.92"/>
      <rect x="366" y="215" width="168" height="176" rx="12" fill="${secondary}"/>
      <rect x="388" y="421" width="124" height="48" rx="24" fill="#E7EEF0" stroke="#1B2028" stroke-width="6"/>
      <line x1="584" y1="210" x2="584" y2="470" stroke="${accent}" stroke-width="13" stroke-linecap="round"/>
      <text x="450" y="283" text-anchor="middle" font-family="Arial" font-size="28" font-weight="900" fill="#1B2028">${label}</text>
      <text x="450" y="454" text-anchor="middle" font-family="Arial" font-size="18" font-weight="900" fill="#1B2028">${detail}</text>
    `,
    "vlog-cube": `
      <rect x="335" y="210" width="230" height="230" rx="42" fill="${primary}" stroke="#1B2028" stroke-width="8"/>
      <circle cx="450" cy="325" r="76" fill="#111820" stroke="${secondary}" stroke-width="15"/>
      <circle cx="450" cy="325" r="35" fill="#718293"/>
      <rect x="498" y="236" width="42" height="28" rx="8" fill="${accent}"/>
      <rect x="386" y="458" width="128" height="42" rx="21" fill="${secondary}" stroke="#1B2028" stroke-width="7"/>
      <text x="450" y="253" text-anchor="middle" font-family="Arial" font-size="24" font-weight="900" fill="#1B2028">${label}</text>
      <text x="450" y="487" text-anchor="middle" font-family="Arial" font-size="17" font-weight="900" fill="#1B2028">${detail}</text>
    `,
    "ai-pin": `
      <rect x="350" y="212" width="200" height="224" rx="54" fill="${primary}" stroke="#1B2028" stroke-width="8"/>
      <circle cx="450" cy="300" r="58" fill="${secondary}"/>
      <circle cx="450" cy="300" r="24" fill="${accent}"/>
      <g fill="#5C6570">
        <circle cx="392" cy="390" r="5"/><circle cx="412" cy="390" r="5"/><circle cx="432" cy="390" r="5"/>
        <circle cx="452" cy="390" r="5"/><circle cx="472" cy="390" r="5"/><circle cx="492" cy="390" r="5"/>
      </g>
      <text x="450" y="308" text-anchor="middle" font-family="Arial" font-size="28" font-weight="900" fill="#fff">${label}</text>
      <text x="450" y="482" text-anchor="middle" font-family="Arial" font-size="17" font-weight="900" fill="#1B2028">${detail}</text>
    `,
  };

  return shapes[shape] ?? shapes.radio;
}

function keyGrid(x, y, secondary, accent) {
  const keys = [];
  for (let row = 0; row < 4; row += 1) {
    for (let col = 0; col < 5; col += 1) {
      keys.push(
        `<rect x="${x + col * 50}" y="${y + row * 38}" width="36" height="26" rx="6" fill="${row === 3 && col > 2 ? accent : secondary}"/>`
      );
    }
  }
  return keys.join("");
}

function phoneKeys(x, y, fill) {
  const keys = [];
  for (let row = 0; row < 4; row += 1) {
    for (let col = 0; col < 3; col += 1) {
      keys.push(`<rect x="${x + col * 38}" y="${y + row * 33}" width="27" height="21" rx="5" fill="${fill}"/>`);
    }
  }
  return keys.join("");
}

function dotRows() {
  const dots = [];
  for (let row = 0; row < 7; row += 1) {
    for (let col = 0; col < 8; col += 1) {
      dots.push(`<circle cx="${380 + col * 20}" cy="${310 + row * 20}" r="3"/>`);
    }
  }
  return dots.join("");
}

function render() {
  if (!state.timelineObjectId) {
    state.timelineObjectId = chooseRandom(getTimelinePool()).id;
  }
  if (!state.imaginedObjectId) {
    state.imaginedObjectId = chooseRandom(getImaginedPool()).id;
  }
  if (!state.olderPair) {
    state.olderPair = makeOlderPair(state.olderDifficulty);
  }

  app.innerHTML = `
    ${state.isAdmin ? renderAccountPanel() : ""}
    <nav class="mode-tabs" aria-label="Game modes">
      ${MODES.map(renderModeButton).join("")}
    </nav>
    <header class="topbar">
      <div class="hero-copy">
        <p class="eyebrow">Chrono Objects</p>
        <h1>Guess the year by reading the object</h1>
        <p class="hero-subtitle">Study the artifact, drag the timeline, and lock in the decade before the next object appears.</p>
      </div>
      <div class="score-chip">
        <span>${getObjects().length}</span>
        <small>objects</small>
      </div>
    </header>
    <main class="workspace">
      ${renderCurrentMode()}
    </main>
  `;
}

function renderAccountPanel() {
  const ready = backend?.isReady();
  const message = state.backendError || state.backendMessage;

  return `
    <section class="account-panel">
      <div>
        <p class="eyebrow">${ready ? "Supabase Backend" : "Local Prototype"}</p>
        <strong>${ready ? "Shared online database" : "Local browser storage"}</strong>
        ${message ? `<p>${escapeHtml(message)}</p>` : ""}
      </div>
      ${renderAccountAction(ready)}
    </section>
  `;
}

function renderAccountAction(ready) {
  if (!ready) {
    return `<span class="status-pill">Not connected</span>`;
  }

  if (state.user) {
    return `
      <div class="account-user">
        <span class="status-pill ${state.isAdmin ? "status-pill--admin" : ""}">${state.isAdmin ? "Admin" : "Signed in"}</span>
        <small>${escapeHtml(state.user.email ?? "Signed in")}</small>
        <button class="secondary-button" data-action="sign-out" ${state.backendLoading ? "disabled" : ""}>Sign Out</button>
      </div>
    `;
  }

  return renderAuthForm();
}

function renderAuthForm() {
  return `
    <form class="auth-form" data-action="auth-sign-in">
      <input type="email" name="email" placeholder="Email for sign-in link" required />
      <button class="primary-button" type="submit" ${state.backendLoading ? "disabled" : ""}>Sign In</button>
    </form>
  `;
}

function renderModeButton(mode) {
  const selected = state.mode === mode.id;
  const disabled = mode.id === "imagined" && !GAME_CONFIG.aiModeEnabled;
  return `
    <button class="mode-tab ${selected ? "is-active" : ""}" data-mode="${mode.id}" ${disabled ? "disabled" : ""}>
      <span class="mode-tab__full">${mode.label}</span>
      <span class="mode-tab__short">${mode.shortLabel}</span>
    </button>
  `;
}

function renderCurrentMode() {
  if (state.mode === "olderNewer") return renderOlderNewer();
  if (state.mode === "daily") return renderDaily();
  if (state.mode === "submit") return renderSubmit();
  if (state.mode === "imagined") return renderTimelineLike("imagined");
  return renderTimelineLike("timeline");
}

function renderTimelineLike(kind) {
  const object = getObjectById(kind === "imagined" ? state.imaginedObjectId : state.timelineObjectId);
  const guess = kind === "imagined" ? state.imaginedGuess : state.timelineGuess;
  const result = kind === "imagined" ? state.imaginedResult : state.timelineResult;
  const sourceBadge = object.sourceType === "imagined" ? "Imagined era" : object.sourceType === "community" ? "Community" : "Curated";
  const stageClass = object.imageUrl ? "object-stage object-stage--photo" : "object-stage";

  return `
    <section class="play-surface">
      <div class="${stageClass}">
        <div class="object-media">
          ${renderObjectMedia(object)}
        </div>
        <div class="object-title-strip">
          <strong>${escapeHtml(object.title)}</strong>
          <span>${escapeHtml(object.brand)}</span>
        </div>
        <div class="object-meta-line">
          <span>${escapeHtml(object.category)}</span>
          <span>${escapeHtml(sourceBadge)}</span>
          <span>${escapeHtml(object.imageType ?? "image")}</span>
        </div>
      </div>
      <aside class="control-panel">
        <div class="panel-heading">
          <p class="eyebrow">${kind === "imagined" ? "Imagined Era" : "Timeline"}</p>
          <h2>Guess the year</h2>
        </div>
        ${GAME_CONFIG.hintsEnabled ? renderHintBox(object) : ""}
        <label class="year-readout" for="${kind}-year">
          <span>${guess}</span>
          <small>${GAME_CONFIG.yearMin} - ${GAME_CONFIG.yearMax}</small>
        </label>
        <input
          id="${kind}-year"
          class="year-slider"
          type="range"
          min="${GAME_CONFIG.yearMin}"
          max="${GAME_CONFIG.yearMax}"
          value="${guess}"
          data-action="${kind}-guess"
        />
        <div class="timeline-scale" aria-hidden="true">
          ${renderYearTicks()}
        </div>
        <div class="button-row">
          <button class="primary-button" data-action="${kind}-submit" ${result ? "disabled" : ""}>Lock Guess</button>
          <button class="secondary-button" data-action="${kind}-next">Next Object</button>
        </div>
        ${result ? renderTimelineResult(object, result) : ""}
      </aside>
    </section>
  `;
}

function renderYearTicks() {
  return [GAME_CONFIG.yearMin, 1920, 1940, 1960, 1980, 2000, 2020, GAME_CONFIG.yearMax]
    .filter((year, index, years) => year >= GAME_CONFIG.yearMin && year <= GAME_CONFIG.yearMax && years.indexOf(year) === index)
    .map((year) => `<span>${year}</span>`)
    .join("");
}

function renderHintBox(object) {
  const hints = object.hints ?? [];
  const hint = hints[Math.min(state.hintIndex, hints.length - 1)];
  if (!hint) return "";
  return `
    <div class="hint-box">
      <p>${escapeHtml(hint)}</p>
      <button class="text-button" data-action="next-hint" ${state.hintIndex >= hints.length - 1 ? "disabled" : ""}>Next hint</button>
    </div>
  `;
}

function renderTimelineResult(object, result) {
  const miss = getYearDistance(object, result.guess);
  const status = miss === 0 ? "Perfect range" : `${miss} ${miss === 1 ? "year" : "years"} off`;

  return `
    <div class="result-block">
      <div class="result-score">
        <span>${result.score}</span>
        <small>${status}</small>
      </div>
      <dl class="fact-grid">
        <div><dt>Object</dt><dd>${escapeHtml(object.title)}</dd></div>
        <div><dt>Brand</dt><dd>${escapeHtml(object.brand)}</dd></div>
        <div><dt>Range</dt><dd>${object.yearStart} - ${object.yearEnd}</dd></div>
        <div><dt>Your guess</dt><dd>${result.guess}</dd></div>
      </dl>
      ${GAME_CONFIG.revealExplanationEnabled ? `<p class="reveal-copy">${escapeHtml(object.revealText)}</p>` : ""}
    </div>
  `;
}

function renderOlderNewer() {
  const pair = state.olderPair;
  const leftSelected = state.olderChoice === "left";
  const rightSelected = state.olderChoice === "right";

  return `
    <section class="compare-surface">
      <div class="compare-toolbar">
        <div>
          <p class="eyebrow">Older / Newer</p>
          <h2>Which object is older?</h2>
        </div>
        <label class="select-label">
          <span>Difficulty</span>
          <select data-action="older-difficulty">
            ${["easy", "medium", "hard"].map((level) => `<option value="${level}" ${state.olderDifficulty === level ? "selected" : ""}>${level}</option>`).join("")}
          </select>
        </label>
      </div>
      <div class="compare-grid">
        ${renderCompareObject(pair.left, "left", leftSelected)}
        ${renderCompareObject(pair.right, "right", rightSelected)}
      </div>
      <div class="compare-controls">
        <label>
          <span>Age gap bonus</span>
          <input type="text" inputmode="numeric" pattern="[0-9]*" value="${escapeHtml(state.olderGapGuess)}" placeholder="Years apart" data-action="older-gap" />
        </label>
        <div class="button-row">
          <button class="primary-button" data-action="older-submit" ${!state.olderChoice || state.olderResult ? "disabled" : ""}>Lock Choice</button>
          <button class="secondary-button" data-action="older-next">Next Pair</button>
        </div>
      </div>
      ${state.olderResult ? renderOlderResult(pair, state.olderResult) : ""}
    </section>
  `;
}

function renderCompareObject(object, side, selected) {
  return `
    <button class="compare-object ${selected ? "is-selected" : ""}" data-action="older-choice" data-side="${side}">
      <span class="compare-image">
        <img src="${imageForObject(object)}" alt="${escapeHtml(object.title)}" />
      </span>
      <span class="compare-title">${escapeHtml(object.title)}</span>
      <span class="compare-subtitle">${escapeHtml(object.category)} / ${escapeHtml(object.brand)}</span>
    </button>
  `;
}

function renderOlderResult(pair, result) {
  const older = midpoint(pair.left) <= midpoint(pair.right) ? pair.left : pair.right;
  const younger = older.id === pair.left.id ? pair.right : pair.left;
  const actualGap = Math.abs(midpoint(pair.left) - midpoint(pair.right));

  return `
    <div class="result-block result-block--wide">
      <div class="result-score">
        <span>${result.score}</span>
        <small>${result.correct ? "Correct" : "Missed it"}</small>
      </div>
      <dl class="fact-grid fact-grid--wide">
        <div><dt>Older</dt><dd>${escapeHtml(older.title)} (${older.yearStart} - ${older.yearEnd})</dd></div>
        <div><dt>Newer</dt><dd>${escapeHtml(younger.title)} (${younger.yearStart} - ${younger.yearEnd})</dd></div>
        <div><dt>Gap</dt><dd>${actualGap} years</dd></div>
        <div><dt>Bonus</dt><dd>${result.bonus}</dd></div>
      </dl>
    </div>
  `;
}

function renderDaily() {
  const object = getDailyObject();
  const dailyResults = getDailyResults();
  const stored = dailyResults[todayKey];
  const result = stored
    ? { guess: stored.guess, score: stored.score }
    : null;
  const stageClass = object.imageUrl ? "object-stage object-stage--photo" : "object-stage";

  return `
    <section class="play-surface">
      <div class="${stageClass}">
        <div class="object-media">
          ${renderObjectMedia(object)}
        </div>
        <div class="object-title-strip">
          <strong>${escapeHtml(object.title)}</strong>
          <span>${escapeHtml(object.brand)}</span>
        </div>
        <div class="object-meta-line">
          <span>Daily Artifact</span>
          <span>${todayKey}</span>
          <span>One attempt</span>
        </div>
      </div>
      <aside class="control-panel">
        <div class="panel-heading">
          <p class="eyebrow">Daily Artifact</p>
          <h2>${result ? "Today's result" : "Make your call"}</h2>
        </div>
        <label class="year-readout" for="daily-year">
          <span>${result ? result.guess : state.dailyGuess}</span>
          <small>${GAME_CONFIG.yearMin} - ${GAME_CONFIG.yearMax}</small>
        </label>
        <input
          id="daily-year"
          class="year-slider"
          type="range"
          min="${GAME_CONFIG.yearMin}"
          max="${GAME_CONFIG.yearMax}"
          value="${result ? result.guess : state.dailyGuess}"
          data-action="daily-guess"
          ${result ? "disabled" : ""}
        />
        <div class="timeline-scale" aria-hidden="true">
          ${renderYearTicks()}
        </div>
        <div class="button-row">
          <button class="primary-button" data-action="daily-submit" ${result ? "disabled" : ""}>Lock Daily</button>
        </div>
        ${result ? renderTimelineResult(object, result) : ""}
      </aside>
    </section>
  `;
}

function renderSubmit() {
  const uploads = getFallbackUploads();
  const submitTitle = backend?.isReady()
    ? state.isAdmin
      ? "Add approved object"
      : "Submit for review"
    : "Add a private challenge";

  return `
    <section class="submit-surface">
      <div class="submit-form-zone">
        <div class="panel-heading">
          <p class="eyebrow">Submit an Object</p>
          <h2>${submitTitle}</h2>
        </div>
        ${renderSubmitNotice()}
        <form class="submit-form" data-action="submit-object">
          <label>
            <span>Image</span>
            <input type="file" accept="image/*" data-action="upload-image" ${GAME_CONFIG.uploadsEnabled ? "" : "disabled"} />
          </label>
          <div class="form-grid">
            <label><span>Title</span><input name="title" required placeholder="Portable CD player" /></label>
            <label><span>Brand</span><input name="brand" required placeholder="Sony, Canon, Generic" /></label>
            <label><span>Category</span><select name="category">${renderCategoryOptions()}</select></label>
            <label><span>Source</span><select name="sourceType"><option value="community">Real / uploaded</option><option value="imagined">Imagined / AI</option></select></label>
            <label><span>Start year</span><input name="yearStart" type="text" inputmode="numeric" pattern="[0-9]*" required /></label>
            <label><span>End year</span><input name="yearEnd" type="text" inputmode="numeric" pattern="[0-9]*" required /></label>
          </div>
          <label>
            <span>Reveal note</span>
            <textarea name="revealText" rows="4" placeholder="What should players notice after the reveal?"></textarea>
          </label>
          <div class="button-row">
            <button class="primary-button" type="submit" ${GAME_CONFIG.uploadsEnabled && !state.backendLoading && (!backend?.isReady() || state.user) ? "" : "disabled"}>
              ${backend?.isReady() ? (state.isAdmin ? "Add Approved Object" : "Submit for Approval") : "Save Object"}
            </button>
          </div>
        </form>
      </div>
      <aside class="upload-preview">
        <div class="upload-preview-media">
          ${
            state.submitImage
              ? `<div class="upload-preview-image" role="img" aria-label="Upload preview" style="background-image: url('${escapeHtml(state.submitImage)}')"></div>`
              : `<div class="empty-preview">Image preview</div>`
          }
        </div>
        <div class="upload-list">
          <p class="eyebrow">${renderSubmissionListTitle()}</p>
          ${renderSubmissionList(uploads)}
        </div>
      </aside>
    </section>
  `;
}

function renderSubmitNotice() {
  if (state.submitMessage) {
    return `<p class="notice">${escapeHtml(state.submitMessage)}</p>`;
  }

  if (!backend?.isReady()) {
    return `<p class="notice">Supabase is not connected yet, so this saves only in this browser.</p>`;
  }

  if (!state.user) {
    return `
      <p class="notice">Sign in to submit an object for review.</p>
      ${renderAuthForm()}
    `;
  }

  if (state.isAdmin) {
    return `<p class="notice">You are admin. Objects you add here will be approved immediately and become playable.</p>`;
  }

  return `<p class="notice">Your submission will be saved online as pending until an admin approves it.</p>`;
}

function renderSubmissionListTitle() {
  if (!backend?.isReady()) return "Local submissions";
  if (state.isAdmin) return "Review queue";
  if (state.user) return "Your submissions";
  return "Submissions";
}

function renderSubmissionList(uploads) {
  if (!backend?.isReady()) {
    return uploads.length ? uploads.map(renderUploadRow).join("") : `<p class="muted">No uploaded objects yet.</p>`;
  }

  if (!state.user) {
    return `<p class="muted">Sign in to submit objects and see your submission status.</p>`;
  }

  if (state.isAdmin) {
    const pending = getPendingObjects();
    return pending.length ? pending.map(renderAdminReviewRow).join("") : `<p class="muted">No pending objects right now.</p>`;
  }

  const mine = state.serverObjects.filter((item) => item.submittedBy === state.user.id);
  return mine.length ? mine.map(renderUploadRow).join("") : `<p class="muted">No submitted objects yet.</p>`;
}

function renderCategoryOptions() {
  return GAME_CONFIG.categories.map((category) => `<option value="${category}">${category}</option>`).join("");
}

function renderUploadRow(item) {
  return `
    <div class="upload-row">
      <img src="${imageForObject(item)}" alt="${escapeHtml(item.title)}" />
      <span>
        <strong>${escapeHtml(item.title)}</strong>
        <small>${item.yearStart} - ${item.yearEnd} / ${escapeHtml(item.category)}${item.status ? ` / ${escapeHtml(item.status)}` : ""}</small>
      </span>
    </div>
  `;
}

function renderAdminReviewRow(item) {
  return `
    <div class="review-row">
      <img src="${imageForObject(item)}" alt="${escapeHtml(item.title)}" />
      <div>
        <strong>${escapeHtml(item.title)}</strong>
        <small>${escapeHtml(item.brand)} / ${item.yearStart} - ${item.yearEnd}</small>
        <small>${escapeHtml(item.category)} / ${escapeHtml(item.sourceType)}</small>
      </div>
      <div class="review-actions">
        <button class="primary-button" data-action="approve-object" data-id="${escapeHtml(item.id)}" ${state.backendLoading ? "disabled" : ""}>Approve</button>
        <button class="secondary-button" data-action="reject-object" data-id="${escapeHtml(item.id)}" ${state.backendLoading ? "disabled" : ""}>Reject</button>
      </div>
    </div>
  `;
}

function submitTimeline(kind) {
  const object = getObjectById(kind === "imagined" ? state.imaginedObjectId : state.timelineObjectId);
  const guess = Number(kind === "imagined" ? state.imaginedGuess : state.timelineGuess);
  const result = { guess, score: scoreTimeline(object, guess) };

  if (kind === "imagined") {
    state.imaginedResult = result;
  } else {
    state.timelineResult = result;
  }

  render();
}

function submitDaily() {
  const object = getDailyObject();
  const guess = Number(state.dailyGuess);
  const score = scoreTimeline(object, guess);
  const dailyResults = getDailyResults();
  dailyResults[todayKey] = { guess, score, objectId: object.id };
  writeJson(GAME_CONFIG.localStorageKeys.daily, dailyResults);
  render();
}

function submitOlder() {
  const pair = state.olderPair;
  const leftOlder = midpoint(pair.left) <= midpoint(pair.right);
  const choiceCorrect = (state.olderChoice === "left" && leftOlder) || (state.olderChoice === "right" && !leftOlder);
  const bonus = choiceCorrect ? scoreGapBonus(pair, state.olderGapGuess) : 0;
  const actualGap = Math.abs(midpoint(pair.left) - midpoint(pair.right));
  const difficultyBase = {
    easy: 350,
    medium: 550,
    hard: 750,
  }[state.olderDifficulty];

  state.olderResult = {
    correct: choiceCorrect,
    bonus,
    actualGap,
    score: choiceCorrect ? difficultyBase + bonus : 0,
  };

  render();
}

async function saveUpload(form) {
  const formData = new FormData(form);
  const yearStart = Number(formData.get("yearStart"));
  const yearEnd = Number(formData.get("yearEnd"));

  if (
    !Number.isFinite(yearStart) ||
    !Number.isFinite(yearEnd) ||
    yearStart < GAME_CONFIG.yearMin ||
    yearEnd > GAME_CONFIG.yearMax ||
    yearStart > yearEnd
  ) {
    form.querySelector("[name='yearStart']").focus();
    return;
  }

  const title = String(formData.get("title")).trim();
  const brand = String(formData.get("brand")).trim();
  const category = String(formData.get("category"));
  const sourceType = String(formData.get("sourceType"));
  const revealText =
    String(formData.get("revealText")).trim() ||
    "This submitted object uses its visible materials, controls, typography, and form factor as dating clues.";

  const upload = {
    id: `upload-${Date.now()}`,
    title,
    brand,
    category,
    yearStart,
    yearEnd,
    sourceType,
    imageType: "uploaded",
    imageUrl: state.submitImage,
    difficulty: "community",
    tags: ["uploaded"],
    revealText,
    hints: [],
    asset: {
      shape: "radio",
      primary: "#2F3542",
      secondary: "#F4F1E8",
      accent: "#E8553E",
      label: category,
      detail: brand,
    },
  };

  if (backend?.isReady()) {
    if (!state.user) {
      state.submitMessage = "Sign in before submitting an object.";
      render();
      return;
    }

    state.backendLoading = true;
    state.submitMessage = "Uploading object...";
    render();

    try {
      const uploadedImage = await backend.uploadImage(state.submitFile, state.user.id);
      const status = state.isAdmin ? "approved" : "pending";
      await backend.insertObject({
        ...upload,
        id: undefined,
        imageUrl: uploadedImage.imageUrl,
        imagePath: uploadedImage.imagePath,
        submittedBy: state.user.id,
        approvedBy: status === "approved" ? state.user.id : null,
        approvedAt: status === "approved" ? new Date().toISOString() : null,
        status,
      });
      await refreshBackendObjects(false);
      state.submitImage = "";
      state.submitFile = null;
      state.submitMessage = state.isAdmin
        ? "Added and approved. It is now part of the playable object pool."
        : "Submitted. It is now pending admin approval.";
      form.reset();
    } catch (error) {
      state.submitMessage = error.message || "Could not submit object.";
    } finally {
      state.backendLoading = false;
      render();
    }
    return;
  }

  const uploads = getUploads();
  uploads.unshift(upload);
  writeJson(GAME_CONFIG.localStorageKeys.uploads, uploads);
  state.submitImage = "";
  state.submitFile = null;
  state.submitMessage = "Saved locally in this browser.";
  form.reset();
  render();
}

document.addEventListener("click", (event) => {
  const target = event.target.closest("[data-mode], [data-action]");
  if (!target) return;

  const mode = target.dataset.mode;
  const action = target.dataset.action;

  if (mode) {
    setMode(mode);
    return;
  }

  if (action === "timeline-submit") submitTimeline("timeline");
  if (action === "imagined-submit") submitTimeline("imagined");
  if (action === "daily-submit") submitDaily();
  if (action === "timeline-next") startTimelineRound();
  if (action === "imagined-next") startImaginedRound();
  if (action === "older-next") startOlderRound();
  if (action === "older-submit") submitOlder();
  if (action === "sign-out") signOut();
  if (action === "approve-object") reviewObject(target.dataset.id, "approved");
  if (action === "reject-object") reviewObject(target.dataset.id, "rejected");
  if (action === "older-choice" && !state.olderResult) {
    state.olderChoice = target.dataset.side;
    render();
  }
  if (action === "next-hint") {
    state.hintIndex += 1;
    render();
  }
});

document.addEventListener("input", (event) => {
  const action = event.target.dataset.action;
  if (action === "timeline-guess") {
    state.timelineGuess = Number(event.target.value);
    updateYearReadout(event.target, state.timelineGuess);
  }
  if (action === "imagined-guess") {
    state.imaginedGuess = Number(event.target.value);
    updateYearReadout(event.target, state.imaginedGuess);
  }
  if (action === "daily-guess") {
    state.dailyGuess = Number(event.target.value);
    updateYearReadout(event.target, state.dailyGuess);
  }
  if (action === "older-gap") {
    state.olderGapGuess = event.target.value;
  }
});

document.addEventListener("change", async (event) => {
  const action = event.target.dataset.action;
  if (action === "older-difficulty") {
    state.olderDifficulty = event.target.value;
    startOlderRound();
  }
  if (action === "upload-image") {
    const file = event.target.files?.[0];
    if (!file) return;
    state.submitFile = file;
    state.submitImage = await fileToDataUrl(file);
    render();
  }
});

document.addEventListener("submit", async (event) => {
  const action = event.target.dataset.action;
  if (action === "submit-object") {
    event.preventDefault();
    await saveUpload(event.target);
  }
  if (action === "auth-sign-in") {
    event.preventDefault();
    await signIn(event.target);
  }
});

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function updateYearReadout(input, value) {
  const panel = input.closest(".control-panel");
  const readout = panel?.querySelector(".year-readout span");
  if (readout) readout.textContent = value;
}

render();
initializeBackend();
})();
