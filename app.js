import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

/* ======================================================================
   This viewer has NO hardcoded site list — everything (names, descriptions,
   and electrode positions) is read from ./emg-electrodes.json, exported by
   the instructor's editor tool. Model is in METRES, unlike the skeleton
   tool's centimetres.
====================================================================== */
const CONNECTOR_RADIUS_M = 0.0012;
const PAD_WIDTH_M = 0.020;
const PAD_DEPTH_M = 0.024;
const PAD_THICKNESS_M = 0.0022;
const GROUND_PAD_WIDTH_M = 0.030;
const GROUND_PAD_DEPTH_M = 0.036;
const STUD_RADIUS_M = 0.0035;
const STUD_HEIGHT_M = 0.0038;
const PAD_COLOR = '#f2ede0';
const PAD_EDGE_COLOR = '#e2dbc9';
const BIPOLAR_COLOR = '#ffcd3c';
const GROUND_COLOR = '#33d1c9';

let SITES = [];
let GROUNDS = [];
const state = { labelsOn: true };
const siteMarkers = {};
const groundMarkers = {};

/* ======================================================================
   THREE SETUP (metre-scale)
====================================================================== */
const canvasHost = document.getElementById('canvas-host');

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x12161d);
scene.fog = new THREE.Fog(0x12161d, 3, 14);

const camera = new THREE.PerspectiveCamera(42, 1, 0.01, 60);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
canvasHost.appendChild(renderer.domElement);

const labelRenderer = new CSS2DRenderer();
labelRenderer.domElement.style.position = 'absolute';
labelRenderer.domElement.style.top = '0';
labelRenderer.domElement.style.left = '0';
labelRenderer.domElement.style.touchAction = 'none';
labelRenderer.domElement.tabIndex = 0;
labelRenderer.domElement.style.outline = 'none';
['pointerdown', 'wheel', 'mouseenter'].forEach((evt) => {
  labelRenderer.domElement.addEventListener(evt, () => {
    labelRenderer.domElement.focus({ preventScroll: true });
  }, { passive: true });
});
canvasHost.appendChild(labelRenderer.domElement);

