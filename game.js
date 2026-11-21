import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

// ---------- renderer: capped pixel ratio, cheap shadows ----------
const mobile = matchMedia("(pointer: coarse)").matches;
const renderer = new THREE.WebGLRenderer({ antialias: !mobile, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(devicePixelRatio, mobile ? 1.25 : 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.NeutralToneMapping;   // crisper, less washed-out than ACES
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x5fb6ff);
scene.fog = new THREE.Fog(0x7cc4ff, 55, 110);
const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, 140);
camera.position.set(0, 2.4, -4.6);

scene.add(new THREE.HemisphereLight(0xcfe8ff, 0x3d6b2a, 1.6));
const sun = new THREE.DirectionalLight(0xfff1d6, 2.4);
sun.position.set(-4, 10, -3); sun.castShadow = true;
sun.shadow.mapSize.set(512, 512);                   // only the player casts a shadow: small map is enough
Object.assign(sun.shadow.camera, { left: -2, right: 2, top: 2, bottom: -2, near: 1, far: 20 });
scene.add(sun, sun.target);

// ---------- world ----------
const LANES = [1.5, 0, -1.5];
function checker(c1, c2, n) {
  const cv = document.createElement("canvas"); cv.width = cv.height = 128; const g = cv.getContext("2d"); const s = 128 / n;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { g.fillStyle = (x + y) % 2 ? c1 : c2; g.fillRect(x * s, y * s, s, s); }
  const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = renderer.capabilities.getMaxAnisotropy(); return t;   // sharp track at grazing angles
}
const trackTex = checker("#c9873a", "#a8642a", 4); trackTex.repeat.set(2, 40);
const track = new THREE.Mesh(new THREE.PlaneGeometry(5.2, 200), new THREE.MeshLambertMaterial({ map: trackTex }));
track.rotation.x = -Math.PI / 2; track.position.z = 90; track.receiveShadow = true; scene.add(track);
const grassTex = checker("#4fbf3a", "#3fa62f", 8); grassTex.repeat.set(10, 40);
const grass = new THREE.Mesh(new THREE.PlaneGeometry(80, 200), new THREE.MeshLambertMaterial({ map: grassTex }));
grass.rotation.x = -Math.PI / 2; grass.position.set(0, -0.01, 90); scene.add(grass);
const hillGeo = new THREE.SphereGeometry(1, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2);
const hillMats = [new THREE.MeshLambertMaterial({ color: 0x2f9a3a }), new THREE.MeshLambertMaterial({ color: 0x3db24a })];
for (let i = 0; i < 10; i++) {
  const h = new THREE.Mesh(hillGeo, hillMats[i % 2]); const r = 8 + Math.random() * 8;
  h.scale.set(r, r * 0.6, r); h.position.set((i % 2 ? 1 : -1) * (24 + Math.random() * 18), -1, 30 + i * 9); scene.add(h);
}
// palms: shared geometry/material, no shadows, recycled
const trunkGeo = new THREE.CylinderGeometry(0.12, 0.18, 3.2, 6), leafGeo = new THREE.ConeGeometry(0.35, 2.2, 4);
const trunkMat = new THREE.MeshLambertMaterial({ color: 0x8a5a2b }), leafMat = new THREE.MeshLambertMaterial({ color: 0x2e9e3b });
const palms = [];
for (let i = 0; i < 10; i++) {
  const g = new THREE.Group(); const t = new THREE.Mesh(trunkGeo, trunkMat); t.position.y = 1.6; g.add(t);
  for (let k = 0; k < 5; k++) { const l = new THREE.Mesh(leafGeo, leafMat); l.position.y = 3.2; l.rotation.set(1.2, (k / 5) * Math.PI * 2, 0, "YXZ"); l.translateY(1); g.add(l); }
  g.position.set((i % 2 ? 1 : -1) * (6 + Math.random() * 3), 0, i * 9.6); scene.add(g); palms.push(g);
}

// ---------- pooled obstacles + rings (no allocations during play = no stutter) ----------
const ringGeo = new THREE.TorusGeometry(0.32, 0.07, 8, 20);
const ringMat = new THREE.MeshLambertMaterial({ color: 0xffc21a, emissive: 0x6a4200 });
const spikeGeo = new THREE.ConeGeometry(0.15, 0.5, 8), baseGeo = new THREE.BoxGeometry(1.1, 0.18, 0.7);
const spikeMat = new THREE.MeshPhongMaterial({ color: 0xd8dde3, shininess: 80 }), baseMat = new THREE.MeshLambertMaterial({ color: 0xc02020 });
function makeSpike() {
  const g = new THREE.Group(); const b = new THREE.Mesh(baseGeo, baseMat); b.position.y = 0.09; g.add(b);
  for (let i = 0; i < 3; i++) { const s = new THREE.Mesh(spikeGeo, spikeMat); s.position.set(-0.33 + i * 0.33, 0.43, 0); g.add(s); }
  return g;
}
const pool = { spike: [], ring: [] };
const active = [];
function take(kind) {
  const o = pool[kind].pop() || (kind === "ring" ? new THREE.Mesh(ringGeo, ringMat) : makeSpike());
  o.visible = true; if (!o.parent) scene.add(o); return o;
}
function release(i) { const it = active[i]; it.obj.visible = false; pool[it.kind].push(it.obj); active.splice(i, 1); }
function spawnSpikes(lane, z) { const o = take("spike"); o.position.set(LANES[lane], 0, z); active.push({ kind: "spike", obj: o }); }
function spawnRings(lane, z, n, arc) {
  for (let i = 0; i < n; i++) {
    const o = take("ring"); o.position.set(LANES[lane], 0.75 + (arc ? Math.sin((i / (n - 1)) * Math.PI) * 1.7 : 0), z + i * 1.6);
    active.push({ kind: "ring", obj: o });
  }
}
function spawnRow(z) {
  const free = [0, 1, 2]; const blocked = Math.random() < 0.35 ? 2 : 1;
  for (let i = 0; i < blocked; i++) {
    const k = free.splice(Math.floor(Math.random() * free.length), 1)[0]; spawnSpikes(k, z);
    if (Math.random() < 0.4) spawnRings(k, z - 3.2, 5, true);
  }
  if (Math.random() < 0.8) spawnRings(free[Math.floor(Math.random() * free.length)], z + 2, 5, false);
}

// ---------- player ----------
const player = new THREE.Group(); scene.add(player);
let rig = null;
new GLTFLoader().load("./sonic.glb", (gltf) => {
  const model = gltf.scene; player.add(model); model.updateMatrixWorld(true);
  model.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; } });
  const root = model.getObjectByName("Rig") || model;
  const pivot = (name) => {
    const limb = model.getObjectByName(name); const box = new THREE.Box3().setFromObject(limb);
    const top = new THREE.Vector3((box.min.x + box.max.x) / 2, box.max.y - 0.03, (box.min.z + box.max.z) / 2);
    const p = new THREE.Group(); root.add(p); p.position.copy(root.worldToLocal(top)); root.updateMatrixWorld(true); p.attach(limb); return p;
  };
  rig = { root, legL: pivot("LegL"), legR: pivot("LegR"), armL: pivot("ArmL"), armR: pivot("ArmR"), baseY: root.position.y };
  for (let i = 0; i < 40; i++) pool.ring.push(Object.assign(new THREE.Mesh(ringGeo, ringMat), { visible: false }));
  for (let i = 0; i < 12; i++) pool.spike.push(Object.assign(makeSpike(), { visible: false }));
  [...pool.ring, ...pool.spike].forEach((o) => scene.add(o));
  renderer.compile(scene, camera);                       // upload shaders before play = no first-frame hitch
  document.getElementById("go").disabled = false; window.__ready = true;
});

