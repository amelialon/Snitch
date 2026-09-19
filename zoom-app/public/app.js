// Interview canary — Zoom App.
//
// Two injection channels for a pre-generated canary (SPEC §6), both gated on the candidate's
// consent to "measures that detect the use of unauthorized real-time assistance tools":
//
//   visual  Zoom camera mode (Layers API): the instruction is printed onto the recruiter's
//           OUTGOING video only, so a copilot that screenshots the candidate's screen may read
//           it. The recruiter's own sidebar never changes.
//   audio   Zoom Apps cannot mix into the microphone. The canary is instead played through an
//           app share with sound (candidate sees a plain question slide) or a computer-audio
//           share. Gain is applied at playback; the source buffer stays clean.
//
// This app never synthesises audio and never decides anything: it logs QuestionEvent and
// CanaryEvent records to the review backend (through the same-origin /api proxy) and stops.
// Only SDK methods verified against https://appssdk.zoom.us are used.

/* global zoomSdk */

const CAPABILITIES = [
  "getRunningContext",
  "getUserContext",
  "getMeetingUUID",
  "runRenderingContext",
  "closeRenderingContext",
  "drawParticipant",
  "clearParticipant",
  "drawImage",
  "clearImage",
  "onRenderedAppOpened",
  "shareApp",
  "onShareApp",
  "shareComputerAudio",
];

const $ = (id) => document.getElementById(id);
const uid = () => Math.random().toString(36).slice(2, 9);
const dbToGain = (db) => Math.pow(10, db / 20);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const state = {
  interviewId: "",
  consented: false,
  canaries: [],
  selected: null,
  questions: [], // { id, text, active }
  audio: { context: null, buffers: new Map(), playing: false },
  camera: { running: false, renderTarget: { width: 1280, height: 720 }, participantUUID: null, imageId: null },
  share: { app: false, computerAudio: false },
  sdk: false,
};

// --- helpers -------------------------------------------------------------------------------

function setStatus(text) {
  $("status").textContent = text;
  $("status").hidden = !text;
}
function setError(text) {
  $("error").textContent = text;
  $("error").hidden = !text;
}
function addLog(text) {
  const li = document.createElement("li");
  li.textContent = `${new Date().toLocaleTimeString()} · ${text}`;
  $("log").prepend(li);
}

