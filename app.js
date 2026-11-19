import {
  FilesetResolver,
  HandLandmarker,
  DrawingUtils
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs";

const WASM_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";
const MODEL_URL = "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

const MOTOR_NAMES = [
  "L1 Başparmak", "L2 İşaret", "L3 Kendi Etrafında", "L4 Bilek Sağa/Sol",
  "R1 Başparmak", "R2 İşaret", "R3 Kendi Etrafında", "R4 Bilek Sağa/Sol"
];

const video = document.getElementById("webcam");
const canvas = document.getElementById("overlay");
const ctx = canvas.getContext("2d");
const videoWrap = document.getElementById("videoWrap");

const offlineBadge = document.getElementById("offlineBadge");
const wsBadge = document.getElementById("wsBadge");
const rttBadge = document.getElementById("rttBadge");
const wsDot = document.getElementById("wsDot");
const btnEstop = document.getElementById("btnEstop");
const handStatus = document.getElementById("handStatus");
const fpsLabel = document.getElementById("fpsLabel");
const leftHandBadge = document.getElementById("leftHandBadge");
const rightHandBadge = document.getElementById("rightHandBadge");
const wsLeftStatus = document.getElementById("wsLeftStatus");
const wsRightStatus = document.getElementById("wsRightStatus");

const btnStartCam = document.getElementById("btnStartCam");
const btnFlipCam = document.getElementById("btnFlipCam");
const btnZeroRef = document.getElementById("btnZeroRef");
const btnHoldActive = document.getElementById("btnHoldActive");
const chkLatchMode = document.getElementById("chkLatchMode");
const chkSwapHands = document.getElementById("chkSwapHands");
const chkMirrorView = document.getElementById("chkMirrorView");
const rngAlpha = document.getElementById("rngAlpha");
const rngDeadband = document.getElementById("rngDeadband");
const rngSlew = document.getElementById("rngSlew");
const lblAlpha = document.getElementById("lblAlpha");
const lblDeadband = document.getElementById("lblDeadband");
const lblSlew = document.getElementById("lblSlew");

const valEls = [
  document.getElementById("valL1"), document.getElementById("valL2"),
  document.getElementById("valL3"), document.getElementById("valL4"),
  document.getElementById("valR1"), document.getElementById("valR2"),
  document.getElementById("valR3"), document.getElementById("valR4")
];

const pidMotorSelect = document.getElementById("pidMotorSelect");
const chkSimMode = document.getElementById("chkSimMode");
const pidChart = document.getElementById("pidChart");
const pidCtx = pidChart.getContext("2d");
const pidSpEl = document.getElementById("pidSp");
const pidActEl = document.getElementById("pidAct");
const pidErrEl = document.getElementById("pidErr");
const pidOsEl = document.getElementById("pidOs");
const pidRiseEl = document.getElementById("pidRise");
const pidSettleEl = document.getElementById("pidSettle");
const inpKp = document.getElementById("inpKp");
const inpKi = document.getElementById("inpKi");
const inpKd = document.getElementById("inpKd");
const inpMinPwm = document.getElementById("inpMinPwm");
const inpMaxPwm = document.getElementById("inpMaxPwm");
const btnApplyPidOne = document.getElementById("btnApplyPidOne");
const btnApplyPidAll = document.getElementById("btnApplyPidAll");
const btnSaveFlash = document.getElementById("btnSaveFlash");
const btnStepTest = document.getElementById("btnStepTest");
const btnStepTestNeg = document.getElementById("btnStepTestNeg");
const btnExportCsv = document.getElementById("btnExportCsv");
const btnClearPlot = document.getElementById("btnClearPlot");

const chkDualEsp = document.getElementById("chkDualEsp");
const chkAutoReconnect = document.getElementById("chkAutoReconnect");
const rightEspWrap = document.getElementById("rightEspWrap");
const wsUrlLeft = document.getElementById("wsUrlLeft");
const wsUrlRight = document.getElementById("wsUrlRight");
const btnConnectWs = document.getElementById("btnConnectWs");
const btnTrustCert = document.getElementById("btnTrustCert");
const btnSendManual = document.getElementById("btnSendManual");
const btnCenterAll = document.getElementById("btnCenterAll");
const calibContainer = document.getElementById("calibContainer");

let handLandmarker = null;
let drawingUtils = new DrawingUtils(ctx);
let facingMode = "user";
let stream = null;
let running = false;
let isArmed = false;
let lastSendTime = 0;
let lastVideoTime = -1;
let lastFrameMs = performance.now();
let wakeLock = null;

// Çift ESP32 WebSocket yöneticisi
let wsLeft = null;
let wsRight = null;
let reconnectTimerL = null;
let reconnectTimerR = null;
let lastPingTs = 0;

let smoothed = [0, 0, 0, 0, 0, 0, 0, 0];
let slewed = [0, 0, 0, 0, 0, 0, 0, 0];
let lastSent = [0, 0, 0, 0, 0, 0, 0, 0];

function createHandState() {
  return { refFrame: null, pitchZero: null, thumbZero: null, indexZero: null };
}
let handState = { left: createHandState(), right: createHandState() };

const DEFAULT_CALIB = Array.from({ length: 8 }, () => ({ invert: false, gain: 1.0 }));
let calib = JSON.parse(localStorage.getItem("marmara_v2_calib") || "null") || DEFAULT_CALIB;
function saveCalib() { localStorage.setItem("marmara_v2_calib", JSON.stringify(calib)); }

function renderCalibUI() {
  calibContainer.innerHTML = "";
  MOTOR_NAMES.forEach((name, i) => {
    const row = document.createElement("div");
    row.className = "calib-row";
    row.innerHTML = `
      <span>${name}</span>
      <label class="inline-chk"><input type="checkbox" data-cidx="${i}" class="cal-inv" ${calib[i].invert ? "checked" : ""}/> Ters</label>
      <label class="inline-num">Çarpan <input type="number" data-cidx="${i}" class="cal-gain" step="0.1" min="0.2" max="5" value="${calib[i].gain}"/></label>
    `;
    calibContainer.appendChild(row);
  });
  calibContainer.querySelectorAll(".cal-inv").forEach((el) => {
    el.addEventListener("change", () => { calib[Number(el.dataset.cidx)].invert = el.checked; saveCalib(); });
  });
  calibContainer.querySelectorAll(".cal-gain").forEach((el) => {
    el.addEventListener("change", () => { calib[Number(el.dataset.cidx)].gain = Number(el.value) || 1.0; saveCalib(); });
  });
}
renderCalibUI();

// Sekmeler
document.querySelectorAll(".tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab, .panel").forEach((el) => el.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(btn.dataset.tab).classList.add("active");
    if (btn.dataset.tab === "pidTab") drawPidChart();
  });
});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").catch(console.error);
}

