const socket = io();

// ══════════════════════════════════════════════════════════
//  CONFIG
// ══════════════════════════════════════════════════════════
const WALK_SPEED    = 0.26;
const CRAWL_SPEED   = 0.09;
const JUMP_FORCE    = 0.42;
const GRAVITY       = 0.022;
const CAM_DIST_MIN  = 6;
const CAM_DIST_MAX  = 50;
const CAM_SMOOTH    = 0.28;
const MOUSE_SENS    = 0.006;
const PLAYER_HEIGHT = 5.6;
const GROUND_Y      = 0.75;

// Tight world bounds — just outside the actual platform edges
const WORLD_BOUNDS  = { minX: -57, maxX: 57, minZ: -27, maxZ: 67 };

// ══════════════════════════════════════════════════════════
//  STATE
// ══════════════════════════════════════════════════════════
let myId       = null;
let myName     = 'Player';
let myColor    = '#3498db';
let playersMap = {};
let keys       = {};
let lastGS     = null;
let gameStarted = false;

let me = {
    x: 0, y: GROUND_Y, z: 50,
    vx: 0, vy: 0, vz: 0,
    yaw: 0, pitch: 0.5,
    camDist: 20,
    hp: 100,
    inGame: false,
    crawling: false,
    onGround: false
};

let camPos  = { x: 0, y: 14, z: 70 };
let camLook = { x: 0, y: 4, z: 50 };

let isRightDown = false;
let feedbackTimer = 0;

// ══════════════════════════════════════════════════════════
//  USERNAME ENTRY
// ══════════════════════════════════════════════════════════
const nameScreen = document.getElementById('nameScreen');
const nameInput  = document.getElementById('nameInput');
const playBtn    = document.getElementById('playBtn');
const uiEl       = document.getElementById('ui');

function startGame() {
    let name = nameInput.value.trim().substring(0, 16);
    if (!name) name = 'Player' + Math.floor(Math.random() * 999);
    myName = name;
    socket.emit('setName', myName);
    nameScreen.style.display = 'none';
    uiEl.style.display = 'block';
    gameStarted = true;
}

playBtn.addEventListener('click', startGame);
nameInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') startGame();
});
nameInput.focus();

// ══════════════════════════════════════════════════════════
//  THREE.JS SETUP
// ══════════════════════════════════════════════════════════
const scene    = new THREE.Scene();
scene.background = new THREE.Color(0x06070f);
scene.fog = new THREE.FogExp2(0x06070f, 0.0015);

const camera   = new THREE.PerspectiveCamera(65, innerWidth / innerHeight, 0.1, 600);
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.2;
renderer.outputEncoding = THREE.sRGBEncoding;
document.body.appendChild(renderer.domElement);

window.addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
});

// ══════════════════════════════════════════════════════════
//  LIGHTING
// ══════════════════════════════════════════════════════════
const ambient = new THREE.AmbientLight(0x445577, 0.32);
scene.add(ambient);

const sun = new THREE.DirectionalLight(0xb8c6ff, 0.95);
sun.position.set(40, 80, 30);
sun.castShadow = true;
sun.shadow.mapSize.width = 4096;
sun.shadow.mapSize.height = 4096;
sun.shadow.camera.left = -80; sun.shadow.camera.right = 80;
sun.shadow.camera.top = 80; sun.shadow.camera.bottom = -80;
sun.shadow.camera.near = 1; sun.shadow.camera.far = 200;
sun.shadow.bias = -0.001;
scene.add(sun);

scene.add(new THREE.DirectionalLight(0x66aaff, 0.22).translateX(-30).translateY(20).translateZ(-20));
scene.add(new THREE.HemisphereLight(0x5566bb, 0x1a1a2e, 0.35));

const pointYes = new THREE.PointLight(0x00ff88, 0.6, 60);
pointYes.position.set(-35, 12, 0);
scene.add(pointYes);

const pointNo = new THREE.PointLight(0xff4444, 0.6, 60);
pointNo.position.set(35, 12, 0);
scene.add(pointNo);

// ══════════════════════════════════════════════════════════
//  PLATFORMS
// ══════════════════════════════════════════════════════════
function makePlatform(color, x, z, w, d, emissive) {
    const geo = new THREE.BoxGeometry(w, 1.5, d);
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.1, emissive: emissive || 0x000000, emissiveIntensity: 0.15 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, 0, z);
    mesh.receiveShadow = true;
    return mesh;
}

const pYes   = makePlatform(0x27ae60, -35, 0, 40, 50, 0x115522);
const pNo    = makePlatform(0xc0392b,  35, 0, 40, 50, 0x551111);
const pLobby = makePlatform(0x1a5276,   0, 50, 30, 30, 0x0d2942);
scene.add(pYes, pNo, pLobby);