async function api(path, init) {
  const r = await fetch(`/api${path}`, init);
  if (!r.ok) {
    const body = await r.json().catch(() => null);
    throw new Error(body?.detail ?? `Request failed (${r.status})`);
  }
  return r.status === 204 ? undefined : r.json();
}
const postJson = (path, body) =>
  api(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

const activeQuestion = () => state.questions.find((q) => q.active) ?? null;

/** Every send passes through here. No interview, no consent, no canary → nothing is sent. */
function armed() {
  return Boolean(state.interviewId && state.consented && state.selected);
}

function refreshButtons() {
  const ready = armed();
  const audioReady = ready && state.selected && state.audio.buffers.has(state.selected.audioUrl);
  $("visual-send").disabled = !(ready && state.camera.running && state.sdk);
  $("audio-send").disabled = !(audioReady && state.sdk) || state.audio.playing;
  $("audio-preview").disabled = !audioReady || state.audio.playing || state.share.app || state.share.computerAudio;
  $("camera-start").disabled = !state.sdk || state.camera.running;
  $("camera-stop").disabled = !state.camera.running;
}

// --- interview + consent + questions --------------------------------------------------------

async function loadInterviews() {
  const select = $("interview");
  try {
    const interviews = await api("/interviews");
    select.innerHTML = '<option value="">Select an interview…</option>';
    for (const i of interviews) {
      const o = document.createElement("option");
      o.value = i.id;
      o.textContent = `${i.candidate_label} · ${i.id} · consent by ${i.consent?.attested_by ?? "?"}`;
      select.appendChild(o);
    }
  } catch (e) {
    select.innerHTML = '<option value="">Backend unreachable</option>';
    setError(e.message);
  }
}

function renderQuestions() {
  const ul = $("questions");
  ul.innerHTML = "";
  for (const q of state.questions) {
    const li = document.createElement("li");
    if (q.active) li.classList.add("active");
    const span = document.createElement("span");
    span.textContent = q.text;
    const btn = document.createElement("button");
    btn.textContent = q.active ? "End" : "Start";
    btn.onclick = () => (q.active ? endQuestion(q) : startQuestion(q));
    li.append(span, btn);
    ul.appendChild(li);
  }
  $("stage-question").textContent = activeQuestion()?.text ?? "Question";
}

function startQuestion(q) {
  state.questions.forEach((x) => (x.active = x === q));
  $("cue").hidden = true;
  renderQuestions();
  if (state.interviewId) {
    postJson(`/interviews/${state.interviewId}/questions`, { id: q.id, text: q.text, started_at: new Date().toISOString() }).catch(
      (e) => setError(e.message),
    );
  }
}

function endQuestion(q) {
  q.active = false;
  renderQuestions();
  if (state.interviewId) {
    postJson(`/interviews/${state.interviewId}/questions`, { id: q.id, text: q.text, ended_at: new Date().toISOString() }).catch(
      (e) => setError(e.message),
    );
  }
}

// --- canary manifest + audio decode -------------------------------------------------------

async function loadCanaries() {
  const r = await fetch("/canaries/manifest.json");
  if (!r.ok) throw new Error(`Could not load the canary manifest (${r.status})`);
  state.canaries = await r.json();
  const select = $("canary");
  for (const c of state.canaries) {
    const o = document.createElement("option");
    o.value = c.id;
    o.textContent = `${c.id} — “${c.expectedMarker}”`;
    select.appendChild(o);
  }
}

async function selectCanary(id) {
  state.selected = state.canaries.find((c) => c.id === id) ?? null;
  $("cue").hidden = true;
  drawPreview();
  refreshButtons();
  if (!state.selected) {
    $("canary-meta").textContent = "";
    return;
  }
  $("canary-meta").textContent = `“${state.selected.instruction}” · ${state.selected.durationMs} ms · preloading…`;
  try {
    await preload(state.selected); // decode now, never at send time
    $("canary-meta").textContent = `“${state.selected.instruction}” · ${state.selected.durationMs} ms · READY`;
  } catch (e) {
    $("canary-meta").textContent = `“${state.selected.instruction}” · audio not available (visual still works)`;
    setError(e.message);
  }
  refreshButtons();
}

function audioContext() {
  if (!state.audio.context) state.audio.context = new AudioContext();
  return state.audio.context;
}

async function preload(canary) {
  if (state.audio.buffers.has(canary.audioUrl)) return;
  const r = await fetch(canary.audioUrl);
  if (!r.ok) throw new Error(`Could not load ${canary.id} audio (${r.status})`);
  state.audio.buffers.set(canary.audioUrl, await audioContext().decodeAudioData(await r.arrayBuffer()));
}

/** Plays a decoded canary to the webview's output through a gain stage; resolves when it ends. */
async function playCanary(canary, gainDb) {
  const ctx = audioContext();
  if (ctx.state === "suspended") await ctx.resume();
  const buffer = state.audio.buffers.get(canary.audioUrl);
  if (!buffer) throw new Error(`${canary.id} is not preloaded`);
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  const gain = ctx.createGain();
  gain.gain.value = dbToGain(gainDb); // source stays clean; gain applied only here
  source.connect(gain).connect(ctx.destination);
  state.audio.playing = true;
  refreshButtons();
  await new Promise((resolve) => {
    source.onended = resolve;
    source.start();
  });
  state.audio.playing = false;
  refreshButtons();
}

// --- visual: overlay bitmap ----------------------------------------------------------------

function overlaySettings() {
  return {
    opacity: Number($("opacity").value) / 100,
    fontPx: Number($("font").value),
    seconds: Number($("visual-secs").value),
    position: $("position").value,
  };
}

/**
 * Renders the instruction as a transparent strip the width of the render target. Kept as a
 * strip (not a full frame) so the ImageData handed to Zoom stays small.
 */
function renderOverlayStrip(width, text, { opacity, fontPx }) {
  const height = Math.round(fontPx * 2.2);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, width, height);
  ctx.globalAlpha = opacity;
  ctx.font = `500 ${fontPx}px -apple-system, "Segoe UI", Roboto, sans-serif`;
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  ctx.shadowColor = "rgba(0,0,0,0.6)";
  ctx.shadowBlur = Math.max(2, fontPx / 8);
  ctx.fillStyle = "#ffffff";
  ctx.fillText(text, width / 2, height / 2);
  return canvas;
}