chkMirrorView.addEventListener("change", () => videoWrap.classList.toggle("mirrored", chkMirrorView.checked));
chkDualEsp.addEventListener("change", () => {
  rightEspWrap.style.display = chkDualEsp.checked ? "block" : "none";
});
rngAlpha.addEventListener("input", () => (lblAlpha.textContent = rngAlpha.value));
rngDeadband.addEventListener("input", () => (lblDeadband.textContent = `${rngDeadband.value}°`));
rngSlew.addEventListener("input", () => (lblSlew.textContent = `${rngSlew.value}°/sn`));

document.querySelectorAll(".man-range").forEach((r) => {
  r.addEventListener("input", () => {
    document.getElementById(`manLbl${r.dataset.idx}`).textContent = `${r.value}°`;
  });
});

// Wake Lock (ekranın test sırasında kapanmasını önler)
async function requestWakeLock() {
  try {
    if ("wakeLock" in navigator) wakeLock = await navigator.wakeLock.request("screen");
  } catch (_) {}
}

// Acil Durdurma (E-STOP) + Boşluk tuşu
function triggerEstop() {
  setArmed(false);
  sendRawToSide("left", { type: "estop" });
  if (chkDualEsp.checked) sendRawToSide("right", { type: "estop" });
}
btnEstop.addEventListener("click", triggerEstop);
window.addEventListener("keydown", (e) => {
  if (e.code === "Space" && document.activeElement?.tagName !== "INPUT") {
    e.preventDefault();
    triggerEstop();
  }
});

