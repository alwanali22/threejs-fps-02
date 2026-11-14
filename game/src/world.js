import * as THREE from 'three';
import { canvas, surface, hairline, ink, muted, accent } from './palette.js';

const teal = '#5fb8a6';
const geometryCache = new Map();

function boxGeometry(x, y, z) {
  const key = `${x.toFixed(3)},${y.toFixed(3)},${z.toFixed(3)}`;
  let geometry = geometryCache.get(key);
  if (!geometry) {
    geometry = new THREE.BoxGeometry(x, y, z);
    geometryCache.set(key, geometry);
  }
  return geometry;
}

export function createWorld(scene) {
  const group = new THREE.Group();
  group.name = 'Kestrel Yard';

  const materials = {
    ground: new THREE.MeshStandardMaterial({ color: surface, roughness: 0.96 }),
    wall: new THREE.MeshStandardMaterial({ color: hairline, roughness: 0.9 }),
    container: new THREE.MeshStandardMaterial({ color: muted, roughness: 0.78 }),
    crate: new THREE.MeshStandardMaterial({ color: surface, roughness: 0.88 }),
    dark: new THREE.MeshStandardMaterial({ color: canvas, roughness: 0.82 }),
    trim: new THREE.MeshStandardMaterial({ color: ink, roughness: 0.72 }),
    accent: new THREE.MeshStandardMaterial({ color: accent, roughness: 0.7 }),
    teal: new THREE.MeshStandardMaterial({ color: teal, roughness: 0.75 }),
    tank: new THREE.MeshStandardMaterial({ color: hairline, metalness: 0.35, roughness: 0.62 }),
    pipe: new THREE.MeshStandardMaterial({ color: muted, metalness: 0.45, roughness: 0.55 })
  };

  const colliders = [];
  const shootables = [];

  function addBox(x, y, z, sx, sy, sz, material, options = {}) {
    const mesh = new THREE.Mesh(boxGeometry(sx, sy, sz), material);
    mesh.position.set(x, y, z);
    mesh.castShadow = options.castShadow !== false;
    mesh.receiveShadow = true;
    mesh.name = options.name || 'yard-solid';
    group.add(mesh);

    const collider = new THREE.Box3(
      new THREE.Vector3(x - sx / 2, y - sy / 2, z - sz / 2),
      new THREE.Vector3(x + sx / 2, y + sy / 2, z + sz / 2)
    );
    colliders.push(collider);
    shootables.push(mesh);
    return mesh;
  }

  function addCrate(x, z, sx = 1, sz = 1, sy = 0.95, striped = false) {
    addBox(x, sy / 2, z, sx, sy, sz, materials.crate, { name: 'cargo-crate' });
    if (striped) {
      addBox(x, sy + 0.025, z, sx + 0.025, 0.05, sz + 0.025, materials.accent, {
        name: 'crate-stripe',
        castShadow: false
      });
    }
  }

  function addContainer(x, z, sx = 6.2, sz = 2.35, sy = 2.6, material = materials.container) {
    addBox(x, sy / 2, z, sx, sy, sz, material, { name: 'cargo-container' });
    const ribCount = Math.max(3, Math.floor(sx / 1.35));
    for (let i = 0; i < ribCount; i += 1) {
      const rx = x - sx / 2 + 0.35 + (sx - 0.7) * i / (ribCount - 1);
      addBox(rx, sy / 2, z - sz / 2 - 0.018, 0.075, sy - 0.12, 0.045, materials.hairline, {
        name: 'container-rib',
        castShadow: false
      });
    }
  }

  function addCylinder(x, y, z, radius, length, material, axis = 'x') {
    const geometry = new THREE.CylinderGeometry(radius, radius, length, 16, 1);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    if (axis === 'x') mesh.rotation.z = Math.PI / 2;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = 'fuel-yard-metal';
    group.add(mesh);
    const halfX = axis === 'x' ? length / 2 : radius;
    const halfZ = axis === 'z' ? length / 2 : radius;
    colliders.push(new THREE.Box3(
      new THREE.Vector3(x - halfX, y - radius, z - halfZ),
      new THREE.Vector3(x + halfX, y + radius, z + halfZ)
    ));
    shootables.push(mesh);
    return mesh;
  }

  const ground = new THREE.Mesh(boxGeometry(56, 0.2, 40), materials.ground);
  ground.position.set(0, -0.12, 0);
  ground.receiveShadow = true;
  ground.name = 'yard-ground';
  group.add(ground);

  // The segmented perimeter leaves the east and west lanes open to the playable yard.
  addBox(0, 2.5, -20, 56, 5, 0.7, materials.wall, { name: 'north-perimeter' });
  addBox(0, 2.5, 20, 56, 5, 0.7, materials.wall, { name: 'south-perimeter' });
  addBox(-28, 2.5, 0, 0.7, 5, 40, materials.wall, { name: 'west-perimeter' });
  addBox(28, 2.5, 0, 0.7, 5, 40, materials.wall, { name: 'east-perimeter' });

  // Hangar shell: open front and floor keep the northern site traversable.
  addBox(0, 5.1, -16.1, 12.8, 0.55, 7.4, materials.dark, { name: 'hangar-roof' });
  addBox(0, 2.5, -19.55, 12.8, 5, 0.45, materials.wall, { name: 'hangar-back' });
  addBox(-6.2, 2.5, -15.8, 0.55, 5, 7.4, materials.wall, { name: 'hangar-side' });
  addBox(6.2, 2.5, -15.8, 0.55, 5, 7.4, materials.wall, { name: 'hangar-side' });
  for (const x of [-4.2, 0, 4.2]) {
    addBox(x, 2.45, -12.2, 0.38, 4.9, 0.38, materials.trim, { name: 'hangar-pillar' });
  }
  addCrate(-3.8, -17.3, 1.5, 1.1, 1.2);
  addCrate(3.5, -17.5, 1.3, 1.2, 1.05, true);
  addCrate(0, -18.45, 1.2, 0.75, 0.9);

  // Two container rows pinch the center lane but leave a wide double-door opening.
  addContainer(-6.8, -4.5, 7.1);
  addContainer(-6.8, 0.3, 7.1);
  addContainer(6.8, -4.5, 7.1);
  addContainer(6.8, 0.3, 7.1);
  addBox(-1.9, 1.3, -2.1, 0.18, 2.6, 0.22, materials.accent, { name: 'door-marker' });
  addBox(1.9, 1.3, -2.1, 0.18, 2.6, 0.22, materials.teal, { name: 'door-marker' });

  // A-long west lane cover.
  addCrate(-17, -9.5, 1.2, 1.15, 1.05, true);
  addCrate(-20.5, -3.5, 1, 1, 0.95);
  addCrate(-16.5, 4, 1.1, 1, 1.05);
  addCrate(-22, 10, 1.25, 1.1, 1.1, true);

  // B-cut cover and a short, stepped climb onto the east watch platform.
  addCrate(17, -9.5, 1.05, 1, 0.95);
  addCrate(21.5, -2, 1, 1.1, 1.05, true);
  addCrate(17, 4, 1.1, 1.05, 1);
  addBox(21.5, 2.2, -5.5, 5.6, 0.35, 4.2, materials.dark, { name: 'watchtower-platform' });
  for (let i = 0; i < 4; i += 1) {
    const height = 0.55 * (i + 1);
    addBox(19.1, height / 2, -2.35 + i * 0.78, 1.7, height, 0.82, materials.wall, {
      name: 'watchtower-stair'
    });
  }
  addBox(21.5, 1.35, -7.62, 0.24, 2.7, 0.24, materials.teal, { name: 'tower-post' });

  // Fuel Depot tanks sit on visible saddles with a connected pipe run.
  for (const z of [9.4, 14.1]) {
    addCylinder(20.5, 1.65, z, 0.95, 5.8, materials.tank);
    for (const x of [18.5, 22.5]) {
      addBox(x, 0.62, z, 0.42, 1.24, 1.45, materials.wall, { name: 'tank-saddle' });
    }
    addCylinder(20.5, 2.66, z, 0.1, 5.6, materials.pipe, 'z');
  }
  addCylinder(23.45, 0.8, 11.75, 0.12, 5.2, materials.pipe, 'z');
  addCylinder(23.45, 0.8, 9.15, 0.12, 5.9, materials.pipe);
  addCrate(15.8, 16.1, 1.05, 1, 1, true);
  addCrate(25.1, 7.2, 0.95, 1, 0.9);

  // Extra scattered cover breaks long sightlines without sealing the site approaches.
  addCrate(-11.2, 9.2, 1, 1.1, 1);
  addCrate(-8.7, 13.7, 1.1, 0.9, 0.95);
  addCrate(10.5, 12.7, 1, 1, 0.95);
  addCrate(11, -11.2, 1, 0.9, 1.05);

  const sun = new THREE.DirectionalLight(0xffd5a0, 3.1);
  sun.position.set(-32, 38, -18);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -31;
  sun.shadow.camera.right = 31;
  sun.shadow.camera.top = 24;
  sun.shadow.camera.bottom = -24;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 90;
  sun.shadow.bias = -0.00025;
  sun.shadow.normalBias = 0.025;
  scene.add(sun);

  scene.add(new THREE.HemisphereLight(0x9ab6cf, 0x27252a, 1.75));
  scene.background = new THREE.Color(canvas);
  scene.fog = new THREE.Fog(canvas, 30, 90);
  scene.add(group);

  const siteA = new THREE.Box3(
    new THREE.Vector3(-6.5, 0, -19.7),
    new THREE.Vector3(6.5, 5.5, -12)
  );
  const siteB = new THREE.Box3(
    new THREE.Vector3(14, 0, 6),
    new THREE.Vector3(27, 4, 18)
  );

  const waypoints = [
    { p: new THREE.Vector3(-2, 0, 16), links: [5, 6] },
    { p: new THREE.Vector3(-1, 0, 16.5), links: [5, 6] },
    { p: new THREE.Vector3(0, 0, 17), links: [5, 6] },
    { p: new THREE.Vector3(1, 0, 16.5), links: [5, 6] },
    { p: new THREE.Vector3(2, 0, 16), links: [5, 6] },
    { p: new THREE.Vector3(-8, 0, 13), links: [0, 1, 2, 3, 4, 7, 11] },
    { p: new THREE.Vector3(8, 0, 13), links: [0, 1, 2, 3, 4, 8, 12] },
    { p: new THREE.Vector3(-18, 0, 8), links: [5, 9, 13] },
    { p: new THREE.Vector3(18, 0, 8), links: [6, 10, 14] },
    { p: new THREE.Vector3(-18, 0, 0), links: [7, 11, 15] },
    { p: new THREE.Vector3(18, 0, 0), links: [8, 12, 16] },
    { p: new THREE.Vector3(-12, 0, -3), links: [5, 9, 15, 17] },
    { p: new THREE.Vector3(12, 0, -3), links: [6, 10, 16, 18] },
    { p: new THREE.Vector3(-22, 0, 12), links: [7, 19] },
    { p: new THREE.Vector3(23, 0, 12), links: [8, 20] },
    { p: new THREE.Vector3(-4, 0, -2), links: [9, 11, 17, 18, 21] },
    { p: new THREE.Vector3(4, 0, -2), links: [10, 12, 17, 18, 22] },
    { p: new THREE.Vector3(-2, 0, -2), links: [11, 15, 16, 18, 21, 22] },
    { p: new THREE.Vector3(2, 0, -2), links: [12, 16, 17, 22, 23] },
    { p: new THREE.Vector3(-2, 0, -12), links: [13, 21, 24] },
    { p: new THREE.Vector3(2, 0, -12), links: [14, 22, 25] },
    { p: new THREE.Vector3(-3, 0, -8), links: [15, 17, 19, 22, 24] },
    { p: new THREE.Vector3(3, 0, -8), links: [16, 17, 18, 20, 21, 25] },
    { p: new THREE.Vector3(0, 0, -10), links: [18, 21, 22, 24, 25] },
    { p: new THREE.Vector3(-2, 0, -15), links: [19, 21, 23] },
    { p: new THREE.Vector3(2, 0, -15), links: [20, 22, 23] }
  ];

  return {
    colliders,
    shootables,
    group,
    sites: { A: siteA, B: siteB },
    spawns: {
      ember: [
        new THREE.Vector3(-2, 0, 16),
        new THREE.Vector3(-1, 0, 16.5),
        new THREE.Vector3(0, 0, 17),
        new THREE.Vector3(1, 0, 16.5),
        new THREE.Vector3(2, 0, 16)
      ],
      kestrel: [
        new THREE.Vector3(-2, 0, -16),
        new THREE.Vector3(-1, 0, -16.5),
        new THREE.Vector3(0, 0, -17),
        new THREE.Vector3(1, 0, -16.5),
        new THREE.Vector3(2, 0, -16)
      ]
    },
    plantSpots: {
      A: new THREE.Vector3(0, 0, -15),
      B: new THREE.Vector3(20, 0, 11)
    },
    waypoints,
    bounds: { minX: -27, maxX: 27, minZ: -19, maxZ: 19 }
  };
}