// Edge trims
function makeTrim(x, z, w, d, color) {
    const geo = new THREE.BoxGeometry(w + 0.6, 0.2, d + 0.6);
    const mat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.8, roughness: 0.2, metalness: 0.8 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, 0.76, z);
    return mesh;
}
scene.add(makeTrim(-35, 0, 40, 50, 0x2ecc71));
scene.add(makeTrim( 35, 0, 40, 50, 0xe74c3c));
scene.add(makeTrim(  0, 50, 30, 30, 0x3498db));

// ══════════════════════════════════════════════════════════
//  METAL DIVIDER
// ══════════════════════════════════════════════════════════
const dividerGeo = new THREE.BoxGeometry(3, 10, 50);
const dividerMat = new THREE.MeshStandardMaterial({ color: 0x7f8c8d, roughness: 0.15, metalness: 0.95 });
const divider = new THREE.Mesh(dividerGeo, dividerMat);
divider.position.set(0, 5, 0);
divider.castShadow = true; divider.receiveShadow = true;
scene.add(divider);

for (let i = -20; i <= 20; i += 10) {
    const strip = new THREE.Mesh(
        new THREE.BoxGeometry(3.1, 0.3, 1),
        new THREE.MeshStandardMaterial({ color: 0xf39c12, emissive: 0xf39c12, emissiveIntensity: 0.5, roughness: 0.3, metalness: 0.9 })
    );
    strip.position.set(0, 8, i);
    scene.add(strip);
}

// ══════════════════════════════════════════════════════════
//  WALKWAY (lobby → arena)
// ══════════════════════════════════════════════════════════
const walkway = new THREE.Mesh(
    new THREE.BoxGeometry(12, 1.5, 12),
    new THREE.MeshStandardMaterial({ color: 0x34495e, roughness: 0.5, metalness: 0.3 })
);
walkway.position.set(0, 0, 32);
walkway.receiveShadow = true;
scene.add(walkway);

// ══════════════════════════════════════════════════════════
//  3D LABELS
// ══════════════════════════════════════════════════════════
function makeLabel(text, color, x, z) {
    const c = document.createElement('canvas');
    c.width = 512; c.height = 128;
    const ctx = c.getContext('2d');
    ctx.fillStyle = color;
    ctx.font = 'bold 100px Arial';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 8;
    ctx.fillText(text, 256, 64);
    const tex = new THREE.CanvasTexture(c);
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, side: THREE.DoubleSide });
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(20, 5), mat);
    plane.position.set(x, 14, z);
    return plane;
}
const lblYes   = makeLabel('YES', '#2ecc71', -35, 0);
const lblNo    = makeLabel('NO',  '#e74c3c',  35, 0);
const lblLobby = makeLabel('LOBBY', '#3498db', 0, 50);
scene.add(lblYes, lblNo, lblLobby);

// ══════════════════════════════════════════════════════════
//  VOID FLOOR + SPACE SKY
// ══════════════════════════════════════════════════════════
const voidPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(600, 600),
    new THREE.MeshStandardMaterial({ color: 0x0a0a1a, roughness: 1 })
);
voidPlane.rotation.x = -Math.PI / 2;
voidPlane.position.y = -60;
scene.add(voidPlane);

const sky = new THREE.Mesh(
    new THREE.SphereGeometry(300, 40, 40),
    new THREE.MeshBasicMaterial({ color: 0x05060d, side: THREE.BackSide })
);
scene.add(sky);

// Stars
const starGeo = new THREE.BufferGeometry();
const starPos = new Float32Array(4000 * 3);
for (let i = 0; i < 4000; i++) {
    const r = 220 + Math.random() * 70;
    const t = Math.random() * Math.PI * 2;
    const p = Math.acos(2 * Math.random() - 1);
    starPos[i*3] = r * Math.sin(p) * Math.cos(t);
    starPos[i*3+1] = r * Math.cos(p);
    starPos[i*3+2] = r * Math.sin(p) * Math.sin(t);
}
starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.9, sizeAttenuation: true })));

// Nebulae
const nebulaColors = [0x2b2f66, 0x3a1f5f, 0x193b5a, 0x4a2058];
for (let i = 0; i < 8; i++) {
    const n = new THREE.Mesh(
        new THREE.SphereGeometry(22 + Math.random() * 18, 16, 16),
        new THREE.MeshBasicMaterial({ color: nebulaColors[i % 4], transparent: true, opacity: 0.13, side: THREE.DoubleSide })
    );
    n.position.set((Math.random()-0.5)*280, 30+Math.random()*120, (Math.random()-0.5)*280);
    scene.add(n);
}

// ══════════════════════════════════════════════════════════
//  REAL INVISIBLE WALLS — collision-based, not just meshes
//  We enforce these in the physics/clamp step
// ══════════════════════════════════════════════════════════
// The actual wall blocking is done in clampToWorld() and
// getGroundHeight(). The visual wall meshes below are purely
// decorative semi-transparent barriers so players see edges.