// ---------- state + snappy input ----------
const S = { running: false, lane: 1, x: 0, y: 0, vy: 0, speed: 16, dist: 0, rings: 0, t: 0, phase: 0 };
const GRAV = -42, JUMP = 13.5;
let jumpBuffer = 0; window.__S = S;                                      // a jump pressed just before landing still fires
function jump() { if (S.running) jumpBuffer = 0.15; }
function move(d) { if (S.running) S.lane = Math.max(0, Math.min(2, S.lane + d)); }
addEventListener("keydown", (e) => {
  if (e.repeat) return;
  if (["ArrowLeft", "a", "A"].includes(e.key)) move(-1);
  if (["ArrowRight", "d", "D"].includes(e.key)) move(1);
  if (["ArrowUp", " ", "w", "W"].includes(e.key)) { jump(); e.preventDefault(); }
});
// FINGER-FOLLOW steering: while the finger is down, the runner tracks it 1:1 (no lanes, no delay).
// On release he snaps to the nearest lane; a quick flick throws him one lane in that direction;
// a short tap or an upward flick = jump.
const drag = { on: false, id: -1, x0: 0, y0: 0, px0: 0, t0: 0, lx: 0, lt: 0, vx: 0, steer: false };
const pxPerLane = () => Math.min(innerWidth, 900) / 2.4;   // calmer: a lane = ~40% of the screen width
// DIRECTION LOCK: nothing moves until the finger has travelled 14 px; then the gesture is locked to ONE axis.
// Mostly-up = jump only (he never slides sideways), mostly-sideways = steer only.
addEventListener("pointerdown", (e) => {
  if (!S.running || e.target.tagName === "BUTTON") return;
  Object.assign(drag, { on: true, id: e.pointerId, x0: e.clientX, y0: e.clientY, px0: S.x, t0: e.timeStamp, lx: e.clientX, lt: e.timeStamp, vx: 0, axis: null, jumped: false, sx0: 0 });
});
addEventListener("pointermove", (e) => {
  if (!drag.on || e.pointerId !== drag.id) return;
  const pts = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
  const last = pts.length ? pts[pts.length - 1] : e;
  const dx = last.clientX - drag.x0, dy = last.clientY - drag.y0;
  const dtm = Math.max(1, last.timeStamp - drag.lt); drag.vx = (last.clientX - drag.lx) / dtm; drag.lx = last.clientX; drag.lt = last.timeStamp;
  if (!drag.axis && Math.hypot(dx, dy) > 10) {
    drag.axis = Math.abs(dy) > Math.abs(dx) * 0.9 ? "v" : "h";       // ties go to vertical: an up-swipe never steers
    drag.sx0 = dx;                                                      // steer from here, so there's no jump in position
  }
  if (drag.axis === "v") { if (!drag.jumped && dy < -20) { jump(); drag.jumped = true; } return; }
  if (drag.axis === "h") {
    // screen-right is world -X (camera looks down +Z)
    S.steerX = Math.max(LANES[2], Math.min(LANES[0], drag.px0 - ((dx - drag.sx0) / pxPerLane()) * 1.5));
  }
});
const endDrag = (e) => {
  if (!drag.on || e.pointerId !== drag.id) return;
  drag.on = false;
  const dx = e.clientX - drag.x0, dy = e.clientY - drag.y0, dur = e.timeStamp - drag.t0;
  if (S.steerX !== undefined) {
    let lane = LANES.reduce((best, x, i) => (Math.abs(x - S.steerX) < Math.abs(LANES[best] - S.steerX) ? i : best), 0);
    if (drag.axis === "h" && Math.abs(drag.vx) > 0.6) {                          // flick: carry momentum one lane further
      const dir = drag.vx > 0 ? 1 : -1; const fromLane = LANES.reduce((b, x, i) => (Math.abs(x - drag.px0) < Math.abs(LANES[b] - drag.px0) ? i : b), 0);
      lane = Math.max(0, Math.min(2, Math.abs(lane - fromLane) >= 1 ? lane : fromLane + dir));
    }
    S.lane = lane; S.steerX = undefined;
  } else if (!drag.axis && dur < 250) jump();
};
addEventListener("pointerup", endDrag); addEventListener("pointercancel", endDrag);