const controls = new OrbitControls(camera, labelRenderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.zoomSpeed = 0.6;
controls.target.set(0, 0.5, 0);
camera.position.set(0.6, 0.8, 1.3);
labelRenderer.domElement.addEventListener('wheel', () => {
  controls.update();
  renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
}, { passive: true });
controls.update();

scene.add(new THREE.HemisphereLight(0xf5f2ea, 0x1a1d24, 0.9));
const key = new THREE.DirectionalLight(0xfff6e8, 1.4);
key.position.set(1.2, 2.2, 1.5);
scene.add(key);
const fill = new THREE.DirectionalLight(0x9db4ff, 0.5);
fill.position.set(-1.5, 0.6, -1.0);
scene.add(fill);
const rim = new THREE.DirectionalLight(0xffffff, 0.35);
rim.position.set(0, 0.8, -2.2);
scene.add(rim);

const modelRoot = new THREE.Group();
scene.add(modelRoot);
const markersGroup = new THREE.Group();
scene.add(markersGroup);

function resize() {
  const w = canvasHost.clientWidth;
  const h = canvasHost.clientHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  labelRenderer.setSize(w, h);
}
window.addEventListener('resize', resize);
resize();

let flyTarget = null;
let flyPos = null;
function tickCameraFly() {
  if (flyTarget) {
    controls.target.lerp(flyTarget, 0.12);
    camera.position.lerp(flyPos, 0.12);
    if (controls.target.distanceTo(flyTarget) < 0.001) { flyTarget = null; flyPos = null; }
  }
}

function animate() {
  requestAnimationFrame(animate);
  tickCameraFly();
  controls.update();
  renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
}
animate();

/* ======================================================================
   MATERIAL / TISSUE COLOUR CLASSIFICATION (same scheme as the editor)
====================================================================== */
const TISSUE_COLORS = {
  bone: '#e8dfc8', cartilage: '#cfe0e6', tendon: '#e3d9bd',
  ligament: '#e6d98a', bursa: '#f0c9a0', capsule: '#d8dade', fascia: '#eef0ee',
};
const MUSCLE_BASE = '#9c3b3b';

function classifyMaterial(name) {
  const n = name.toLowerCase();
  if (n.startsWith('bone')) return 'bone';
  if (n === 'cartilage') return 'cartilage';
  if (n === 'tendon') return 'tendon';
  if (n === 'ligament') return 'ligament';
  if (n === 'bursa') return 'bursa';
  if (n === 'articular_capsule') return 'capsule';
  if (n === 'fascia') return 'fascia';
  return 'muscle';
}
function hashHueOffsetDeg(name) {
  let h = 0;
  for (let i = 0; i < name.length; i += 1) h = (h * 31 + name.charCodeAt(i)) % 360;
  return (h % 17) - 8;
}
function muscleColorFor(name) {
  const base = new THREE.Color(MUSCLE_BASE);
  const hsl = { h: 0, s: 0, l: 0 };
  base.getHSL(hsl);
  let hue = hsl.h + hashHueOffsetDeg(name) / 360;
  if (hue < 0) hue += 1;
  if (hue > 1) hue -= 1;
  return new THREE.Color().setHSL(hue, Math.min(0.55, hsl.s + 0.05), hsl.l);
}

/* ======================================================================
   TISSUE LAYER VISIBILITY — same idea as the editor: lets students hide
   whole tissue categories (e.g. Bone, Bursa, Fascia) to declutter the view.
====================================================================== */
const TISSUE_LABELS = {
  muscle: 'Muscle', bone: 'Bone', cartilage: 'Cartilage', tendon: 'Tendon',
  ligament: 'Ligament', bursa: 'Bursa', capsule: 'Articular capsule', fascia: 'Fascia',
};
const tissueGroups = {};

function tagTissueGroups(obj) {
  obj.traverse((child) => {
    if (!child.isMesh || !child.material) return;
    const matName = Array.isArray(child.material) ? child.material[0].name : child.material.name;
    const tissue = classifyMaterial(matName || '');
    if (!tissueGroups[tissue]) tissueGroups[tissue] = [];
    tissueGroups[tissue].push(child);
  });
}

const tissueTogglesEl = document.getElementById('tissue-toggles');
function buildTissueToggles() {
  if (!tissueTogglesEl) return;
  tissueTogglesEl.innerHTML = '';
  Object.keys(TISSUE_LABELS).forEach((k) => {
    if (!tissueGroups[k] || !tissueGroups[k].length) return;
    const row = document.createElement('label');
    row.className = 'toggle-row tissue-toggle-row';
    row.innerHTML = `
      <span>${TISSUE_LABELS[k]}</span>
      <span class="switch">
        <input type="checkbox" data-tissue="${k}" checked>
        <span class="track"></span>
      </span>
    `;
    tissueTogglesEl.appendChild(row);
  });
  tissueTogglesEl.querySelectorAll('[data-tissue]').forEach((input) => {
    input.addEventListener('change', () => {
      const t = input.dataset.tissue;
      (tissueGroups[t] || []).forEach((mesh) => { mesh.visible = input.checked; });
    });
  });
}

/* ======================================================================
   MODEL LOADING
====================================================================== */
const loadingOverlay = document.getElementById('loading-overlay');
const loadingStatus = document.getElementById('loading-status');
const loadErrorEl = document.getElementById('load-error');

let loadWatchdogA = null;
let loadWatchdogB = null;
function armWatchdogs() {
  loadWatchdogA = setTimeout(() => {
    loadingStatus.textContent = 'Still downloading\u2026 this can take a while on a slower connection (~28MB).';
  }, 7000);
  loadWatchdogB = setTimeout(() => {
    loadingStatus.innerHTML = `Taking longer than expected. Open your browser's dev tools
      (F12) &rarr; Network tab and reload &mdash; look for any request to
      <code>leftleg.obj</code> showing 404 or a stalled transfer.`;
  }, 25000);
}
function clearWatchdogs() { clearTimeout(loadWatchdogA); clearTimeout(loadWatchdogB); }

function updateLoadingProgress(xhr, stage) {
  if (xhr && xhr.total) {
    const pct = Math.round((xhr.loaded / xhr.total) * 100);
    loadingStatus.textContent = `Loading ${stage}\u2026 ${pct}%`;
  } else {
    loadingStatus.textContent = `Loading ${stage}\u2026`;
  }
}
function hideLoading() { loadingOverlay.classList.add('hidden'); }
function showLoadError(file, err) {
  loadingOverlay.classList.add('hidden');
  loadErrorEl.classList.add('visible');
  const detail = document.getElementById('load-error-detail');
  if (detail) {
    const status = err && err.target && err.target.status;
    detail.textContent = status
      ? `Failed to load ${file} (HTTP ${status}). Check that this file exists in the repo, in the right folder.`
      : `Failed to load ${file}. Check the browser console (F12) for the exact error.`;
  }
}

function loadModel() {
  armWatchdogs();
  const mtlLoader = new MTLLoader();
  mtlLoader.setPath('./');
  mtlLoader.load(
    'leftleg.mtl',
    (materials) => {
      materials.preload();
      Object.keys(materials.materials).forEach((matName) => {
        const mat = materials.materials[matName];
        const tissue = classifyMaterial(matName);
        mat.color = tissue === 'muscle' ? muscleColorFor(matName) : new THREE.Color(TISSUE_COLORS[tissue]);
        mat.emissive = new THREE.Color(0x000000);
        mat.shininess = tissue === 'bone' ? 24 : 14;
      });

      const objLoader = new OBJLoader();
      objLoader.setMaterials(materials);
      objLoader.setPath('./');
      objLoader.load(
        'leftleg.obj',
        (obj) => {
          clearWatchdogs();
          modelRoot.add(obj);
          tagTissueGroups(obj);
          buildTissueToggles();
          frameModel(obj);
          hideLoading();
          loadData();
        },
        (xhr) => updateLoadingProgress(xhr, 'model'),
        (err) => { clearWatchdogs(); showLoadError('leftleg.obj', err); }
      );
    },
    (xhr) => updateLoadingProgress(xhr, 'materials'),
    (err) => { clearWatchdogs(); showLoadError('leftleg.mtl', err); }
  );
}

function frameModel(obj) {
  const box = new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z);
  const fitDist = (maxDim / 2) / Math.tan((camera.fov * Math.PI) / 360) * 1.35;

  controls.target.copy(center);
  camera.position.set(center.x + fitDist * 0.55, center.y + size.y * 0.15, center.z + fitDist * 0.85);
  controls.minDistance = maxDim * 0.08;
  controls.maxDistance = maxDim * 3.5;
  controls.update();
}