btnZeroRef.addEventListener("click", () => {
  handState.left = createHandState();
  handState.right = createHandState();
  smoothed = [0, 0, 0, 0, 0, 0, 0, 0];
  slewed = [0, 0, 0, 0, 0, 0, 0, 0];
  valEls.forEach((el) => (el.textContent = "0°"));
  if (isArmed) sendTargets(slewed, true);
});

function setArmed(state) {
  isArmed = state;
  btnHoldActive.classList.toggle("armed", state);
  btnHoldActive.textContent = state ? "8 MOTOR AKTİF (Canlı)" : "Motorlar Kilitli (Basılı Tut / Aç)";
  if (state) {
    // Soft-start: aktifleştirme anında mevcut hedefe sıçramayı önle
    slewed = [...lastSent];
  } else {
    sendTargets(lastSent, false);
  }
}

btnHoldActive.addEventListener("pointerdown", () => { if (!chkLatchMode.checked) setArmed(true); });
btnHoldActive.addEventListener("pointerup", () => { if (!chkLatchMode.checked) setArmed(false); });
btnHoldActive.addEventListener("pointerleave", () => { if (!chkLatchMode.checked && isArmed) setArmed(false); });
btnHoldActive.addEventListener("click", () => { if (chkLatchMode.checked) setArmed(!isArmed); });

// MediaPipe yükleme
async function createLandmarker(vision, delegate) {
  return HandLandmarker.createFromOptions(vision, {
    baseOptions: { modelAssetPath: MODEL_URL, delegate },
    runningMode: "VIDEO",
    numHands: 2,
    minHandDetectionConfidence: 0.45,
    minHandPresenceConfidence: 0.45,
    minTrackingConfidence: 0.45
  });
}

async function initMediaPipe() {
  try {
    offlineBadge.textContent = "El modeli yükleniyor (~13 MB)...";
    const vision = await FilesetResolver.forVisionTasks(WASM_URL);
    try {
      handLandmarker = await createLandmarker(vision, "GPU");
      offlineBadge.textContent = "Çevrimdışı Hazır (GPU) ✓";
    } catch (_) {
      handLandmarker = await createLandmarker(vision, "CPU");
      offlineBadge.textContent = "Çevrimdışı Hazır (CPU) ✓";
    }
    offlineBadge.classList.add("ok");
  } catch (err) {
    offlineBadge.textContent = `Model hatası: ${err?.message || "İlk açılışta internet gerekir"}`;
  }
}
initMediaPipe();

// --- Çift ESP32 WebSocket Yönetimi ---
function updateWsSummary() {
  const lOk = wsLeft && wsLeft.readyState === WebSocket.OPEN;
  const rOk = wsRight && wsRight.readyState === WebSocket.OPEN;
  wsLeftStatus.textContent = lOk ? "ESP32-L: Bağlı ✓" : "ESP32-L: Kapalı";
  wsLeftStatus.className = lOk ? "mini-status ok" : "mini-status";
  wsRightStatus.textContent = chkDualEsp.checked ? (rOk ? "ESP32-R: Bağlı ✓" : "ESP32-R: Kapalı") : "Tek ESP32 Modu";
  wsRightStatus.className = (chkDualEsp.checked && rOk) ? "mini-status ok" : "mini-status";

  const anyOk = lOk || (chkDualEsp.checked && rOk);
  wsDot.classList.toggle("ok", anyOk);
  if (chkDualEsp.checked) {
    wsBadge.textContent = `ESP32: L:${lOk ? "✓" : "✗"} R:${rOk ? "✓" : "✗"}`;
  } else {
    wsBadge.textContent = lOk ? "ESP32: Bağlı ✓" : "ESP32: Bağlı Değil";
  }
  wsBadge.classList.toggle("ok", anyOk);
}

