const VERSION = 1;
const STORAGE_KEY = 'scale-in-calc-v1';
const MAX_LEVELS = 30;
const BINANCE_PRICE = 'https://api.binance.com/api/v3/ticker/price?symbol=';
const DEFAULTS = {
  first: '15',
  multiplier: '2',
  levels: '5',
  stepPct: '',
  startPrice: '',
  symbol: '',
  budget: '',
};

const $ = (id) => document.getElementById(id);

const fields = {
  first: $('first'),
  multiplier: $('multiplier'),
  levels: $('levels'),
  stepPct: $('stepPct'),
  startPrice: $('startPrice'),
  symbol: $('symbol'),
  budget: $('budget'),
};

function parseNum(raw) {
  if (raw == null) return null;
  let s = String(raw).trim().replace(/,/g, '');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

function formatU(n) {
  if (!Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  const max = abs >= 1000 ? 2 : abs >= 1 ? 4 : 6;
  let s = n.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: max,
  });
  return s;
}

function formatPrice(n) {
  if (!Number.isFinite(n) || n <= 0) return '—';
  const abs = Math.abs(n);
  const max = abs >= 10 ? 2 : abs >= 1 ? 4 : abs >= 0.01 ? 6 : 8;
  return n.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: max,
  });
}

function formatPct(n) {
  if (!Number.isFinite(n)) return '—';
  const sign = n > 0 ? '' : n < 0 ? '−' : '';
  return sign + Math.abs(n).toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }) + '%';
}

function formatMult(n) {
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  }) + '×';
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const saved = JSON.parse(raw);
    const out = { ...DEFAULTS };
    for (const k of Object.keys(DEFAULTS)) {
      if (saved[k] != null) out[k] = String(saved[k]);
    }
    return out;
  } catch {
    return { ...DEFAULTS };
  }
}

function readInputs() {
  const out = {};
  for (const k of Object.keys(fields)) out[k] = fields[k].value;
  return out;
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(readInputs()));
  } catch { /* ignore quota / private mode */ }
}

function applyState(state) {
  for (const k of Object.keys(fields)) {
    fields[k].value = state[k] != null ? state[k] : DEFAULTS[k];
  }
}

function levelSize(first, multiplier, n) {
  return first * Math.pow(multiplier, n - 1);
}

function totalOutlay(first, multiplier, levels) {
  if (multiplier === 1) return first * levels;
  return first * (Math.pow(multiplier, levels) - 1) / (multiplier - 1);
}