function makeWallVisual(x, y, z, w, h, d, color) {
    const wall = new THREE.Mesh(
        new THREE.BoxGeometry(w, h, d),
        new THREE.MeshStandardMaterial({
            color, transparent: true, opacity: 0.08,
            emissive: color, emissiveIntensity: 0.15,
            roughness: 0.4, metalness: 0.6, side: THREE.DoubleSide
        })
    );
    wall.position.set(x, y, z);
    scene.add(wall);
    return wall;
}

// Arena boundary walls (YES platform: x -55 to -15, z -25 to 25)
// Left wall of YES platform
makeWallVisual(-55, 5, 0, 0.3, 12, 50, 0x2ecc71);
// Back wall YES
makeWallVisual(-35, 5, -25, 40, 12, 0.3, 0x2ecc71);
// Front wall YES
makeWallVisual(-35, 5, 25, 40, 12, 0.3, 0x2ecc71);

// Right wall of NO platform
makeWallVisual(55, 5, 0, 0.3, 12, 50, 0xe74c3c);
// Back wall NO
makeWallVisual(35, 5, -25, 40, 12, 0.3, 0xe74c3c);
// Front wall NO
makeWallVisual(35, 5, 25, 40, 12, 0.3, 0xe74c3c);

// Lobby walls
makeWallVisual(-15, 5, 50, 0.3, 12, 30, 0x3498db);
makeWallVisual( 15, 5, 50, 0.3, 12, 30, 0x3498db);
makeWallVisual(0, 5, 65, 30, 12, 0.3, 0x3498db);

// Walkway side rails (thin glow strips)
makeWallVisual(-6, 2, 32, 0.2, 3, 12, 0x5dade2);
makeWallVisual( 6, 2, 32, 0.2, 3, 12, 0x5dade2);

// ══════════════════════════════════════════════════════════
//  LOBBY DECORATION — make it look inviting
// ══════════════════════════════════════════════════════════
// Glowing ring
const lobbyRing = new THREE.Mesh(
    new THREE.TorusGeometry(12, 0.5, 16, 80),
    new THREE.MeshStandardMaterial({ color: 0x7dd3ff, emissive: 0x2a9dff, emissiveIntensity: 0.7, metalness: 0.7, roughness: 0.2 })
);
lobbyRing.position.set(0, 2, 50);
lobbyRing.rotation.x = Math.PI / 2;
scene.add(lobbyRing);

// Lobby spotlight
const lobbySpot = new THREE.PointLight(0x5dade2, 1.2, 40, 2);
lobbySpot.position.set(0, 15, 50);
scene.add(lobbySpot);

// Central pedestal
const pedestal = new THREE.Mesh(
    new THREE.CylinderGeometry(2, 2.5, 2, 16),
    new THREE.MeshStandardMaterial({ color: 0x2c3e50, roughness: 0.3, metalness: 0.7, emissive: 0x1a252f, emissiveIntensity: 0.3 })
);
pedestal.position.set(0, 1.75, 50);
pedestal.castShadow = true;
scene.add(pedestal);

// Floating question icon on pedestal
const qMark = new THREE.Mesh(
    new THREE.SphereGeometry(1.2, 16, 16),
    new THREE.MeshStandardMaterial({ color: 0xf1c40f, emissive: 0xf39c12, emissiveIntensity: 0.6, roughness: 0.1, metalness: 0.9 })
);
qMark.position.set(0, 5, 50);
scene.add(qMark);

// Lobby corner lamps
function makeLamp(x, z) {
    const pole = new THREE.Mesh(
        new THREE.CylinderGeometry(0.15, 0.15, 6, 8),
        new THREE.MeshStandardMaterial({ color: 0x5d6d7e, roughness: 0.3, metalness: 0.8 })
    );
    pole.position.set(x, 3.75, z);
    scene.add(pole);
    const bulb = new THREE.Mesh(
        new THREE.SphereGeometry(0.5, 8, 8),
        new THREE.MeshStandardMaterial({ color: 0xffeaa7, emissive: 0xffeaa7, emissiveIntensity: 0.9 })
    );
    bulb.position.set(x, 7, z);
    scene.add(bulb);
    const light = new THREE.PointLight(0xffeaa7, 0.4, 18, 2);
    light.position.set(x, 7, z);
    scene.add(light);
}
makeLamp(-13, 37); makeLamp(13, 37);
makeLamp(-13, 63); makeLamp(13, 63);

// Lobby floor pattern (checkerboard tiles)
for (let ix = -2; ix <= 2; ix++) {
    for (let iz = -2; iz <= 2; iz++) {
        if ((ix + iz) % 2 !== 0) continue;
        const tile = new THREE.Mesh(
            new THREE.BoxGeometry(5.8, 0.05, 5.8),
            new THREE.MeshStandardMaterial({ color: 0x1c3a56, roughness: 0.4, metalness: 0.3, emissive: 0x0e2233, emissiveIntensity: 0.2 })
        );
        tile.position.set(ix * 6, 0.78, 50 + iz * 6);
        scene.add(tile);
    }
}