function openSocket(side, url) {
  if (side === "left") {
    clearTimeout(reconnectTimerL);
    if (wsLeft) wsLeft.close();
  } else {
    clearTimeout(reconnectTimerR);
    if (wsRight) wsRight.close();
  }

  const sock = new WebSocket(url);
  if (side === "left") wsLeft = sock;
  else wsRight = sock;

  sock.onopen = () => {
    updateWsSummary();
    sendWatchChannel();
  };
  sock.onclose = () => {
    updateWsSummary();
    if (chkAutoReconnect.checked) {
      const t = setTimeout(() => openSocket(side, url), 2500);
      if (side === "left") reconnectTimerL = t; else reconnectTimerR = t;
    }
  };
  sock.onerror = () => updateWsSummary();
  sock.onmessage = (ev) => {
    try {
      const msg = JSON.parse(ev.data);
      if (msg.type === "telemetry" && !chkSimMode.checked) onTelemetry(msg);
      if (msg.type === "pong" && lastPingTs > 0) {
        rttBadge.textContent = `RTT: ${Math.round(performance.now() - lastPingTs)} ms`;
      }
    } catch (_) {}
  };
}

function sendRawToSide(side, obj) {
  const s = side === "left" ? wsLeft : wsRight;
  if (s && s.readyState === WebSocket.OPEN) s.send(JSON.stringify(obj));
}

function sendTargets(angles, active) {
  const rounded = angles.map((v) => Number(v.toFixed(1)));
  if (chkDualEsp.checked) {
    sendRawToSide("left", { type: "targets", m: rounded.slice(0, 4), active });
    sendRawToSide("right", { type: "targets", m: rounded.slice(4, 8), active });
  } else {
    sendRawToSide("left", { type: "targets", m: rounded, active });
  }
  if (chkSimMode.checked) {
    const ch = Number(pidMotorSelect.value);
    sim.sp = rounded[ch];
  }
}

function sendWatchChannel() {
  const ch = Number(pidMotorSelect.value);
  if (chkDualEsp.checked) {
    if (ch < 4) sendRawToSide("left", { type: "watch", ch });
    else sendRawToSide("right", { type: "watch", ch: ch - 4 });
  } else {
    sendRawToSide("left", { type: "watch", ch });
  }
}

// Periyodik RTT ölçümü (2 sn)
setInterval(() => {
  if (wsLeft && wsLeft.readyState === WebSocket.OPEN) {
    lastPingTs = performance.now();
    sendRawToSide("left", { type: "ping" });
  }
}, 2000);

btnConnectWs.addEventListener("click", () => {
  openSocket("left", wsUrlLeft.value.trim());
  if (chkDualEsp.checked) openSocket("right", wsUrlRight.value.trim());
});

btnTrustCert.addEventListener("click", () => {
  const toHttps = (u) => u.replace(/^wss:/i, "https:").replace(/\/ws.*$/i, "");
  window.open(toHttps(wsUrlLeft.value.trim()), "_blank");
  if (chkDualEsp.checked) window.open(toHttps(wsUrlRight.value.trim()), "_blank");
});

btnSendManual.addEventListener("click", () => {
  const vals = Array.from(document.querySelectorAll(".man-range")).map((r) => Number(r.value));
  smoothed = [...vals];
  slewed = [...vals];
  vals.forEach((v, i) => (valEls[i].textContent = `${Math.round(v)}°`));
  sendTargets(vals, true);
});

btnCenterAll.addEventListener("click", () => {
  document.querySelectorAll(".man-range").forEach((r) => {
    r.value = 0;
    document.getElementById(`manLbl${r.dataset.idx}`).textContent = "0°";
  });
  smoothed = [0, 0, 0, 0, 0, 0, 0, 0];
  slewed = [0, 0, 0, 0, 0, 0, 0, 0];
  valEls.forEach((el) => (el.textContent = "0°"));
  sendTargets(slewed, true);
});

// --- PID Analiz, HiDPI Grafik ve Yerleşik 2. Derece Simülatör ---
const MAX_HIST = 160;
let pidHistory = [];
let stepStart = null;
let stepTarget = null;
let stepPeak = 0;
let stepStartTime = null;
let riseRecorded = false;
let settleCandidateTime = null;

const sim = { sp: 0, act: 0, vel: 0, integral: 0, prevAct: 0, out: 0 };