/* ======================================================================
   DATA — emg-electrodes.json is the single source of truth
====================================================================== */
const noDataNotice = document.getElementById('no-landmarks-notice');

async function loadData() {
  try {
    const res = await fetch('./emg-electrodes.json', { cache: 'no-store' });
    if (!res.ok) throw new Error(`emg-electrodes.json returned HTTP ${res.status}`);
    const data = await res.json();
    SITES = Array.isArray(data.sites) ? data.sites : [];
    GROUNDS = Array.isArray(data.grounds) ? data.grounds : [];

    buildSheet();

    let placed = 0;
    SITES.forEach((s) => {
      if (s.a) { placeSiteElectrode(s.id, 'a', new THREE.Vector3(s.a.x, s.a.y, s.a.z), normalFromStored(s.a)); placed += 1; }
      if (s.b) { placeSiteElectrode(s.id, 'b', new THREE.Vector3(s.b.x, s.b.y, s.b.z), normalFromStored(s.b)); placed += 1; }
    });
    GROUNDS.forEach((g) => {
      if (g.position) { placeGround(g.id, new THREE.Vector3(g.position.x, g.position.y, g.position.z), normalFromStored(g.position)); placed += 1; }
    });

    if (!placed && noDataNotice) noDataNotice.classList.add('visible');
  } catch (err) {
    console.warn('Could not load emg-electrodes.json — showing the bare model.', err);
    if (noDataNotice) noDataNotice.classList.add('visible');
  }
}

