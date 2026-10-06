// STUB: replaced by the Santee map designer. Contract: docs/games/getaway-maps.md
export const SANTEE = {
  id: 'santee', name: 'Santee', blurb: 'Coming soon', stub: true,
  bounds: { x0: -300, z0: -300, x1: 300, z1: 300 },
  roads: [{ name: 'Loop', kind: 'arterial', width: 14, closed: true, pts: [[-200, -200], [200, -200], [200, 200], [-200, 200]] }],
  open: [], solids: [], water: [],
  spawns: [{ runner: { x: 0, z: -200, yaw: Math.PI / 2 }, cop: { x: -80, z: -200, yaw: Math.PI / 2 } }],
  landmarks: [],
  sky: { top: '#7fb6e6', horizon: '#f3e9d2', fog: '#f3e9d2', fogNear: 120, fogFar: 520, sun: { bearing: 250, elev: 30 } },
  build(THREE) { return new THREE.Group(); },
  backdrop(THREE) { return new THREE.Group(); },
};