const $rings = document.getElementById("rings"), $score = document.getElementById("score");
let shownRings = -1, shownScore = -1, nextRow = 90;
function reset() {
  for (let i = active.length - 1; i >= 0; i--) release(i);
  player.rotation.z = 0; dtS = 1 / 60; clock.getDelta();
  Object.assign(S, { steerX: undefined, vx: 0, running: true, lane: 1, x: 0, y: 0, vy: 0, speed: 16, dist: 0, rings: 0, t: 0 });
  for (let z = 22; z < 90; z += 12) spawnRow(z); nextRow = 90;
  document.getElementById("start").style.display = "none"; document.getElementById("over").style.display = "none";
}
document.getElementById("go").onclick = reset;
document.getElementById("again").onclick = reset;
let lastScore = 0, lastRings = 0;
function gameOver() {
  S.running = false;
  lastScore = Math.floor(S.dist) + S.rings * 10;
  lastRings = S.rings;
  document.getElementById("final").textContent = `Rings ${S.rings} · Score ${lastScore}`;
  document.getElementById("over").style.display = "flex";
  onGameOver(lastScore, lastRings);
}

// ---------- loop ----------
const clock = new THREE.Clock();
let dtS = 1 / 60;
// DYNAMIC RESOLUTION: if the phone starts dropping frames (heat, battery saver), render fewer pixels instead of stuttering
const maxPR = Math.min(devicePixelRatio, mobile ? 1.25 : 1.5); let pr = maxPR, slow = 0, fast = 0;
function adaptQuality(ft) {
  if (ft > 1 / 50) { slow += ft; fast = 0; } else if (ft < 1 / 58) { fast += ft; slow = Math.max(0, slow - ft); }
  if (slow > 0.6 && pr > 0.7) { pr = Math.max(0.7, pr - 0.15); renderer.setPixelRatio(pr); slow = 0; }
  if (fast > 4 && pr < maxPR) { pr = Math.min(maxPR, pr + 0.1); renderer.setPixelRatio(pr); fast = 0; }
}
const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));   // frame-rate independent smoothing
renderer.setAnimationLoop(() => {
  const raw = Math.min(clock.getDelta(), 1 / 20);
  dtS += (raw - dtS) * 0.15; const dt = dtS;            // smoothed frame time: no micro-jitter from uneven frames
  adaptQuality(raw);
  if (S.running) {
    S.t += dt; S.speed = Math.min(28, 16 + S.t * 0.4);
    const dz = S.speed * dt; S.dist += dz;
    for (const it of active) it.obj.position.z -= dz;
    // keep offsets in 0..1: a growing offset loses GPU precision on phones and the track goes blurry/jittery later in a run
    trackTex.offset.y = (trackTex.offset.y + dz / 5) % 1; grassTex.offset.y = (grassTex.offset.y + dz / 5) % 1;
    for (const p of palms) { p.position.z -= dz; if (p.position.z < -8) p.position.z += 96; }
    nextRow -= dz; if (nextRow < 78) { spawnRow(90); nextRow = 90; }
    // finger down: follow the finger almost exactly; released/keys: fast snap to the lane
    // critically-damped SPRING (position + velocity): motion never starts or stops abruptly, so it never feels stiff.
    // Finger down: firmer spring that trails the finger by ~1-2 frames. Released: softer glide into the lane.
    const k = S.steerX !== undefined ? 520 : 230, c = 2 * Math.sqrt(k);
    const tgtX = S.steerX !== undefined ? S.steerX : LANES[S.lane];
    S.vx = (S.vx || 0) + ((tgtX - S.x) * k - S.vx * c) * dt; S.x += S.vx * dt;
    if (jumpBuffer > 0) { jumpBuffer -= dt; if (S.y <= 0.001) { S.vy = JUMP; jumpBuffer = 0; } }
    S.vy += GRAV * dt; S.y += S.vy * dt; if (S.y < 0) { S.y = 0; S.vy = 0; }
    for (let i = active.length - 1; i >= 0; i--) {
      const it = active[i], o = it.obj, z = o.position.z;
      if (z < -6) { release(i); continue; }
      if (it.kind === "ring") o.rotation.y += dt * 4;
      if (Math.abs(z) < 0.55 && Math.abs(o.position.x - S.x) < 0.7) {
        if (it.kind === "ring") { if (Math.abs(o.position.y - (S.y + 0.6)) < 0.9) { S.rings++; release(i); } }
        else if (S.y < 0.55) { gameOver(); break; }
      }
    }
    const score = Math.floor(S.dist) + S.rings * 10;
    if (S.rings !== shownRings) { $rings.textContent = shownRings = S.rings; }
    if (score !== shownScore) { $score.textContent = shownScore = score; }
    S.phase += dt * S.speed * 0.85;
  } else S.phase += dt * 3;
  player.position.set(S.x, S.y, 0);
  if (rig) {
    const air = S.y > 0.05, legA = S.running ? 1.0 : 0.12, armA = S.running ? 0.9 : 0.08, sp = Math.sin(S.phase);
    rig.legL.rotation.x = damp(rig.legL.rotation.x, air ? -1.2 : sp * legA, 30, dt);
    rig.legR.rotation.x = damp(rig.legR.rotation.x, air ? -1.2 : -sp * legA, 30, dt);
    rig.armL.rotation.x = damp(rig.armL.rotation.x, air ? 0.9 : -sp * armA, 30, dt);
    rig.armR.rotation.x = damp(rig.armR.rotation.x, air ? 0.9 : sp * armA, 30, dt);
    rig.root.position.y = rig.baseY + (S.running && !air ? Math.abs(sp) * 0.05 : 0);
    player.rotation.z = damp(player.rotation.z, Math.max(-0.32, Math.min(0.32, -(S.vx || 0) * 0.045)), 18, dt);   // lean from real sideways speed
  }
  camera.position.x = damp(camera.position.x, S.x * 0.6, 14, dt);
  camera.lookAt(S.x * 0.4, 0.9, 6);
  sun.position.set(S.x - 4, 10, -3); sun.target.position.set(S.x, 0, 0);
  renderer.render(scene, camera);
  window.__info = { calls: renderer.info.render.calls, tris: renderer.info.render.triangles, pr, pool: pool.ring.length + pool.spike.length, active: active.length };
});
addEventListener("resize", () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });

// ---------- live global leaderboard ----------
const API = "/api/scores";
const $name = document.getElementById("name");
const $submit = document.getElementById("submit");
const $msg = document.getElementById("msg");
const rowBoxes = [document.querySelector("#lb-start .rows"), document.querySelector("#lb-over .rows")];
let myTs = 0;

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
function renderBoard(top) {
  const html = top && top.length
    ? top.map((s, i) => `<div class="row${s.ts === myTs ? " me" : ""}"><span class="rk">${i + 1}</span><span class="nm">${esc(s.name)}</span><span class="sc">${Number(s.score).toLocaleString()}</span></div>`).join("")
    : `<div class="empty">No runs yet — be the first!</div>`;
  rowBoxes.forEach((b) => { if (b) b.innerHTML = html; });
}
async function fetchBoard() {
  try {
    const r = await fetch(API, { cache: "no-store" });
    if (!r.ok) throw 0;
    const d = await r.json();
    renderBoard(d.top);
  } catch {
    rowBoxes.forEach((b) => { if (b) b.innerHTML = `<div class="empty">Leaderboard offline</div>`; });
  }
}
function onGameOver(score, rings) {
  myTs = 0;
  $name.value = localStorage.getItem("bd_name") || "";
  $submit.disabled = false; $submit.textContent = "SUBMIT";
  $msg.textContent = "";
  fetchBoard();
}
$submit.onclick = async () => {
  const name = ($name.value || "").trim() || "RUNNER";
  localStorage.setItem("bd_name", name);
  $submit.disabled = true; $submit.textContent = "…";
  $msg.textContent = "Submitting…";
  try {
    const r = await fetch(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, score: lastScore, rings: lastRings }) });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "failed");
    const me = d.top.find((s) => s.name === name && s.score === lastScore);
    myTs = me ? me.ts : 0;
    renderBoard(d.top);
    $msg.textContent = d.rank ? `You're #${d.rank} globally! 🎉` : "Score saved!";
    $submit.textContent = "SAVED ✓";
  } catch {
    $msg.textContent = "Couldn't submit — try again.";
    $submit.disabled = false; $submit.textContent = "SUBMIT";
  }
};
// keep typing in the name field from steering/jumping the runner
$name.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Enter") { e.preventDefault(); $submit.click(); } });
fetchBoard();