/* ======================================================================
   SIDEBAR
====================================================================== */
const sheetEl = document.getElementById('marker-sheet');

function buildSheet() {
  sheetEl.innerHTML = '';
  if (SITES.length) {
    const siteHeader = document.createElement('div');
    siteHeader.className = 'region-header';
    siteHeader.innerHTML = `<span class="region-swatch" style="background:${BIPOLAR_COLOR}"></span><span>Bipolar EMG sites</span>`;
    sheetEl.appendChild(siteHeader);

    SITES.forEach((site) => {
      const row = document.createElement('div');
      row.className = 'marker-row';
      row.tabIndex = 0;
      row.dataset.siteId = site.id;
      row.innerHTML = `
        <span class="marker-dot-pair">
          <span class="marker-dot" style="background:${BIPOLAR_COLOR}"></span>
          <span class="marker-dot" style="background:${BIPOLAR_COLOR}"></span>
        </span>
        <span class="marker-text">
          <div class="marker-name">${site.name}</div>
          <div class="marker-abbr">${site.abbr}</div>
        </span>
      `;
      row.addEventListener('click', () => onSiteRowClick(site.id));
      row.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSiteRowClick(site.id); } });
      sheetEl.appendChild(row);
    });
  }

  if (GROUNDS.length) {
    const groundHeader = document.createElement('div');
    groundHeader.className = 'region-header';
    groundHeader.innerHTML = `<span class="region-swatch" style="background:${GROUND_COLOR}"></span><span>Ground electrode(s)</span>`;
    sheetEl.appendChild(groundHeader);

    GROUNDS.forEach((gnd) => {
      const row = document.createElement('div');
      row.className = 'marker-row';
      row.tabIndex = 0;
      row.dataset.groundId = gnd.id;
      row.innerHTML = `
        <span class="marker-dot" style="background:${GROUND_COLOR}"></span>
        <span class="marker-text">
          <div class="marker-name">${gnd.name}</div>
          <div class="marker-abbr">GND</div>
        </span>
      `;
      row.addEventListener('click', () => onGroundRowClick(gnd.id));
      row.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onGroundRowClick(gnd.id); } });
      sheetEl.appendChild(row);
    });
  }
}

function onSiteRowClick(id) {
  const site = SITES.find((s) => s.id === id);
  if (!site || !site.a || !site.b) return;
  focusOnPoint(midpointOf(site.a, site.b));
  showSiteInfoCard(id);
}
function onGroundRowClick(id) {
  const gnd = GROUNDS.find((g) => g.id === id);
  if (!gnd || !gnd.position) return;
  focusOnPoint(gnd.position);
  showGroundInfoCard(id);
}