// Lobby welcome arch
const archGeo = new THREE.TorusGeometry(8, 0.4, 8, 32, Math.PI);
const archMat = new THREE.MeshStandardMaterial({ color: 0xd4ac0d, emissive: 0xd4ac0d, emissiveIntensity: 0.3, roughness: 0.2, metalness: 0.9 });
const arch = new THREE.Mesh(archGeo, archMat);
arch.position.set(0, 8, 35.5);
arch.rotation.z = Math.PI;
scene.add(arch);

// ── Decorative pillars on arena platforms ────────────────
function makePillar(x, z, h, color) {
    const geo = new THREE.CylinderGeometry(0.6, 0.8, h, 8);
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.25, metalness: 0.6 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, h/2, z); mesh.castShadow = true;
    const top = new THREE.Mesh(new THREE.SphereGeometry(0.9,8,8), new THREE.MeshStandardMaterial({ color: 0xf1c40f, roughness: 0.2, metalness: 0.8 }));
    top.position.y = h/2;
    mesh.add(top);
    return mesh;
}
scene.add(makePillar(-55,-25,10,0x229955)); scene.add(makePillar(-55,25,10,0x229955));
scene.add(makePillar(-15,-25,10,0x229955)); scene.add(makePillar(-15,25,10,0x229955));
scene.add(makePillar(15,-25,10,0x993322));  scene.add(makePillar(15,25,10,0x993322));
scene.add(makePillar(55,-25,10,0x993322));  scene.add(makePillar(55,25,10,0x993322));

// ══════════════════════════════════════════════════════════
//  ANSWER INDICATOR
// ══════════════════════════════════════════════════════════
const indicatorGeo = new THREE.BoxGeometry(3, 6, 6);
const indicatorMat = new THREE.MeshStandardMaterial({ color: 0xf39c12, roughness: 0.2, metalness: 0.9, emissive: 0xf39c12, emissiveIntensity: 0.3 });
const indicator = new THREE.Mesh(indicatorGeo, indicatorMat);
indicator.position.set(0, -10, 0);
scene.add(indicator);

let indicatorLabel = null;
function updateIndicatorLabel(text, color) {
    if (indicatorLabel) scene.remove(indicatorLabel);
    indicatorLabel = makeLabel(text, color, 0, 0);
    indicatorLabel.position.set(0, 15, 0);
    indicatorLabel.visible = false;
    scene.add(indicatorLabel);
}
updateIndicatorLabel('?', '#ffffff');
let indicatorTargetY = -10;

// ══════════════════════════════════════════════════════════
//  PLAYER MODEL
// ══════════════════════════════════════════════════════════
function createPlayerModel(color) {
    const group = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.1 });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x2c3e50, roughness: 0.6, metalness: 0.1 });

    const body = new THREE.Mesh(new THREE.BoxGeometry(2, 2.5, 1.2), bodyMat);
    body.position.y = 2.75; body.castShadow = true;
    group.add(body);

    const head = new THREE.Mesh(new THREE.BoxGeometry(1.7, 1.7, 1.7), bodyMat.clone());
    head.position.y = 4.85; head.castShadow = true;
    group.add(head);

    // Eyes
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0x111111 });
    const eyeL = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.25, 0.05), eyeMat);
    eyeL.position.set(-0.35, 4.95, 0.88); group.add(eyeL);
    const eyeR = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.25, 0.05), eyeMat);
    eyeR.position.set(0.35, 4.95, 0.88); group.add(eyeR);

    const smile = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.12, 0.05), eyeMat);
    smile.position.set(0, 4.55, 0.88); group.add(smile);

    const armGeo = new THREE.BoxGeometry(0.7, 2.4, 0.7);
    const armL = new THREE.Mesh(armGeo, bodyMat.clone());
    armL.position.set(-1.35, 2.8, 0); armL.castShadow = true; group.add(armL);
    const armR = new THREE.Mesh(armGeo, bodyMat.clone());
    armR.position.set(1.35, 2.8, 0); armR.castShadow = true; group.add(armR);

    const legGeo = new THREE.BoxGeometry(0.85, 1.5, 0.85);
    const legL = new THREE.Mesh(legGeo, darkMat);
    legL.position.set(-0.5, 0.75, 0); legL.castShadow = true; group.add(legL);
    const legR = new THREE.Mesh(legGeo, darkMat.clone());
    legR.position.set(0.5, 0.75, 0); legR.castShadow = true; group.add(legR);

    return { group, body, head, armL, armR, legL, legR };
}

// Name tag above other players
function createNameTag(name, color) {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 48;
    const ctx = c.getContext('2d');
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.beginPath();
    ctx.roundRect(4, 4, 248, 40, 8);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.font = 'bold 22px Inter, Arial';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(name.substring(0, 16), 128, 24);
    const tex = new THREE.CanvasTexture(c);
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(4, 0.8, 1);
    sprite.position.y = 6.8;
    return sprite;
}