function drawPreview() {
  const canvas = $("overlay-preview");
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#2a2f3a";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  // a silhouette stands in for the recruiter so the overlay's contrast is judged against a face
  ctx.fillStyle = "#3d4454";
  ctx.beginPath();
  ctx.ellipse(canvas.width / 2, canvas.height * 0.42, 60, 78, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(canvas.width / 2 - 120, canvas.height * 0.72, 240, canvas.height);
  if (!state.selected) return;
  const s = overlaySettings();
  const scale = canvas.width / state.camera.renderTarget.width;
  const strip = renderOverlayStrip(state.camera.renderTarget.width, state.selected.instruction, s);
  const y = s.position === "top" ? 0 : state.camera.renderTarget.height - strip.height;
  ctx.drawImage(strip, 0, y * scale, canvas.width, strip.height * scale);
}

// --- visual: Zoom camera mode ---------------------------------------------------------------

let renderedAppOpened = null;

async function startCameraMode() {
  setError("");
  try {
    const opened = new Promise((resolve) => (renderedAppOpened = resolve));
    await zoomSdk.runRenderingContext({ view: "camera" });
    // Camera mode spins up a separate off-screen webview; draw calls fail until it is open.
    await Promise.race([opened, sleep(2500)]);
    const me = await zoomSdk.getUserContext();
    state.camera.participantUUID = me.participantUUID;
    const { width, height } = state.camera.renderTarget;
    await zoomSdk.drawParticipant({ participantUUID: me.participantUUID, x: 0, y: 0, width, height, zIndex: 0 });
    state.camera.running = true;
    setStatus("Camera mode on. Your video is going out through the app, unchanged until you show a canary.");
    addLog("camera mode started");
  } catch (e) {
    setError(`Camera mode failed: ${e.message ?? JSON.stringify(e)}`);
  }
  refreshButtons();
}

async function stopCameraMode() {
  try {
    if (state.camera.imageId) await zoomSdk.clearImage({ imageId: state.camera.imageId }).catch(() => {});
    await zoomSdk.closeRenderingContext();
  } catch (e) {
    setError(`Could not close camera mode: ${e.message ?? JSON.stringify(e)}`);
  }
  state.camera.running = false;
  state.camera.imageId = null;
  setStatus("Camera mode off.");
  addLog("camera mode stopped");
  refreshButtons();
}

async function sendVisual() {
  if (!armed() || !state.camera.running) return;
  setError("");
  $("cue").hidden = true;
  const canary = state.selected;
  const s = overlaySettings();
  const { width, height } = state.camera.renderTarget;
  const strip = renderOverlayStrip(width, canary.instruction, s);
  const imageData = strip.getContext("2d").getImageData(0, 0, strip.width, strip.height);
  const y = s.position === "top" ? 0 : height - strip.height;
  const sentAt = new Date();
  try {
    const { imageId } = await zoomSdk.drawImage({ imageData, x: "0px", y: `${y}px`, zIndex: 2 });
    state.camera.imageId = imageId;
  } catch (e) {
    setError(`drawImage failed: ${e.message ?? JSON.stringify(e)}`);
    return;
  }
  $("visual-send").disabled = true;
  setStatus(`Showing “${canary.instruction}” on your video for ${s.seconds}s…`);
  await sleep(s.seconds * 1000);
  const finishedAt = new Date();
  if (state.camera.imageId) {
    await zoomSdk.clearImage({ imageId: state.camera.imageId }).catch(() => {});
    state.camera.imageId = null;
  }
  setStatus("Overlay cleared.");
  $("cue").hidden = false;
  addLog(`visual ${canary.id} (“${canary.expectedMarker}”) at ${Math.round(s.opacity * 100)}% for ${s.seconds}s`);
  logCanary({
    canary_id: canary.id,
    question_id: activeQuestion()?.id ?? null,
    expected_marker: canary.expectedMarker,
    instruction: canary.instruction,
    channel: "visual",
    delivery_method: "zoom-camera-overlay",
    platform: "zoom",
    overlay_opacity: s.opacity,
    sent_at: sentAt.toISOString(),
    finished_at: finishedAt.toISOString(),
  });
  refreshButtons();
}

// --- audio: share with sound ----------------------------------------------------------------

let shareStarted = null;

function showStage(on) {
  document.body.dataset.view = on ? "stage" : "console";
}

async function sendAudio() {
  if (!armed()) return;
  setError("");
  $("cue").hidden = true;
  const canary = state.selected;
  const gainDb = Number($("gain").value);
  const method = $("audio-method").value;
  const stopAfter = $("stop-after").checked;
  const deliveryMethod = method === "share-app" ? "zoom-share-app-sound" : "zoom-computer-audio";
  try {
    if (method === "share-app") {
      if (!state.share.app) {
        // The shared surface is this very page, so switch to the candidate-safe stage first.
        showStage(true);
        const started = new Promise((resolve) => (shareStarted = resolve));
        await zoomSdk.shareApp({ action: "start", withSound: true });
        await Promise.race([started, sleep(2000)]);
        state.share.app = true;
      }
    } else if (!state.share.computerAudio) {
      await zoomSdk.shareComputerAudio(); // Zoom prompts the recruiter once
      state.share.computerAudio = true;
    }
    await sleep(600); // let the share settle before the first samples
    const sentAt = new Date();
    await playCanary(canary, gainDb);
    const finishedAt = new Date();
    if (stopAfter && method === "share-app" && state.share.app) {
      await zoomSdk.shareApp({ action: "stop" }).catch(() => {});
      state.share.app = false;
      showStage(false);
    }
    $("cue").hidden = false;
    addLog(`audio ${canary.id} (“${canary.expectedMarker}”) at ${gainDb} dB via ${deliveryMethod}`);
    logCanary({
      canary_id: canary.id,
      question_id: activeQuestion()?.id ?? null,
      expected_marker: canary.expectedMarker,
      instruction: canary.instruction,
      channel: "audio",
      delivery_method: deliveryMethod,
      platform: "zoom",
      gain_db: gainDb,
      sent_at: sentAt.toISOString(),
      finished_at: finishedAt.toISOString(),
    });
  } catch (e) {
    showStage(false);
    setError(`Audio send failed: ${e.message ?? JSON.stringify(e)}`);
  }
  refreshButtons();
}

async function stopShare() {
  try {
    await zoomSdk.shareApp({ action: "stop" });
  } catch (e) {
    setError(`Could not stop sharing: ${e.message ?? JSON.stringify(e)}`);
  }
  state.share.app = false;
  showStage(false);
  refreshButtons();
}

async function previewAudio() {
  if (!state.selected || state.share.app || state.share.computerAudio) return; // never preview into a live share
  await playCanary(state.selected, Number($("gain").value));
}

function logCanary(event) {
  postJson(`/interviews/${state.interviewId}/canaries`, event).catch((e) => setError(`Logged locally only: ${e.message}`));
}

// --- boot -------------------------------------------------------------------------------------

function wire() {
  $("interview").onchange = (e) => {
    state.interviewId = e.target.value;
    refreshButtons();
  };
  $("consent").onchange = (e) => {
    state.consented = e.target.checked;
    refreshButtons();
  };
  $("question-add").onclick = () => {
    const text = $("question-draft").value.trim();
    if (!text) return;
    state.questions.push({ id: uid(), text, active: false });
    $("question-draft").value = "";
    renderQuestions();
  };
  $("question-draft").onkeydown = (e) => e.key === "Enter" && $("question-add").click();
  $("canary").onchange = (e) => selectCanary(e.target.value);
  for (const [id, out] of [
    ["opacity", "opacity-value"],
    ["font", "font-value"],
    ["visual-secs", "visual-secs-value"],
    ["gain", "gain-value"],
  ]) {
    $(id).oninput = () => {
      $(out).textContent = $(id).value;
      drawPreview();
    };
  }
  $("position").onchange = drawPreview;
  $("camera-start").onclick = startCameraMode;
  $("camera-stop").onclick = stopCameraMode;
  $("visual-send").onclick = sendVisual;
  $("audio-preview").onclick = previewAudio;
  $("audio-send").onclick = sendAudio;
  $("stage-stop").onclick = stopShare;
}

async function boot() {
  wire();
  drawPreview();

  if (typeof zoomSdk === "undefined") {
    document.body.dataset.view = "console";
    setError("Zoom Apps SDK not loaded. Open this page inside the Zoom client; outside it you can still pick canaries and preview.");
    await Promise.all([loadInterviews(), loadCanaries().catch((e) => setError(e.message))]);
    refreshButtons();
    return;
  }

  let config;
  try {
    config = await zoomSdk.config({ capabilities: CAPABILITIES, version: "0.16" });
  } catch (e) {
    document.body.dataset.view = "console";
    setError(`zoomSdk.config failed: ${e.message ?? JSON.stringify(e)}`);
    return;
  }

  // Camera mode loads this same URL in an off-screen webview. That instance draws nothing:
  // the sidebar instance paints the overlay with drawImage. Stay transparent and idle.
  if (config.runningContext === "inCamera") {
    document.body.dataset.view = "camera";
    return;
  }

  const rt = config.media?.renderTarget;
  if (rt?.width && rt?.height) state.camera.renderTarget = { width: rt.width, height: rt.height };
  state.sdk = true;
  document.body.dataset.view = "console";

  zoomSdk.addEventListener("onRenderedAppOpened", () => renderedAppOpened?.());
  zoomSdk.addEventListener("onShareApp", (ev) => {
    if (ev?.action === "start") {
      state.share.app = true;
      showStage(true); // sharing was started from Zoom's own UI: hide the controls anyway
      shareStarted?.();
    } else if (ev?.action === "stop") {
      state.share.app = false;
      showStage(false);
    }
    refreshButtons();
  });

  try {
    const { meetingUUID } = await zoomSdk.getMeetingUUID();
    setStatus(`In meeting ${meetingUUID.slice(0, 8)}… · ${config.runningContext}`);
  } catch {
    setStatus(`Context: ${config.runningContext}. Camera mode and sending need an active meeting.`);
  }

  await Promise.all([loadInterviews(), loadCanaries().catch((e) => setError(e.message))]);
  drawPreview();
  refreshButtons();
}

boot();
