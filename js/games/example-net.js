// Reference for the netcode kit (unlisted): exposes window.__netTest in tests.
import { registerGame } from './core.js';
import { createNet } from './net.js';

registerGame({
  id: 'example-net',
  title: 'Net test (example)',
  kind: 'live',
  unlisted: true,
  mount(el, api) {
    const net = createNet(api);
    const got = [];
    net.on('msg', (d, at) => got.push({ d, at }));
    el.innerHTML = '<p class="net-status">netcode test</p>';
    let x = 0;
    const iv = setInterval(() => { x += 1; net.publish({ x, yaw: (x / 10) % (Math.PI * 2) }); }, 16);
    window.__netTest = { net, got, isHost: api.isHost };
    return { destroy() { clearInterval(iv); net.destroy(); delete window.__netTest; } };
  },
});