let localModel = null;

// ══════════════════════════════════════════════════════════
//  INPUT
// ══════════════════════════════════════════════════════════
window.addEventListener('keydown', e => {
    if (!gameStarted) return;
    keys[e.code] = true;
    if (e.code === 'Space') e.preventDefault();
});
window.addEventListener('keyup', e => keys[e.code] = false);

window.addEventListener('mousedown', e => { if (e.button === 2) isRightDown = true; });
window.addEventListener('mouseup', e => { if (e.button === 2) isRightDown = false; });
window.addEventListener('contextmenu', e => e.preventDefault());

window.addEventListener('mousemove', e => {
    if (!isRightDown || !gameStarted) return;
    me.yaw -= e.movementX * MOUSE_SENS;
    me.pitch = Math.max(-0.2, Math.min(1.3, me.pitch + e.movementY * MOUSE_SENS));
});

window.addEventListener('wheel', e => {
    if (!gameStarted) return;
    me.camDist += e.deltaY * 0.03;
    me.camDist = Math.max(CAM_DIST_MIN, Math.min(CAM_DIST_MAX, me.camDist));
});

// ══════════════════════════════════════════════════════════
//  COLLISION
// ══════════════════════════════════════════════════════════
// Platforms that you can stand on
function isOnPlatform(x, z) {
    // YES platform
    if (x >= -55 && x <= -15 && z >= -25 && z <= 25) return true;
    // NO platform
    if (x >= 15 && x <= 55 && z >= -25 && z <= 25) return true;
    // LOBBY platform
    if (x >= -15 && x <= 15 && z >= 35 && z <= 65) return true;
    // Walkway
    if (x >= -6 && x <= 6 && z >= 26 && z <= 38) return true;
    return false;
}

function getGroundHeight(x, z) {
    // Divider top surface
    if (x >= -1.5 && x <= 1.5 && z >= -25 && z <= 25) return 10.75;
    // Any platform or walkway
    if (isOnPlatform(x, z)) return GROUND_Y;
    // Void — return a low value (they'll fall)
    return -100;
}

// Clamp player to stay on walkable surfaces (the real invisible walls)
function clampToPlayArea(pos) {
    // Define all walkable rectangular regions
    const regions = [
        { xMin: -55, xMax: -15, zMin: -25, zMax: 25 },   // YES
        { xMin:  15, xMax:  55, zMin: -25, zMax: 25 },   // NO
        { xMin: -15, xMax:  15, zMin:  35, zMax: 65 },   // LOBBY
        { xMin:  -6, xMax:   6, zMin:  26, zMax: 38 },   // WALKWAY
        { xMin: -1.5, xMax: 1.5, zMin: -25, zMax: 25 },  // DIVIDER TOP
    ];

    // Check if already in a valid region
    for (const r of regions) {
        if (pos.x >= r.xMin && pos.x <= r.xMax && pos.z >= r.zMin && pos.z <= r.zMax) {
            return; // Already valid
        }
    }

    // Not in any region — find the closest edge of the closest region and push back
    let bestDist = Infinity;
    let bestX = pos.x, bestZ = pos.z;

    for (const r of regions) {
        const cx = Math.max(r.xMin, Math.min(r.xMax, pos.x));
        const cz = Math.max(r.zMin, Math.min(r.zMax, pos.z));
        const dx = pos.x - cx;
        const dz = pos.z - cz;
        const dist = dx * dx + dz * dz;
        if (dist < bestDist) {
            bestDist = dist;
            bestX = cx;
            bestZ = cz;
        }
    }

    pos.x = bestX;
    pos.z = bestZ;
}

// Block walking through the metal divider
function collideDivider(x, z, oldX) {
    if (z >= -25 && z <= 25 && me.y < 10) {
        if (x > -1.5 && x < 1.5) {
            if (oldX <= -1.5) return -1.6;
            if (oldX >= 1.5) return 1.6;
            return oldX;
        }
    }
    return x;
}

// ══════════════════════════════════════════════════════════
//  MAIN LOOP
// ══════════════════════════════════════════════════════════
let lastTime = performance.now();
let walkCycle = 0;
let lobbyBobTime = 0;