function getPidParams() {
  return {
    kp: Number(inpKp.value) || 0,
    ki: Number(inpKi.value) || 0,
    kd: Number(inpKd.value) || 0,
    minPwm: Number(inpMinPwm.value) || 0,
    maxPwm: Number(inpMaxPwm.value) || 200
  };
}

// 20 Hz yerleşik simülatör (Demo modu açıkken çalışır)
setInterval(() => {
  if (!chkSimMode.checked) return;
  const dt = 0.05;
  const p = getPidParams();
  const err = sim.sp - sim.act;
  sim.integral = clamp(sim.integral + err * dt, -100, 100);
  // Derivative-on-measurement
  const dAct = (sim.act - sim.prevAct) / dt;
  sim.prevAct = sim.act;

  let out = p.kp * err + p.ki * sim.integral - p.kd * dAct;
  if (Math.abs(err) > 0.2 && Math.abs(out) < p.minPwm && Math.abs(out) > 1) {
    out = Math.sign(out) * p.minPwm;
  }
  out = clamp(out, -p.maxPwm, p.maxPwm);
  sim.out = out;

  // 2. derece DC motor atalet + sürtünme modeli
  const accel = (out * 4.2) - (sim.vel * 6.5);
  sim.vel += accel * dt;
  sim.act = clamp(sim.act + sim.vel * dt, -180, 180);

  onTelemetry({ sp: sim.sp, act: sim.act, err: sim.sp - sim.act, out: sim.out });
}, 50);

pidMotorSelect.addEventListener("change", () => {
  pidHistory = [];
  stepTarget = null;
  sendWatchChannel();
  drawPidChart();
});

function applyPid(ch) {
  const p = getPidParams();
  if (ch === "all") {
    sendRawToSide("left", { type: "pid", ch: "all", ...p });
    if (chkDualEsp.checked) sendRawToSide("right", { type: "pid", ch: "all", ...p });
  } else if (chkDualEsp.checked) {
    if (ch < 4) sendRawToSide("left", { type: "pid", ch, ...p });
    else sendRawToSide("right", { type: "pid", ch: ch - 4, ...p });
  } else {
    sendRawToSide("left", { type: "pid", ch, ...p });
  }
}

btnApplyPidOne.addEventListener("click", () => applyPid(Number(pidMotorSelect.value)));
btnApplyPidAll.addEventListener("click", () => applyPid("all"));
btnSaveFlash.addEventListener("click", () => {
  sendRawToSide("left", { type: "save_pid" });
  if (chkDualEsp.checked) sendRawToSide("right", { type: "save_pid" });
});

function triggerStep(delta) {
  pidHistory = [];
  stepTarget = null;
  stepStart = null;
  stepPeak = 0;
  stepStartTime = performance.now();
  riseRecorded = false;
  settleCandidateTime = null;
  pidRiseEl.textContent = "—";
  pidSettleEl.textContent = "—";

  if (chkSimMode.checked) {
    sim.sp = clamp(sim.sp + delta, -180, 180);
    return;
  }
  const ch = Number(pidMotorSelect.value);
  if (chkDualEsp.checked) {
    if (ch < 4) sendRawToSide("left", { type: "step", ch, delta });
    else sendRawToSide("right", { type: "step", ch: ch - 4, delta });
  } else {
    sendRawToSide("left", { type: "step", ch, delta });
  }
}

btnStepTest.addEventListener("click", () => triggerStep(30));
btnStepTestNeg.addEventListener("click", () => triggerStep(-30));
btnClearPlot.addEventListener("click", () => {
  pidHistory = [];
  stepTarget = null;
  pidRiseEl.textContent = "—";
  pidSettleEl.textContent = "—";
  drawPidChart();
});