/* ======================================================================
   MARKERS
====================================================================== */
function makeElectrodePad(studColor, width, depth) {
  const group = new THREE.Group();

  const pad = new THREE.Mesh(
    new THREE.BoxGeometry(width, PAD_THICKNESS_M, depth),
    new THREE.MeshPhysicalMaterial({ color: new THREE.Color(PAD_COLOR), roughness: 0.85, clearcoat: 0.04 })
  );
  pad.position.y = PAD_THICKNESS_M / 2;
  group.add(pad);

  const rim = new THREE.Mesh(
    new THREE.BoxGeometry(width * 1.06, PAD_THICKNESS_M * 0.55, depth * 1.06),
    new THREE.MeshPhysicalMaterial({ color: new THREE.Color(PAD_EDGE_COLOR), roughness: 0.9 })
  );
  rim.position.y = PAD_THICKNESS_M * 0.28;
  group.add(rim);

  const stud = new THREE.Mesh(
    new THREE.CylinderGeometry(STUD_RADIUS_M, STUD_RADIUS_M * 1.15, STUD_HEIGHT_M, 16),
    new THREE.MeshStandardMaterial({ color: new THREE.Color(studColor), roughness: 0.25, metalness: 0.85 })
  );
  stud.position.y = PAD_THICKNESS_M + STUD_HEIGHT_M / 2;
  group.add(stud);

  const cap = new THREE.Mesh(
    new THREE.SphereGeometry(STUD_RADIUS_M * 0.9, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: new THREE.Color(studColor), roughness: 0.18, metalness: 0.9 })
  );
  cap.position.y = PAD_THICKNESS_M + STUD_HEIGHT_M;
  group.add(cap);

  group.userData.labelHeight = PAD_THICKNESS_M + STUD_HEIGHT_M + STUD_RADIUS_M * 0.9 + 0.006;
  return group;
}

function orientToSurface(group, point, normal) {
  group.position.copy(point).addScaledVector(normal, 0.0003);
  group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal);
}

function makeLabel(text) {
  const div = document.createElement('div');
  div.className = 'marker-label';
  div.textContent = text;
  const obj = new CSS2DObject(div);
  obj.visible = state.labelsOn;
  return obj;
}
function makeConnector(pA, pB, color) {
  const dir = new THREE.Vector3().subVectors(pB, pA);
  const length = dir.length();
  const geo = new THREE.CylinderGeometry(CONNECTOR_RADIUS_M, CONNECTOR_RADIUS_M, length, 8);
  const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(color) });
  const mesh = new THREE.Mesh(geo, mat);
  const mid = new THREE.Vector3().addVectors(pA, pB).multiplyScalar(0.5);
  mesh.position.copy(mid);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
  return mesh;
}

function normalFromStored(p) {
  return (p && p.nx !== undefined) ? new THREE.Vector3(p.nx, p.ny, p.nz) : new THREE.Vector3(0, 1, 0);
}

function placeSiteElectrode(id, part, point, normal) {
  const site = SITES.find((s) => s.id === id);
  if (!site) return;
  let m = siteMarkers[id];
  if (!m) { m = {}; siteMarkers[id] = m; }

  const group = makeElectrodePad(BIPOLAR_COLOR, PAD_WIDTH_M, PAD_DEPTH_M);
  orientToSurface(group, point, normal);
  group.userData = { kind: 'site', id };
  group.traverse((child) => { if (child.isMesh) child.userData = group.userData; });
  const label = makeLabel(`${site.abbr}-${part.toUpperCase()}`);
  label.position.set(0, group.userData.labelHeight, 0);
  group.add(label);
  markersGroup.add(group);

  if (part === 'a') { m.padA = group; m.labelA = label; } else { m.padB = group; m.labelB = label; }

  if (m.padA && m.padB) {
    if (m.connector) markersGroup.remove(m.connector);
    m.connector = makeConnector(m.padA.position, m.padB.position, BIPOLAR_COLOR);
    markersGroup.add(m.connector);
  }
}

function placeGround(id, point, normal) {
  const gnd = GROUNDS.find((g) => g.id === id);
  if (!gnd) return;
  const group = makeElectrodePad(GROUND_COLOR, GROUND_PAD_WIDTH_M, GROUND_PAD_DEPTH_M);
  orientToSurface(group, point, normal);
  group.userData = { kind: 'ground', id };
  group.traverse((child) => { if (child.isMesh) child.userData = group.userData; });
  const label = makeLabel(`${gnd.name} (GND)`);
  label.position.set(0, group.userData.labelHeight, 0);
  group.add(label);
  markersGroup.add(group);
  groundMarkers[id] = { mesh: group, label };
}