function update(dt) {
    if (!myId || !gameStarted) return;
    const s = Math.min(dt / 16.67, 2.5);

    const alive = me.hp > 0;
    const speed = me.crawling ? CRAWL_SPEED : WALK_SPEED;

    if (alive) {
        let inputX = 0, inputZ = 0;
        if (keys['KeyW'] || keys['ArrowUp'])    { inputX -= Math.sin(me.yaw); inputZ -= Math.cos(me.yaw); }
        if (keys['KeyS'] || keys['ArrowDown'])   { inputX += Math.sin(me.yaw); inputZ += Math.cos(me.yaw); }
        if (keys['KeyA'] || keys['ArrowLeft'])    { inputX -= Math.cos(me.yaw); inputZ += Math.sin(me.yaw); }
        if (keys['KeyD'] || keys['ArrowRight'])   { inputX += Math.cos(me.yaw); inputZ -= Math.sin(me.yaw); }

        const len = Math.sqrt(inputX * inputX + inputZ * inputZ);
        if (len > 0) { inputX /= len; inputZ /= len; }
        const moving = len > 0;

        const targetVX = inputX * speed;
        const targetVZ = inputZ * speed;
        const accelRate = me.onGround ? 0.42 : 0.14;
        me.vx += (targetVX - me.vx) * accelRate * s;
        me.vz += (targetVZ - me.vz) * accelRate * s;

        // Friction when not pressing keys
        if (!moving && me.onGround) {
            me.vx *= 0.82;
            me.vz *= 0.82;
        }

        const oldX = me.x;
        me.x += me.vx * s;
        me.z += me.vz * s;

        // Divider collision
        me.x = collideDivider(me.x, me.z, oldX);

        // REAL INVISIBLE WALLS: clamp to playable surfaces
        clampToPlayArea(me);

        // Character rotation
        if (moving && localModel) {
            const targetRot = Math.atan2(inputX, inputZ);
            let diff = targetRot - localModel.group.rotation.y;
            while (diff > Math.PI) diff -= Math.PI * 2;
            while (diff < -Math.PI) diff += Math.PI * 2;
            localModel.group.rotation.y += diff * 0.2 * s;
        }

        // Walk animation
        if (moving && me.onGround && localModel) {
            walkCycle += dt * (me.crawling ? 0.002 : 0.0035);
            const swing = Math.sin(walkCycle * 3.5) * (me.crawling ? 0.18 : 0.3);
            localModel.armL.rotation.x =  swing;
            localModel.armR.rotation.x = -swing;
            localModel.legL.rotation.x = -swing * 0.7;
            localModel.legR.rotation.x =  swing * 0.7;
        } else if (localModel) {
            localModel.armL.rotation.x *= 0.85;
            localModel.armR.rotation.x *= 0.85;
            localModel.legL.rotation.x *= 0.85;
            localModel.legR.rotation.x *= 0.85;
        }

        // Crawl tilt
        if (localModel) {
            const targetTilt = me.crawling ? 0.5 : 0;
            localModel.body.rotation.x += (targetTilt - localModel.body.rotation.x) * 0.1;
            localModel.head.rotation.x += (targetTilt * 0.3 - localModel.head.rotation.x) * 0.1;
        }

        // Jump
        if (keys['Space'] && me.onGround && !me.crawling) {
            me.vy = JUMP_FORCE;
            me.onGround = false;
        }

        // Gravity
        me.vy -= GRAVITY * s;
        me.y += me.vy * s;

        // Ground collision
        const gh = getGroundHeight(me.x, me.z);
        if (gh < -50) {
            // Over the void — respawn onto nearest platform
            clampToPlayArea(me);
            me.y = GROUND_Y;
            me.vy = 0;
            me.onGround = true;
        } else if (me.y <= gh && me.vy <= 0) {
            me.y = gh;
            me.vy = 0;
            me.onGround = true;
        } else if (me.y > gh + 0.3) {
            me.onGround = false;
        }

        // Absolute floor fail-safe
        if (me.y < GROUND_Y) {
            me.y = GROUND_Y;
            me.vy = 0;
        }

        if (localModel) {
            localModel.group.position.set(me.x, me.y, me.z);
            localModel.group.visible = true;
        }
    } else {
        if (localModel) localModel.group.visible = true;
    }

    // ══ Camera ══
    const lookY = me.y + PLAYER_HEIGHT * 0.55;
    const targetCX = me.x + Math.sin(me.yaw) * Math.cos(me.pitch) * me.camDist;
    const targetCY = lookY + Math.sin(me.pitch) * me.camDist;
    const targetCZ = me.z + Math.cos(me.yaw) * Math.cos(me.pitch) * me.camDist;
    const minCamY = Math.max(3, me.y + 3);

    camPos.x += (targetCX - camPos.x) * CAM_SMOOTH * s;
    camPos.y += (Math.max(targetCY, minCamY) - camPos.y) * CAM_SMOOTH * s;
    camPos.z += (targetCZ - camPos.z) * CAM_SMOOTH * s;

    const lsm = CAM_SMOOTH * 1.8;
    camLook.x += (me.x - camLook.x) * lsm * s;
    camLook.y += (lookY - camLook.y) * lsm * s;
    camLook.z += (me.z - camLook.z) * lsm * s;

    camera.position.set(camPos.x, camPos.y, camPos.z);
    camera.lookAt(camLook.x, camLook.y, camLook.z);

    // ══ Lobby decorations anim ══
    lobbyBobTime += dt * 0.002;
    qMark.position.y = 5 + Math.sin(lobbyBobTime) * 0.8;
    qMark.rotation.y += dt * 0.001;

    // ══ Indicator animation ══
    indicator.position.y += (indicatorTargetY - indicator.position.y) * 0.06;
    if (indicatorLabel) {
        indicatorLabel.position.y = indicator.position.y + 5;
        indicatorLabel.visible = indicator.position.y > 5;
        indicatorLabel.lookAt(camera.position);
    }

    // Labels billboard
    lblYes.lookAt(camera.position);
    lblNo.lookAt(camera.position);
    lblLobby.lookAt(camera.position);

    // ══ Other players ══
    for (let id in playersMap) {
        const pm = playersMap[id];
        if (!pm.targetPos) continue;
        const g = pm.group;
        g.position.x += (pm.targetPos.x - g.position.x) * 0.15;
        g.position.y += (pm.targetPos.y - g.position.y) * 0.15;
        g.position.z += (pm.targetPos.z - g.position.z) * 0.15;
        let diff = pm.targetRy - g.rotation.y;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        g.rotation.y += diff * 0.12;

        if (pm.crawling) {
            pm.body.rotation.x += (0.5 - pm.body.rotation.x) * 0.1;
        } else {
            pm.body.rotation.x *= 0.9;
        }
    }

    // Feedback timer
    if (feedbackTimer > 0) {
        feedbackTimer -= dt;
        if (feedbackTimer <= 0) {
            document.getElementById('feedbackText').style.display = 'none';
        }
    }

    // Send position
    socket.volatile.emit('move', {
        x: me.x, y: me.y, z: me.z,
        ry: localModel ? localModel.group.rotation.y : me.yaw
    });
}

