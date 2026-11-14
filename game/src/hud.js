const MODE_COPY = {
  start: {
    title: 'EMBERLINE',
    copy: 'A round-based tactical engagement. Secure the site, protect your team, and outlast the opposition.',
    action: 'DEPLOY'
  },
  paused: {
    title: 'PAUSED',
    copy: 'The operation is on hold.',
    action: 'RESUME'
  },
  roundEnd: {
    title: 'ROUND COMPLETE',
    copy: '',
    action: 'CONTINUE'
  },
  matchEnd: {
    title: 'MATCH COMPLETE',
    copy: '',
    action: 'RETURN TO YARD'
  }
};

export function createHud() {
  const ids = [
    'health-fill', 'health-num', 'armour-num', 'ammo-mag', 'ammo-reserve',
    'weapon-name', 'money', 'timer', 'score-ember', 'score-kestrel',
    'alive-ember', 'alive-kestrel', 'bomb-line', 'killfeed', 'vignette',
    'minimap', 'buy', 'buy-grid', 'buy-money', 'banner', 'banner-title',
    'banner-sub', 'overlay', 'overlay-title', 'overlay-copy', 'play',
    'crosshair'
  ];
  const elements = Object.fromEntries(ids.map(id => [id, document.getElementById(id)]));
  const cache = new Map();
  const feed = [];
  let buyItems = [];
  let buyHandler = null;
  let playHandler = null;
  let bannerTimeout = 0;
  let markerTimeout = 0;
  let flashTimeout = 0;
  let minimapTime = -Infinity;

  function write(id, value) {
    const element = elements[id];
    if (!element) return;
    const text = String(value);
    if (cache.get(id) === text) return;
    cache.set(id, text);
    element.textContent = text;
  }

  function formatMoney(amount) {
    const value = Math.max(0, Math.floor(Number(amount) || 0));
    return `$${value.toLocaleString('en-US')}`;
  }

  function setHealth(hp, armour) {
    const health = Math.max(0, Math.min(100, Number(hp) || 0));
    write('health-num', Math.round(health));
    write('armour-num', Math.max(0, Math.round(Number(armour) || 0)));
    const fill = elements['health-fill'];
    if (fill) {
      const width = `${health}%`;
      if (cache.get('health-width') !== width) {
        cache.set('health-width', width);
        fill.style.width = width;
      }
      const low = health < 30;
      if (cache.get('health-low') !== low) {
        cache.set('health-low', low);
        fill.classList.toggle('low', low);
      }
    }
  }

  function setAmmo(mag, reserve, name) {
    write('ammo-mag', Math.max(0, Math.floor(Number(mag) || 0)));
    write('ammo-reserve', `/ ${Math.max(0, Math.floor(Number(reserve) || 0))}`);
    write('weapon-name', name || '');
  }

  function setMoney(amount) {
    const value = formatMoney(amount);
    write('money', value);
    write('buy-money', value);
  }

  function setTimer(seconds, phase) {
    const time = Math.max(0, Math.ceil(Number(seconds) || 0));
    const minutes = Math.floor(time / 60);
    const remainder = String(time % 60).padStart(2, '0');
    write('timer', phase === 'planted' ? `BOMB ${minutes}:${remainder}` : `${minutes}:${remainder}`);
    const timer = elements.timer;
    if (timer) {
      const urgent = phase === 'planted' || time < 10;
      if (cache.get('timer-urgent') !== urgent) {
        cache.set('timer-urgent', urgent);
        timer.style.color = urgent ? 'var(--accent)' : '';
      }
    }
  }

  function setScore(ember, kestrel) {
    write('score-ember', `EMBER ${Math.max(0, Math.floor(Number(ember) || 0))}`);
    write('score-kestrel', `${Math.max(0, Math.floor(Number(kestrel) || 0))} KESTREL`);
  }

  function setAlive(ember, kestrel) {
    write('alive-ember', Math.max(0, Math.floor(Number(ember) || 0)));
    write('alive-kestrel', Math.max(0, Math.floor(Number(kestrel) || 0)));
  }

  function setBomb(text, fuseFrac = null) {
    write('bomb-line', text || '');
    const line = elements['bomb-line'];
    if (!line) return;
    const value = fuseFrac == null ? '' : `${Math.max(0, Math.min(1, Number(fuseFrac) || 0))}`;
    if (cache.get('bomb-fuse') !== value) {
      cache.set('bomb-fuse', value);
      line.style.setProperty('--fuse-frac', value);
    }
  }

  function renderKillfeed() {
    const element = elements.killfeed;
    if (!element) return;
    element.replaceChildren();
    const now = performance.now();
    for (const entry of feed) {
      const row = document.createElement('div');
      row.textContent = entry.text;
      row.style.opacity = String(Math.max(0.15, 1 - (now - entry.time - 3500) / 1500));
      element.appendChild(row);
    }
  }

  function addKill(text) {
    feed.unshift({ text: String(text), time: performance.now() });
    if (feed.length > 5) feed.length = 5;
    renderKillfeed();
    setTimeout(() => {
      for (let i = feed.length - 1; i >= 0; i -= 1) {
        if (performance.now() - feed[i].time >= 5000) feed.splice(i, 1);
      }
      renderKillfeed();
    }, 5050);
  }

  function hitMarker(killed, holdMs = 90) {
    const element = document.getElementById('hitmarker');
    if (!element) return;
    element.classList.toggle('killed', Boolean(killed));
    element.classList.add('active');
    clearTimeout(markerTimeout);
    markerTimeout = setTimeout(() => element.classList.remove('active'), holdMs);
  }

  function damageFlash() {
    const element = elements.vignette;
    if (!element) return;
    element.style.opacity = '1';
    clearTimeout(flashTimeout);
    flashTimeout = setTimeout(() => { element.style.opacity = '0'; }, 180);
  }

  function setCrosshairGap(px) {
    const element = elements.crosshair;
    if (!element) return;
    const gap = `${Math.max(0, Number(px) || 0)}px`;
    if (cache.get('crosshair-gap') === gap) return;
    cache.set('crosshair-gap', gap);
    element.style.setProperty('--gap', gap);
  }

  function showBuy(items, money, onBuy) {
    buyItems = Array.isArray(items) ? items.slice(0, 6) : [];
    buyHandler = typeof onBuy === 'function' ? onBuy : null;
    write('buy-money', formatMoney(money));
    const grid = elements['buy-grid'];
    if (grid) {
      grid.replaceChildren();
      for (const item of buyItems) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'buy-item';
        button.dataset.buy = String(item.key);

        const label = document.createElement('span');
        label.className = 'buy-label';
        const name = document.createElement('span');
        name.textContent = item.name || '';
        const desc = document.createElement('span');
        desc.className = 'buy-desc';
        desc.textContent = item.desc || '';
        label.append(name, desc);

        const price = document.createElement('span');
        price.className = 'buy-price';
        price.textContent = formatMoney(item.price);
        button.append(label, price);

        if (item.owned) {
          button.disabled = true;
          button.setAttribute('aria-label', `${item.name || 'Item'}, owned`);
        } else {
          button.addEventListener('click', () => {
            if (buyHandler) buyHandler(item);
          });
        }
        grid.appendChild(button);
      }
    }
    if (elements.buy) elements.buy.hidden = false;
  }

  function hideBuy() {
    if (elements.buy) elements.buy.hidden = true;
    buyItems = [];
    buyHandler = null;
  }

  function buyVisible() {
    return Boolean(elements.buy && !elements.buy.hidden);
  }

  function showBanner(title, sub, ms = 2600) {
    write('banner-title', title || '');
    write('banner-sub', sub || '');
    if (elements.banner) elements.banner.hidden = false;
    clearTimeout(bannerTimeout);
    bannerTimeout = setTimeout(() => {
      if (elements.banner) elements.banner.hidden = true;
    }, Math.max(0, ms));
  }

  function showOverlay(mode, data = {}) {
    const copy = MODE_COPY[mode] || MODE_COPY.start;
    let title = copy.title;
    let text = copy.copy;
    let action = copy.action;

    if (mode === 'roundEnd') {
      const winner = data.winner || 'Round complete';
      const reason = data.reason ? ` · ${data.reason}` : '';
      const score = data.score || {};
      title = `${winner.toUpperCase()} WINS`;
      text = `${reason.replace(/^ · /, '')}${reason ? ' · ' : ''}EMBER ${score.ember ?? 0} — ${score.kestrel ?? 0} KESTREL`;
    } else if (mode === 'matchEnd') {
      const score = data.score || {};
      title = data.winner ? `${String(data.winner).toUpperCase()} WINS THE MATCH` : 'MATCH DRAW';
      text = `FINAL SCORE · EMBER ${score.ember ?? 0} — ${score.kestrel ?? 0} KESTREL`;
    }

    write('overlay-title', data.title || title);
    write('overlay-copy', data.copy || text);
    write('play', data.action || action);
    if (elements.overlay) elements.overlay.hidden = false;
    if (elements['pointer-hint']) elements['pointer-hint'].hidden = mode === 'start';
  }

  function hideOverlay() {
    if (elements.overlay) elements.overlay.hidden = true;
  }

  function onPlay(handler) {
    playHandler = typeof handler === 'function' ? handler : null;
    const button = elements.play;
    if (!button) return;
    button.onclick = () => playHandler?.();
  }

  function drawMinimap(world, dots = []) {
    const canvas = elements.minimap;
    if (!canvas || !world || !world.bounds) return;
    const now = performance.now();
    if (now - minimapTime < 150) return;
    minimapTime = now;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const width = canvas.width;
    const height = canvas.height;
    const bounds = world.bounds;
    const rangeX = bounds.maxX - bounds.minX;
    const rangeZ = bounds.maxZ - bounds.minZ;
    const pad = 8;
    const scale = Math.min((width - pad * 2) / rangeX, (height - pad * 2) / rangeZ);
    const ox = (width - rangeX * scale) * 0.5;
    const oy = (height - rangeZ * scale) * 0.5;
    const px = x => ox + (x - bounds.minX) * scale;
    const pz = z => oy + (z - bounds.minZ) * scale;

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#14161a';
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = '#98a0a8';
    ctx.lineWidth = 2;
    ctx.strokeRect(px(bounds.minX), pz(bounds.minZ), rangeX * scale, rangeZ * scale);

    ctx.strokeStyle = '#2c323a';
    ctx.lineWidth = 1;
    if (world.sites) {
      for (const key of ['A', 'B']) {
        const site = world.sites[key];
        if (!site) continue;
        const min = site.min;
        const max = site.max;
        const x1 = min.x ?? min[0];
        const z1 = min.z ?? min[2];
        const x2 = max.x ?? max[0];
        const z2 = max.z ?? max[2];
        ctx.strokeRect(px(x1), pz(z1), (x2 - x1) * scale, (z2 - z1) * scale);
        ctx.fillStyle = '#e9e6df';
        ctx.font = 'bold 10px system-ui, sans-serif';
        ctx.fillText(key, px(x1) + 3, pz(z1) + 11);
      }
    }

    ctx.strokeStyle = '#2c323a';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(px(-27), pz(0));
    ctx.lineTo(px(27), pz(0));
    ctx.moveTo(px(0), pz(bounds.minZ));
    ctx.lineTo(px(0), pz(bounds.maxZ));
    ctx.stroke();

    for (const dot of dots) {
      const x = px(dot.x);
      const y = pz(dot.z);
      if (dot.me) {
        ctx.beginPath();
        ctx.arc(x, y, 5, 0, Math.PI * 2);
        ctx.strokeStyle = '#e9e6df';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.fillStyle = '#e9e6df';
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.arc(x, y, 3, 0, Math.PI * 2);
        ctx.fillStyle = dot.team === 'kestrel' ? '#5fb8a6' : '#f0a830';
        ctx.fill();
      }
    }
  }

  function handleKey(event) {
    if (!buyVisible()) return;
    if (event.key === 'Escape' || event.key.toLowerCase() === 'b') {
      hideBuy();
      return;
    }
    const item = buyItems.find(entry => String(entry.key) === event.key);
    if (item && !item.owned) buyHandler?.(item);
  }

  document.addEventListener('keydown', handleKey);

  return {
    setHealth,
    setAmmo,
    setMoney,
    setTimer,
    setScore,
    setAlive,
    setBomb,
    addKill,
    hitMarker,
    damageFlash,
    setCrosshairGap,
    showBuy,
    hideBuy,
    buyVisible,
    showBanner,
    showOverlay,
    hideOverlay,
    onPlay,
    drawMinimap
  };
}