btnExportCsv.addEventListener("click", () => {
  if (pidHistory.length === 0) return;
  const rows = ["zaman_ms,hedef_sp,gercek_enc,hata,pwm"];
  pidHistory.forEach((p) => rows.push(`${p.t},${p.sp.toFixed(2)},${p.act.toFixed(2)},${p.err.toFixed(2)},${p.out.toFixed(1)}`));
  const blob = new Blob([rows.join("\n")], { type: "text/csv;charset=utf-8;" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `marmaradavinci_ch${pidMotorSelect.value}_pid.csv`;
  a.click();
});

function onTelemetry(t) {
  const now = performance.now();
  pidSpEl.textContent = `${Number(t.sp).toFixed(1)}°`;
  pidActEl.textContent = `${Number(t.act).toFixed(1)}°`;
  pidErrEl.textContent = `${Number(t.err).toFixed(1)}°`;

  if (stepTarget === null) {
    stepTarget = t.sp;
    stepStart = t.act;
    stepPeak = t.act;
    stepStartTime = now;
    riseRecorded = false;
  } else if (Math.abs(t.sp - stepTarget) > 0.5) {
    stepStart = t.act;
    stepTarget = t.sp;
    stepPeak = t.act;
    stepStartTime = now;
    riseRecorded = false;
    settleCandidateTime = null;
    pidRiseEl.textContent = "—";
    pidSettleEl.textContent = "—";
  } else {
    const dir = stepTarget >= stepStart ? 1 : -1;
    if (dir > 0) stepPeak = Math.max(stepPeak, t.act);
    else stepPeak = Math.min(stepPeak, t.act);
  }

  const stepSize = Math.abs(stepTarget - stepStart);
  if (stepSize > 2) {
    const progress = Math.abs(t.act - stepStart) / stepSize;
    if (!riseRecorded && progress >= 0.9) {
      riseRecorded = true;
      pidRiseEl.textContent = `${Math.round(now - stepStartTime)} ms`;
    }
    const osDeg = stepTarget >= stepStart ? (stepPeak - stepTarget) : (stepTarget - stepPeak);
    pidOsEl.textContent = `${Math.max(0, (osDeg / stepSize) * 100).toFixed(1)}%`;
  } else {
    pidOsEl.textContent = "0.0%";
  }

  if (Math.abs(t.err) <= 1.5) {
    if (!settleCandidateTime) settleCandidateTime = now;
    if (now - settleCandidateTime >= 200 && stepStartTime) {
      pidSettleEl.textContent = `${Math.round(settleCandidateTime - stepStartTime)} ms`;
    }
  } else {
    settleCandidateTime = null;
  }

  pidHistory.push({ t: Math.round(now), sp: t.sp, act: t.act, err: t.err, out: t.out });
  if (pidHistory.length > MAX_HIST) pidHistory.shift();
  drawPidChart();
}

function drawPidChart() {
  const rect = pidChart.getBoundingClientRect();
  if (rect.width === 0) return;
  const dpr = window.devicePixelRatio || 1;
  pidChart.width = Math.round(rect.width * dpr);
  pidChart.height = Math.round(rect.height * dpr);
  pidCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const w = rect.width;
  const h = rect.height;
  pidCtx.clearRect(0, 0, w, h);

  const padL = 36;
  const plotW = w - padL - 6;
  const topH = h * 0.58;
  const botTop = h * 0.65;

  // Yatay kılavuz ve etiketler
  pidCtx.font = "10px system-ui, sans-serif";
  pidCtx.fillStyle = "#64748b";
  pidCtx.strokeStyle = "#1e293b";
  pidCtx.lineWidth = 1;

  [[10, "+180°"], [(10 + topH) / 2, "0°"], [topH, "-180°"]].forEach(([y, lbl], idx) => {
    pidCtx.beginPath();
    if (idx === 1) pidCtx.setLineDash([4, 4]); else pidCtx.setLineDash([]);
    pidCtx.moveTo(padL, y);
    pidCtx.lineTo(w - 6, y);
    pidCtx.stroke();
    pidCtx.fillText(lbl, 4, y + 3);
  });
  pidCtx.setLineDash([]);
  pidCtx.fillText("PWM", 4, botTop + 12);

  if (pidHistory.length < 2) return;

  const plotLine = (key, color, minV, maxV, yTop, yBot) => {
    pidCtx.strokeStyle = color;
    pidCtx.lineWidth = 2;
    pidCtx.beginPath();
    pidHistory.forEach((p, i) => {
      const x = padL + (i / (MAX_HIST - 1)) * plotW;
      const norm = clamp((p[key] - minV) / (maxV - minV), 0, 1);
      const y = yBot - norm * (yBot - yTop);
      if (i === 0) pidCtx.moveTo(x, y);
      else pidCtx.lineTo(x, y);
    });
    pidCtx.stroke();
  };

  plotLine("sp", "#38bdf8", -180, 180, 10, topH);
  plotLine("act", "#22c55e", -180, 180, 10, topH);
  plotLine("err", "#f59e0b", -90, 90, botTop, h - 8);
  plotLine("out", "#ef4444", -255, 255, botTop, h - 8);
}
window.addEventListener("resize", drawPidChart);

// --- 3D Vektör & EndoWrist Kinematikleri ---
function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
function vec(a, b) { return { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z }; }
function dot(a, b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
function normLen(a) { return Math.hypot(a.x, a.y, a.z) || 1e-6; }
function normalize(a) { const l = normLen(a); return { x: a.x / l, y: a.y / l, z: a.z / l }; }
function cross(a, b) {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}
function angleBetween(u, v) {
  return (Math.acos(clamp(dot(u, v) / (normLen(u) * normLen(v)), -1, 1)) * 180) / Math.PI;
}

function buildHandFrame(wl) {
  const fwd = normalize(vec(wl[0], wl[9]));
  const rawAcross = vec(wl[5], wl[17]);
  const norm = normalize(cross(fwd, rawAcross));
  const across = normalize(cross(norm, fwd));
  return { fwd, across, norm };
}

function computeEndoWristAngles(wl, state) {
  const frame = buildHandFrame(wl);
  const palmWidth = normLen(vec(wl[5], wl[17])) || 0.08;
  if (!state.refFrame) state.refFrame = frame;

  // Ortak yukarı-aşağı (pitch) sadece avuç gövdesinden (0->9): parmaklar birbirini etkilemez
  const pitchRaw = (Math.atan2(dot(frame.fwd, state.refFrame.norm), dot(frame.fwd, state.refFrame.fwd)) * 180) / Math.PI;
  if (state.pitchZero === null) state.pitchZero = pitchRaw;
  const pitchDelta = clamp(pitchRaw - state.pitchZero, -180, 180);

  // Bağımsız parmak açılması
  const thumbRaw = angleBetween(vec(wl[0], wl[4]), vec(wl[0], wl[5]));
  const indexRaw = angleBetween(vec(wl[0], wl[5]), vec(wl[5], wl[8]));
  if (state.thumbZero === null) state.thumbZero = thumbRaw;
  if (state.indexZero === null) state.indexZero = indexRaw;

  const tipGap = normLen(vec(wl[4], wl[8]));
  let openThumb = 0;
  let openIndex = 0;

  if (tipGap <= palmWidth * 0.42) {
    state.thumbZero = thumbRaw;
    state.indexZero = indexRaw;
  } else {
    openThumb = clamp(Math.max(0, thumbRaw - state.thumbZero) * 2.5, 0, 180);
    openIndex = clamp(Math.max(0, state.indexZero - indexRaw) * 1.15, 0, 180);
  }

  const m1 = clamp(pitchDelta - openThumb, -180, 180);
  const m2 = clamp(pitchDelta + openIndex, -180, 180);

  // M3 (Kendi etrafında dönme): 9->13 MCP hattı
  const midKnuckle = vec(wl[9], wl[13]);
  const m3 = clamp((Math.atan2(dot(midKnuckle, state.refFrame.norm), dot(midKnuckle, state.refFrame.across)) * 180) / Math.PI, -180, 180);

  // M4 (Bilek sağa-sola)
  const m4 = clamp((Math.atan2(dot(frame.fwd, state.refFrame.across), dot(frame.fwd, state.refFrame.fwd)) * 180) / Math.PI, -180, 180);

  return [m1, m2, m3, m4];
}

async function startCamera() {
  if (!handLandmarker) { alert("El tanıma modeli henüz yükleniyor, birkaç saniye bekleyin."); return; }
  if (stream) stream.getTracks().forEach((t) => t.stop());
  stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode, width: { ideal: 640 }, height: { ideal: 480 } },
    audio: false
  });
  video.srcObject = stream;
  await video.play();
  canvas.width = video.videoWidth || 640;
  canvas.height = video.videoHeight || 480;
  requestWakeLock();
  running = true;
  lastFrameMs = performance.now();
  requestAnimationFrame(loop);
}