function render(now) {
    requestAnimationFrame(render);
    const dt = Math.min(now - lastTime, 80);
    lastTime = now;
    update(dt);
    renderer.render(scene, camera);
}
requestAnimationFrame(render);

// ══════════════════════════════════════════════════════════
//  PLAYER LIST UI
// ══════════════════════════════════════════════════════════
function updatePlayerList(players, gs) {
    const container = document.getElementById('plEntries');
    if (!container) return;

    const header = document.getElementById('plHeader');
    if (header) header.textContent = `Players (${gs.playerCount})`;

    let html = '';
    const entries = Object.values(players);
    // Sort: alive first, then by HP desc, then by name
    entries.sort((a, b) => {
        if (a.inGame !== b.inGame) return a.inGame ? -1 : 1;
        if (a.hp !== b.hp) return b.hp - a.hp;
        return a.name.localeCompare(b.name);
    });

    for (const p of entries) {
        const isMe = p.id === myId;
        const nameClass = isMe ? 'pl-name is-you' : 'pl-name';
        let badge = '';
        if (p.inGame && p.hp > 0) {
            badge = `<span class="pl-badge badge-alive">${p.hp}%</span>`;
        } else if (p.inGame && p.hp <= 0) {
            badge = '<span class="pl-badge badge-dead">OUT</span>';
        } else {
            badge = '<span class="pl-badge badge-lobby">LOBBY</span>';
        }

        html += `<div class="pl-row">
            <div class="pl-dot" style="background:${p.color};box-shadow:0 0 6px ${p.color}"></div>
            <div class="${nameClass}">${isMe ? '★ ' : ''}${escapeHtml(p.name)}</div>
            ${badge}
        </div>`;
    }
    container.innerHTML = html;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ══════════════════════════════════════════════════════════
//  NETWORKING
// ══════════════════════════════════════════════════════════
socket.on('init', data => {
    myId = data.id;
    myColor = data.color;
    console.log('Joined as', myId);
    localModel = createPlayerModel(myColor);
    localModel.group.position.set(me.x, me.y, me.z);
    scene.add(localModel.group);
});

socket.on('update', data => {
    lastGS = data.gameState;
    const gs = data.gameState;

    // UI
    document.getElementById('timer').innerText = gs.timer;
    document.getElementById('question').innerText = gs.question;
    document.getElementById('playerCount').innerText = `Players: ${gs.playerCount} | Alive: ${gs.aliveCount}`;

    const phaseEl = document.getElementById('phase');
    switch (gs.phase) {
        case 'LOBBY':    phaseEl.innerText = `LOBBY — Match ${gs.match + 1}`; break;
        case 'ROUND':    phaseEl.innerText = `QUESTION ${gs.round} — Pick a side!`; break;
        case 'REVEAL':   phaseEl.innerText = `ANSWER: ${gs.correctAnswer || '...'}`; break;
        case 'BETWEEN':  phaseEl.innerText = `ROUND ${gs.round} — Get ready!`; break;
        case 'GAMEOVER': phaseEl.innerText = `GAME OVER`; break;
    }
    document.getElementById('hud').className = 'hud phase-' + gs.phase.toLowerCase();

    // HP bar
    const hpBar = document.getElementById('hpBar');
    const hpFill = document.getElementById('hpFill');
    const hpText = document.getElementById('hpText');
    if (hpBar && hpFill && hpText) {
        const myData = data.players[myId];
        if (myData) {
            const hp = myData.hp;
            hpFill.style.width = hp + '%';
            hpText.innerText = hp + '%';
            hpBar.style.display = hp < 100 ? 'block' : 'none';
            hpFill.style.background = hp > 60 ? '#2ecc71' : hp > 20 ? '#f39c12' : '#e74c3c';
        }
    }

    // Winner
    const winOverlay = document.getElementById('winOverlay');
    if (gs.phase === 'GAMEOVER' && gs.winner) {
        winOverlay.style.display = 'flex';
        const winText = document.getElementById('winnerText');
        if (gs.winner === myId) {
            winText.innerText = 'YOU WIN!';
        } else {
            winText.innerText = (gs.winnerName || 'Someone') + ' Wins!';
        }
        winText.style.color = gs.winnerColor || '#f1c40f';
    } else {
        winOverlay.style.display = 'none';
    }

    // Indicator
    if (gs.phase === 'REVEAL' && gs.correctAnswer) {
        indicatorTargetY = 12;
        const clr = gs.correctAnswer === 'YES' ? '#2ecc71' : '#e74c3c';
        updateIndicatorLabel(gs.correctAnswer, clr);
        indicatorMat.emissive.set(gs.correctAnswer === 'YES' ? 0x00ff88 : 0xff4444);
    } else {
        indicatorTargetY = -10;
    }

    // Local player state
    if (data.players[myId]) {
        const myData = data.players[myId];
        me.hp = myData.hp;
        me.inGame = myData.inGame;
        me.crawling = myData.crawling;
    }

    // Death overlay
    const deathOverlay = document.getElementById('deathOverlay');
    deathOverlay.style.display = (me.hp <= 0 && !me.inGame) ? 'flex' : 'none';

    // Player list
    updatePlayerList(data.players, gs);

    // Other players
    const serverIds = new Set(Object.keys(data.players));
    for (let id in data.players) {
        if (id === myId) continue;
        const pd = data.players[id];

        if (!playersMap[id]) {
            const model = createPlayerModel(pd.color);
            scene.add(model.group);
            // Name tag
            const tag = createNameTag(pd.name, pd.color);
            model.group.add(tag);
            playersMap[id] = {
                ...model,
                nameTag: tag,
                targetPos: { x: pd.x, y: pd.y, z: pd.z },
                targetRy: pd.ry || 0,
                hp: pd.hp,
                crawling: pd.crawling,
                lastName: pd.name
            };
        }

        // Update name tag if name changed
        if (playersMap[id].lastName !== pd.name) {
            playersMap[id].group.remove(playersMap[id].nameTag);
            const newTag = createNameTag(pd.name, pd.color);
            playersMap[id].group.add(newTag);
            playersMap[id].nameTag = newTag;
            playersMap[id].lastName = pd.name;
        }

        playersMap[id].targetPos = { x: pd.x, y: pd.y, z: pd.z };
        playersMap[id].targetRy = pd.ry || 0;
        playersMap[id].hp = pd.hp;
        playersMap[id].crawling = pd.crawling;
        playersMap[id].group.visible = pd.hp > 0 || !pd.inGame;
    }

    for (let id in playersMap) {
        if (!serverIds.has(id)) {
            scene.remove(playersMap[id].group);
            delete playersMap[id];
        }
    }
});

socket.on('playerLeft', id => {
    if (playersMap[id]) {
        scene.remove(playersMap[id].group);
        delete playersMap[id];
    }
});

socket.on('joinGame', () => {
    me.inGame = true;
    me.hp = 100;
    me.crawling = false;
    document.getElementById('deathOverlay').style.display = 'none';
});

socket.on('toLobby', () => {
    me.inGame = false;
    me.crawling = false;
    me.x = (Math.random() - 0.5) * 20;
    me.y = GROUND_Y;
    me.z = 50 + (Math.random() - 0.5) * 20;
    me.vx = 0; me.vy = 0; me.vz = 0;
    if (localModel) localModel.group.position.set(me.x, me.y, me.z);
});

socket.on('returnToCenter', () => {
    me.x = (Math.random() - 0.5) * 6;
    me.y = GROUND_Y;
    me.z = (Math.random() - 0.5) * 20;
    me.vx = 0; me.vy = 0; me.vz = 0;
    if (localModel) localModel.group.position.set(me.x, me.y, me.z);
});

socket.on('feedback', data => {
    if (data.type === 'WIN') return;
    feedbackTimer = 3000;
    const el = document.getElementById('feedbackText');
    el.innerText = data.msg;
    el.style.display = 'block';
    el.className = 'feedback ft-' + data.type.toLowerCase();
});