function hkTime(d = new Date()) {
  const parts = new Intl.DateTimeFormat('zh-HK', {
    timeZone: 'Asia/Hong_Kong',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
  return parts + ' 香港時間';
}

function normalizeSymbol(raw) {
  let s = String(raw || '').trim().toUpperCase().replace(/[\/\-_ ]/g, '');
  if (!s) return '';
  if (/USDT$|USDC$|BUSD$|FDUSD$|TUSD$/.test(s)) return s;
  return s + 'USDT';
}

function compute(state) {
  const first = parseNum(state.first);
  const multiplier = parseNum(state.multiplier);
  const levelsRaw = parseNum(state.levels);
  const stepPct = parseNum(state.stepPct);
  const startPriceIn = parseNum(state.startPrice);
  const budget = parseNum(state.budget);

  if (first == null || first !== first || first <= 0) {
    return { error: '第一注金額要係大於 0 嘅數字' };
  }
  if (multiplier == null || multiplier !== multiplier || multiplier <= 0) {
    return { error: '倍數要係大於 0 嘅數字' };
  }
  if (levelsRaw == null || levelsRaw !== levelsRaw || !Number.isInteger(levelsRaw) || levelsRaw < 1) {
    return { error: '總注數要係 1 或以上嘅整數' };
  }
  const levels = Math.min(MAX_LEVELS, levelsRaw);
  const capped = levelsRaw > MAX_LEVELS;

  if (state.stepPct.trim() && (stepPct !== stepPct || stepPct < 0)) {
    return { error: '每級價格間隔要係 0 或以上嘅數字' };
  }
  if (state.startPrice.trim() && (startPriceIn !== startPriceIn || startPriceIn <= 0)) {
    return { error: '第一注價格要係大於 0 嘅數字' };
  }
  if (state.budget.trim() && (budget !== budget || budget <= 0)) {
    return { error: '手上最多用幾多要係大於 0 嘅數字' };
  }

  const hasStep = state.stepPct.trim() !== '' && Number.isFinite(stepPct);
  const hasStart = state.startPrice.trim() !== '' && Number.isFinite(startPriceIn) && startPriceIn > 0;
  const usedIndex = hasStep && !hasStart;
  const startPrice = hasStart ? startPriceIn : (hasStep ? 100 : null);
  const hasBudget = state.budget.trim() !== '' && Number.isFinite(budget) && budget > 0;

  const rows = [];
  let cumSize = 0;
  let cumQty = 0;

  for (let n = 1; n <= levels; n++) {
    const size = levelSize(first, multiplier, n);
    cumSize += size;
    const row = {
      n,
      size,
      cumSize,
      over: hasBudget && cumSize > budget + 1e-9,
    };

    if (hasStep && startPrice != null) {
      const price = startPrice * (1 - (stepPct / 100) * (n - 1));
      const deviation = -stepPct * (n - 1);
      row.price = price;
      row.deviation = deviation;
      row.priceOk = Number.isFinite(price) && price > 0;
      if (row.priceOk) {
        const qty = size / price;
        cumQty += qty;
        row.qty = qty;
        row.cumQty = cumQty;
        row.avg = cumSize / cumQty;
        row.rebound = ((row.avg - price) / price) * 100;
      }
    }
    rows.push(row);
  }

  const last = rows[rows.length - 1];
  return {
    error: null,
    first,
    multiplier,
    levels,
    capped,
    hasStep,
    hasStart,
    usedIndex,
    startPrice,
    stepPct: hasStep ? stepPct : null,
    hasBudget,
    budget: hasBudget ? budget : null,
    rows,
    total: last.cumSize,
    lastSize: last.size,
    multiple: last.cumSize / first,
    overBudget: hasBudget && last.cumSize > budget + 1e-9,
    overBy: hasBudget ? last.cumSize - budget : 0,
  };
}

function renderSummary(result) {
  const el = $('summary');
  const err = $('formError');
  if (result.error) {
    el.innerHTML = '';
    err.hidden = false;
    err.textContent = result.error;
    return;
  }
  err.hidden = true;
  err.textContent = '';

  const overClass = result.overBudget ? ' over' : '';
  const overSub = result.overBudget
    ? `<div class="sub">超出 ${formatU(result.overBy)} U</div>`
    : '';
  el.innerHTML = `
    <article class="metric${overClass}">
      <div class="k">全部開晒要預留</div>
      <div class="v">${formatU(result.total)}<span class="u">U</span></div>
      ${overSub}
    </article>
    <article class="metric">
      <div class="k">最大單注</div>
      <div class="v">${formatU(result.lastSize)}<span class="u">U</span></div>
    </article>
    <article class="metric">
      <div class="k">係第一注幾倍</div>
      <div class="v">${formatMult(result.multiple)}</div>
    </article>
  `;
}

function renderHint(result, state) {
  const levels = parseNum(state.levels);
  const n = Number.isInteger(levels) && levels >= 1 ? Math.min(MAX_LEVELS, levels) : null;
  const adds = n != null ? n - 1 : '—';
  let text = `加倉次數 = 總注數 − 1，而家係 ${adds} 次`;
  if (result && result.capped) text += `（最多 ${MAX_LEVELS} 注）`;
  $('addsHint').textContent = text;
}

function syncChips(state) {
  const m = parseNum(state.multiplier);
  document.querySelectorAll('#multChips button').forEach((btn) => {
    const v = Number(btn.dataset.m);
    btn.classList.toggle('on', Number.isFinite(m) && m === v);
  });
}

function renderTable(result) {
  const thead = $('table').tHead;
  const tbody = $('table').tBodies[0];
  if (result.error) {
    thead.innerHTML = '';
    tbody.innerHTML = '';
    return;
  }

  const showPx = result.hasStep;
  $('table').classList.toggle('with-px', showPx);
  thead.innerHTML = `<tr>
    <th>第幾注</th>
    <th>${showPx ? '呢注' : '呢注金額'}</th>
    <th>${showPx ? '累計' : '累計總額'}</th>
    ${showPx ? '<th>呢級價</th><th>均價</th>' : ''}
  </tr>`;

  tbody.innerHTML = result.rows.map((row) => {
    const cls = row.over ? 'over' : (!row.priceOk && showPx ? 'invalid' : '');
    const tag = row.over ? '<span class="tag">超出</span>' : '';
    let px = '';
    if (showPx) {
      if (!row.priceOk) {
        px = '<td>—</td><td>—</td>';
      } else {
        const dev = row.deviation === 0 ? '0%' : formatPct(row.deviation);
        const rebound = row.n === 1 ? '0%' : '反彈 ' + formatPct(row.rebound);
        px = `<td>${formatPrice(row.price)}<div class="sub">${dev}</div></td>
              <td>${formatPrice(row.avg)}<div class="sub">${rebound}</div></td>`;
      }
    }
    return `<tr class="${cls}">
      <td>第 ${row.n} 注${tag}</td>
      <td>${formatU(row.size)}</td>
      <td>${formatU(row.cumSize)}</td>
      ${px}
    </tr>`;
  }).join('');
}

function renderChart(result) {
  const panel = $('chartPanel');
  const note = $('chartNote');
  const wrap = $('chartScroll');
  if (result.error || !result.hasStep) {
    panel.hidden = true;
    wrap.innerHTML = '';
    return;
  }

  panel.hidden = false;
  if (result.usedIndex) {
    note.textContent = '未填第一注價格，價位用 100 做指數；向下加倉。';
  } else {
    note.textContent = '由第一注價格向下，每級按間隔下跌。';
  }

  const rows = result.rows;
  const W = 360;
  const rowH = 48;
  const padT = 8;
  const padB = 8;
  const padL = 8;
  const padR = 8;
  const H = padT + padB + rows.length * rowH;
  const labelW = 86;
  const rightW = 150;
  const axisX = padL + labelW;
  const axisRight = W - padR - rightW;

  const sizes = rows.map((r) => r.size);
  const maxSize = Math.max(...sizes);
  const minR = 4;
  const maxR = 9;

  const nodes = rows.map((row, i) => {
    const y = padT + i * rowH + rowH / 2;
    const r = minR + (maxR - minR) * (row.size / maxSize);
    return { row, y, r };
  });

  const line = nodes.map((n, i) => `${i === 0 ? 'M' : 'L'} ${axisX} ${n.y}`).join(' ');
  const ticks = nodes.map(({ row, y, r }) => {
    const color = row.over ? 'var(--warn)' : !row.priceOk ? 'var(--muted)' : 'var(--accent)';
    const priceLabel = !row.priceOk
      ? '—'
      : result.usedIndex
        ? formatPrice(row.price)
        : formatPrice(row.price);
    const devLabel = row.priceOk ? formatPct(row.deviation) : '';
    const sizeLabel = `第${row.n}注  ${formatU(row.size)} U`;
    const cumLabel = `累計 ${formatU(row.cumSize)}`;
    const barW = Math.max(16, (axisRight - axisX - 16) * (row.size / maxSize));
    return `
      <line x1="${axisX}" y1="${y}" x2="${axisX + barW}" y2="${y}"
        stroke="${color}" stroke-width="6" stroke-linecap="round" opacity=".35"/>
      <circle cx="${axisX}" cy="${y}" r="${r + 3}" fill="#0a0e0d" stroke="${color}" stroke-width="2"/>
      <text x="${axisX - 12}" y="${y - 5}" text-anchor="end" fill="${color}" font-size="11" font-weight="600">${priceLabel}</text>
      <text x="${axisX - 12}" y="${y + 11}" text-anchor="end" fill="var(--muted)" font-size="9">${devLabel}</text>
      <text x="${axisX + barW + 10}" y="${y - 5}" fill="var(--text)" font-size="11" font-weight="600">${sizeLabel}${row.over ? ' · 超出' : ''}</text>
      <text x="${axisX + barW + 10}" y="${y + 11}" fill="var(--muted)" font-size="9">${cumLabel}</text>
    `;
  }).join('');

  wrap.innerHTML = `<svg class="ladder" viewBox="0 0 ${W} ${H}" width="100%" height="${Math.max(160, H)}" role="img" aria-label="向下加倉價格階梯">
    <line x1="${axisX}" y1="${padT + 8}" x2="${axisX}" y2="${H - padB - 8}"
      stroke="rgba(62,207,191,.28)" stroke-width="2" stroke-linecap="round"/>
    <path d="${line}" fill="none" stroke="rgba(62,207,191,.0)" />
    ${ticks}
  </svg>`;
}

function renderAll() {
  const state = readInputs();
  saveState();
  syncChips(state);
  const result = compute(state);
  renderHint(result, state);
  renderSummary(result);
  renderTable(result);
  renderChart(result);
}

async function fetchPrice() {
  const btn = $('fetchBtn');
  const status = $('fetchStatus');
  const symbol = normalizeSymbol(fields.symbol.value);
  if (!symbol) {
    status.className = 'hint bad';
    status.textContent = '先填幣種，例如 BTC 或 XAUT';
    return;
  }
  fields.symbol.value = symbol;

  btn.disabled = true;
  status.className = 'hint';
  status.textContent = '取緊價…';
  try {
    const res = await fetch(BINANCE_PRICE + encodeURIComponent(symbol), { cache: 'no-store' });
    if (!res.ok) throw new Error('not ok');
    const data = await res.json();
    const px = Number(data.price);
    if (!Number.isFinite(px) || px <= 0) throw new Error('bad price');
    fields.startPrice.value = String(px);
    status.className = 'hint ok';
    status.textContent = `${symbol} ${formatPrice(px)} · ${hkTime()}`;
    renderAll();
  } catch {
    status.className = 'hint bad';
    status.textContent = `取唔到 ${symbol} 嘅公開價，可以手填`;
  } finally {
    btn.disabled = false;
  }
}

function bind() {
  applyState(loadState());

  $('form').addEventListener('submit', (e) => e.preventDefault());

  for (const el of Object.values(fields)) {
    el.addEventListener('input', renderAll);
    el.addEventListener('change', renderAll);
  }

  document.querySelectorAll('#multChips button').forEach((btn) => {
    btn.addEventListener('click', () => {
      fields.multiplier.value = btn.dataset.m;
      renderAll();
    });
  });

  $('levelsDown').addEventListener('click', () => {
    const n = parseNum(fields.levels.value);
    const next = Number.isInteger(n) ? Math.max(1, n - 1) : 5;
    fields.levels.value = String(next);
    renderAll();
  });
  $('levelsUp').addEventListener('click', () => {
    const n = parseNum(fields.levels.value);
    const next = Number.isInteger(n) ? Math.min(MAX_LEVELS, n + 1) : 5;
    fields.levels.value = String(next);
    renderAll();
  });

  $('fetchBtn').addEventListener('click', fetchPrice);
  fields.symbol.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      fetchPrice();
    }
  });

  $('resetBtn').addEventListener('click', () => {
    applyState({ ...DEFAULTS });
    $('fetchStatus').className = 'hint';
    $('fetchStatus').textContent = '';
    renderAll();
  });

  renderAll();
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js');
}

bind();