/* ======================================================================
   RAYCAST — click a marker to focus + show info
====================================================================== */
const raycaster = new THREE.Raycaster();
const pointerNDC = new THREE.Vector2();
let downPos = null;
let downTime = 0;

labelRenderer.domElement.addEventListener('pointerdown', (e) => {
  downPos = { x: e.clientX, y: e.clientY };
  downTime = performance.now();
});

labelRenderer.domElement.addEventListener('pointerup', (e) => {
  if (!downPos) return;
  const dx = e.clientX - downPos.x;
  const dy = e.clientY - downPos.y;
  const moved = Math.sqrt(dx * dx + dy * dy);
  const elapsed = performance.now() - downTime;
  downPos = null;
  if (moved > 6 || elapsed > 500) return;

  const rect = canvasHost.getBoundingClientRect();
  pointerNDC.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  pointerNDC.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointerNDC, camera);

  const hits = raycaster.intersectObjects(markersGroup.children, true);
  if (hits.length) {
    const ud = hits[0].object.userData;
    if (!ud) return;
    if (ud.kind === 'site') onSiteRowClick(ud.id);
    else if (ud.kind === 'ground') onGroundRowClick(ud.id);
  }
});

/* ======================================================================
   CAMERA FOCUS + INFO CARD
====================================================================== */
function midpointOf(a, b) { return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 }; }
function focusOnPoint(p) {
  const worldPos = new THREE.Vector3(p.x, p.y, p.z);
  flyTarget = worldPos.clone();
  const dir = camera.position.clone().sub(controls.target).normalize();
  flyPos = worldPos.clone().add(dir.multiplyScalar(0.22));
}

const infoCard = document.getElementById('info-card');
function showSiteInfoCard(id) {
  const site = SITES.find((s) => s.id === id);
  if (!site) return;
  const distMm = site.a && site.b ? Math.hypot(site.a.x - site.b.x, site.a.y - site.b.y, site.a.z - site.b.z) * 1000 : null;
  document.getElementById('info-region').textContent = 'Bipolar EMG site';
  document.getElementById('info-region').style.color = BIPOLAR_COLOR;
  document.getElementById('info-name').textContent = `${site.name} (${site.abbr})`;
  document.getElementById('info-desc').textContent = site.desc || '';
  document.getElementById('info-coords').textContent = distMm !== null ? `Inter-electrode distance: ${distMm.toFixed(1)} mm` : '';
  infoCard.classList.add('visible');
}
function showGroundInfoCard(id) {
  const gnd = GROUNDS.find((g) => g.id === id);
  if (!gnd) return;
  document.getElementById('info-region').textContent = 'Ground electrode';
  document.getElementById('info-region').style.color = GROUND_COLOR;
  document.getElementById('info-name').textContent = gnd.name;
  document.getElementById('info-desc').textContent = gnd.desc || '';
  document.getElementById('info-coords').textContent = '';
  infoCard.classList.add('visible');
}
document.getElementById('info-close').addEventListener('click', () => infoCard.classList.remove('visible'));

/* ======================================================================
   LABELS TOGGLE
====================================================================== */
document.getElementById('labels-toggle').addEventListener('change', (e) => {
  state.labelsOn = e.target.checked;
  Object.values(siteMarkers).forEach((m) => {
    if (m.labelA) m.labelA.visible = state.labelsOn;
    if (m.labelB) m.labelB.visible = state.labelsOn;
  });
  Object.values(groundMarkers).forEach((m) => { m.label.visible = state.labelsOn; });
});

/* ======================================================================
   MOBILE SIDEBAR TOGGLE
====================================================================== */
const sidebar = document.getElementById('sidebar');
document.getElementById('sidebar-toggle-mobile').addEventListener('click', () => sidebar.classList.toggle('open'));

/* ======================================================================
   BOOT
====================================================================== */
loadModel();