btnStartCam.addEventListener("click", startCamera);
btnFlipCam.addEventListener("click", () => {
  facingMode = facingMode === "user" ? "environment" : "user";
  if (running) startCamera();
});

let frameCount = 0;
let fpsTimer = performance.now();

function loop(now) {
  if (!running) return;
  const dt = Math.min(0.1, Math.max(0.001, (now - lastFrameMs) / 1000));
  lastFrameMs = now;

  frameCount++;
  if (now - fpsTimer >= 1000) {
    fpsLabel.textContent = `${frameCount} FPS`;
    frameCount = 0;
    fpsTimer = now;
  }

  if (video.readyState >= 2 && video.currentTime !== lastVideoTime) {
    lastVideoTime = video.currentTime;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const res = handLandmarker.detectForVideo(video, now);
    let sawLeft = false;
    let sawRight = false;

    if (res.landmarks && res.landmarks.length > 0 && res.worldLandmarks) {
      const alpha = Number(rngAlpha.value);
      const deadband = Number(rngDeadband.value);
      const maxStep = Number(rngSlew.value) * dt;

      res.landmarks.forEach((lm, idx) => {
        const wl = res.worldLandmarks[idx];
        const rawLabel = res.handedness?.[idx]?.[0]?.categoryName || "Right";
        let isLeft = rawLabel === "Left";
        if (chkSwapHands.checked) isLeft = !isLeft;

        const color = isLeft ? "#38bdf8" : "#4ade80";
        drawingUtils.drawConnectors(lm, HandLandmarker.HAND_CONNECTIONS, { color, lineWidth: 3 });
        drawingUtils.drawLandmarks(lm, { color: "#f8fafc", radius: 4 });

        const st = isLeft ? handState.left : handState.right;
        if (isLeft) sawLeft = true; else sawRight = true;

        const raw = computeEndoWristAngles(wl, st);
        const offset = isLeft ? 0 : 4;

        for (let j = 0; j < 4; j++) {
          const ch = offset + j;
          let val = raw[j];
          if (calib[ch].invert) val = -val;
          val = clamp(val * calib[ch].gain, -180, 180);
          smoothed[ch] = alpha * val + (1 - alpha) * smoothed[ch];
          // Hız sınırlayıcı (Slew-Rate Limiter)
          const diff = smoothed[ch] - slewed[ch];
          slewed[ch] += clamp(diff, -maxStep, maxStep);
          valEls[ch].textContent = `${Math.round(slewed[ch])}°`;
        }
      });

      leftHandBadge.textContent = sawLeft ? "Algılandı" : "Yok";
      leftHandBadge.className = sawLeft ? "mini-status ok" : "mini-status";
      rightHandBadge.textContent = sawRight ? "Algılandı" : "Yok";
      rightHandBadge.className = sawRight ? "mini-status ok" : "mini-status";
      handStatus.textContent = `Sol: ${sawLeft ? "✓" : "✗"} | Sağ: ${sawRight ? "✓" : "✗"}`;
      handStatus.className = "pill ok";

      if (isArmed && now - lastSendTime >= 33) {
        const changed = slewed.some((v, i) => Math.abs(v - lastSent[i]) >= deadband);
        if (changed) {
          sendTargets(slewed, true);
          lastSent = [...slewed];
        } else {
          sendTargets(lastSent, true);
        }
        lastSendTime = now;
      }
    } else {
      leftHandBadge.textContent = "Yok";
      leftHandBadge.className = "mini-status";
      rightHandBadge.textContent = "Yok";
      rightHandBadge.className = "mini-status";
      handStatus.textContent = "Eller bekleniyor (Kilitli)";
      handStatus.className = "pill warn";
      if (isArmed) sendTargets(lastSent, false);
    }
  }
  requestAnimationFrame(loop);
}
