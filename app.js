/* お品書き帳 v2.3 — app.js
 * 仕様: 仕様書_お品書き帳.md v2.3
 * 開発/検証用フック(通常は触らない):
 *   localStorage 'ohogaki_api_base' … GitHub APIベース差し替え(既定 https://api.github.com)
 *   localStorage 'ohogaki_fx_base'  … fxtwitterベース差し替え(既定 https://api.fxtwitter.com)
 */
(() => {
'use strict';

const APP_VERSION = 'v2.3.0';
const DATA_VERSION = 3;
const LS_KEY = 'ohogaki_cfg_v23';
const IMG_CACHE_NAME = 'img-v1';

// ================= 汎用 =================
const $ = (s, r) => (r || document).querySelector(s);
function el(tag, attrs, ...kids){
  const n = document.createElement(tag);
  if(attrs) for(const k of Object.keys(attrs)){
    const v = attrs[k];
    if(k === 'class') n.className = v;
    else if(k === 'text') n.textContent = v;
    else if(k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else if(v !== null && v !== undefined && v !== false) n.setAttribute(k, v === true ? '' : v);
  }
  for(const c of kids.flat()){ if(c === null || c === undefined) continue; n.append(c); }
  return n;
}
const now = () => Date.now();
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
function uid(prefix){ return prefix + Math.random().toString(36).slice(2, 8) + now().toString(36).slice(-4); }
function fmtJST(ts){
  if(!ts) return '—';
  const d = new Date(ts), p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function nfkc(s){ return (s || '').normalize('NFKC'); }
function nfkcLower(s){ return nfkc(s).toLowerCase(); }
function cmpTuple(a, b){
  const n = Math.min(a.length, b.length);
  for(let i = 0; i < n; i++){ if(a[i] !== b[i]) return a[i] < b[i] ? -1 : 1; }
  return a.length - b.length;
}
function withVT(fn){
  if(document.startViewTransition){ try{ document.startViewTransition(fn); return; }catch(err){ /* fallthrough */ } }
  fn();
}
function imgUrl(url, size){
  if(!url) return '';
  try{
    const u = new URL(url);
    u.searchParams.set('name', size);
    if(!u.searchParams.get('format')) u.searchParams.set('format', 'jpg');
    return u.toString();
  }catch(err){ return url; }
}

// ================= トースト / ダイアログ / シート =================
function toast(msg, opts){
  opts = opts || {};
  const box = $('#toasts');
  const t = el('div', { class: 'toast' });
  t.append(el('span', { class: 'toast-msg', text: msg }));
  let timer = null;
  const close = () => { if(timer) clearTimeout(timer); t.remove(); };
  if(opts.actionLabel) t.append(el('button', { text: opts.actionLabel, onclick: () => { close(); if(opts.onAction) opts.onAction(); } }));
  t.append(el('button', { class: 'toast-x', text: '✕', onclick: close }));
  box.append(t);
  if(!opts.sticky) timer = setTimeout(close, opts.ms || 3500);
  return { close };
}

function openOverlay(extraClass){
  const ov = $('#overlay');
  ov.innerHTML = '';
  ov.className = extraClass || '';
  return ov;
}
function closeOverlay(){
  const ov = $('#overlay');
  ov.className = 'hidden';
  ov.innerHTML = '';
  ov.onclick = null;
}

function dialog(opts){
  return new Promise((resolve) => {
    const ov = openOverlay();
    const dlg = el('div', { class: 'dlg' });
    const finish = (val) => { closeOverlay(); resolve(val); };
    if(opts.title) dlg.append(el('h4', { text: opts.title }));
    if(opts.message) dlg.append(el('p', { class: 'dlg-msg', text: opts.message }));
    let inp = null;
    if(opts.textarea){
      inp = el('textarea', { rows: '8', placeholder: opts.placeholder || '' });
      if(opts.value) inp.value = opts.value;
      dlg.append(inp);
    }else if(opts.input){
      inp = el('input', { type: 'text', placeholder: opts.placeholder || '', autocapitalize: 'off', autocomplete: 'off' });
      if(opts.value) inp.value = opts.value;
      dlg.append(inp);
    }
    const row = el('div', { class: 'dlg-row' });
    for(const b of (opts.buttons || [{ label: 'OK', primary: true }])){
      row.append(el('button', {
        class: 'btn' + (b.primary ? ' primary' : '') + (b.danger ? ' danger' : ''),
        text: b.label,
        onclick: () => finish(b.value !== undefined ? b.value : (inp ? inp.value : true)),
      }));
    }
    dlg.append(row);
    ov.append(dlg);
    ov.onclick = (e) => { if(e.target === ov) finish(null); };
    if(inp){
      inp.focus();
      if(!opts.textarea) inp.addEventListener('keydown', (e) => { if(e.key === 'Enter'){ const v = inp.value; finish(v); } });
    }
  });
}

function sheet(opts){
  return new Promise((resolve) => {
    const ov = openOverlay('sheet');
    const panel = el('div', { class: 'sheet-panel' });
    if(opts.title) panel.append(el('div', { class: 'sheet-title', text: opts.title }));
    for(const it of opts.items){
      panel.append(el('button', { class: 'item', onclick: () => { closeOverlay(); resolve(it.value); } },
        el('div', { text: it.label }),
        it.sub ? el('div', { class: 'sub', text: it.sub }) : null));
    }
    ov.append(panel);
    ov.onclick = (e) => { if(e.target === ov){ closeOverlay(); resolve(null); } };
  });
}

// ================= スペース番号パース =================
const SP_SCAN_RE = /(東|西|南)\s*(?:ホール|館)?\s*([A-Z]{0,2})\s?(\d{1,2})\s*[-–ー−‐〜~]\s*(\d{1,2})/;
const SP_KEY_RE = /^(東|西|南)\s*(?:ホール|館)?\s*([A-Z]{1,2})?\s*(\d{1,3})?\s*[-–ー−‐〜~]\s*(\d{1,3})/;

function parseSP(text){
  if(!text) return null;
  const t = nfkc(text).toUpperCase();
  const m = t.match(SP_SCAN_RE);
  if(!m) return null;
  const hall = m[1], letters = m[2] || '', block = parseInt(m[3], 10), num = parseInt(m[4], 10);
  if(!block || !num) return null;
  const sp = letters ? `${hall}${letters} ${block}-${num}` : `${hall}${block}-${num}`;
  return { sp, hall, letters, block, num };
}

function spSortKey(sp){
  if(!sp) return null;
  const t = nfkc(sp).toUpperCase();
  const m = t.match(SP_KEY_RE);
  if(!m) return null;
  const hall = m[1], letters = m[2] || '', block = parseInt(m[3] || '0', 10), num = parseInt(m[4] || '0', 10);
  let rank;
  if(hall === '東') rank = letters ? 0 : 1;
  else if(hall === '西') rank = 2;
  else rank = 3;
  if(letters) return [rank, letters.charCodeAt(0) - 64, block, num];
  return [rank, 0, block, num];
}

function sectionOf(sp){
  const k = spSortKey(sp);
  if(!k) return { label: 'SP未設定', key: [9, 0, 0, 0] };
  const t = nfkc(sp).toUpperCase();
  const m = t.match(/^(東|西|南)\s*(?:ホール|館)?\s*([A-Z]{1,2})?\s*(\d{1,3})?/);
  const hall = m[1], letters = m[2] || '', block = m[3] || '';
  return { label: hall + (letters || block), key: [k[0], letters ? k[1] : k[2], 0, 0] };
}

const SP_TESTS = [
  ['西3-15 で頒布します', '西3-15'],
  ['東A 45-12 お品書き', '東A 45-12'],
  ['南ホール 1-5です', '南1-5'],
  ['東Ｂ 12-3 新刊', '東B 12-3'],
  ['スペース東3-10', '東3-10'],
  ['西3 - 15 (空白入り)', '西3-15'],
  ['委託先は南2-1', '南2-1'],
  ['コピー本 東7-8b', '東7-8'],
  ['3-15だけの数字', null],
  ['M3-2026春 参加します', null],
  ['東京ビッグサイト 西4-2', '西4-2'],
  ['東1-2 / 東1-3', '東1-2'],
  ['https://x.com/user/status/1234567890123456789', null],
];

// ================= IndexedDB =================
let dbPromise = null;
function db(){
  if(!dbPromise){
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open('ohogaki_db', 3);
      req.onupgradeneeded = (e) => {
        const d = e.target.result;
        if(!d.objectStoreNames.contains('entries')) d.createObjectStore('entries', { keyPath: 'key' });
        if(!d.objectStoreNames.contains('events')) d.createObjectStore('events', { keyPath: 'id' });
        if(!d.objectStoreNames.contains('meta')) d.createObjectStore('meta', { keyPath: 'key' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}
async function idbAll(store){
  const d = await db();
  return new Promise((resolve, reject) => {
    const rq = d.transaction(store, 'readonly').objectStore(store).getAll();
    rq.onsuccess = () => resolve(rq.result || []);
    rq.onerror = () => reject(rq.error);
  });
}
async function idbGet(store, key){
  const d = await db();
  return new Promise((resolve, reject) => {
    const rq = d.transaction(store, 'readonly').objectStore(store).get(key);
    rq.onsuccess = () => resolve(rq.result || null);
    rq.onerror = () => reject(rq.error);
  });
}
async function idbPut(store, val){
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction(store, 'readwrite');
    t.objectStore(store).put(val);
    t.oncomplete = () => resolve(true);
    t.onerror = () => reject(t.error);
  });
}
async function idbDel(store, key){
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction(store, 'readwrite');
    t.objectStore(store).delete(key);
    t.oncomplete = () => resolve(true);
    t.onerror = () => reject(t.error);
  });
}
async function mget(k){ const r = await idbGet('meta', k); return r ? r.value : undefined; }
async function mset(k, v){ await idbPut('meta', { key: k, value: v }); }

// ================= 設定・状態 =================
function loadCfg(){ try{ return JSON.parse(localStorage.getItem(LS_KEY)) || {}; }catch(err){ return {}; } }
function saveCfg(c){ localStorage.setItem(LS_KEY, JSON.stringify(c)); }
function apiBase(){ return localStorage.getItem('ohogaki_api_base') || 'https://api.github.com'; }
function fxBase(){ return localStorage.getItem('ohogaki_fx_base') || 'https://api.fxtwitter.com'; }

const S = {
  deviceId: '',
  cfg: loadCfg(),
  events: [], entries: [],
  currentEvent: null,
  view: 'tour', filter: 'all', sort: 'sp', q: '',
  sink: true,
  syncing: false, authError: false, lastSyncAt: 0, syncQueued: false,
  prefetchRunning: false, prefetchCancel: false,
};

function syncConfigured(){ const c = S.cfg; return !!(c && c.owner && c.repo && c.pat); }
function eventById(id){ return S.events.find(e => e.id === id) || null; }
function eventName(id){ const e = eventById(id); return e ? e.name : ''; }
function currentEventEntries(){ return S.entries.filter(e => e.eventId === S.currentEvent && !e.deletedAt); }
function pendingCount(){ return S.entries.filter(e => e.dirty).length + S.events.filter(e => e.dirty).length; }

async function reloadAll(){
  const eventsAll = await idbAll('events');
  S.events = eventsAll.filter(e => !e.deletedAt).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  S.entries = await idbAll('entries');
  let ce = await mget('currentEvent');
  if(!ce || !S.events.find(e => e.id === ce)) ce = S.events.length ? S.events[S.events.length - 1].id : null;
  S.currentEvent = ce;
  await mset('currentEvent', ce);
}

// ================= マージ規則 =================
// updatedAt が新しい方。同時刻は削除優先 → updatedBy の辞書順で決定的にタイブレーク
function winnerIsA(a, b){
  if(!a) return false;
  if(!b) return true;
  const au = a.updatedAt || 0, bu = b.updatedAt || 0;
  if(au !== bu) return au > bu;
  const ad = a.deletedAt ? 1 : 0, bd = b.deletedAt ? 1 : 0;
  if(ad !== bd) return ad > bd;
  return String(a.updatedBy || '') > String(b.updatedBy || '');
}

function stripLocal(rec){
  return {
    id: rec.id, url: rec.url, name: rec.name, handle: rec.handle, text: rec.text,
    sp: rec.sp, spManual: !!rec.spManual, media: rec.media || [],
    enriched: !!rec.enriched, checked: !!rec.checked, checkedAt: rec.checkedAt || null,
    star: !!rec.star, memo: rec.memo || '',
    addedAt: rec.addedAt || 0, updatedAt: rec.updatedAt || 0, updatedBy: rec.updatedBy || '',
    deletedAt: rec.deletedAt || null,
  };
}

async function mergeRemoteEvent(rev){
  const lev = await idbGet('events', rev.id);
  if(!lev || winnerIsA(rev, lev)){
    await idbPut('events', {
      id: rev.id, name: rev.name, createdAt: rev.createdAt || 0,
      updatedAt: rev.updatedAt || 0, updatedBy: rev.updatedBy || '',
      deletedAt: rev.deletedAt || null, dirty: 0,
    });
  }
  const ents = rev.entries || {};
  for(const eid of Object.keys(ents)){
    const rent = ents[eid];
    const key = rev.id + '|' + eid;
    const lent = await idbGet('entries', key);
    if(!lent || winnerIsA(rent, lent)){
      await idbPut('entries', Object.assign(stripLocal(rent), { key, eventId: rev.id, id: eid, dirty: 0 }));
    }
  }
}

// ================= GitHub Contents API =================
function ghHeaders(){
  return {
    'Authorization': 'Bearer ' + S.cfg.pat,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}
function ghUrl(path){ return apiBase() + '/repos/' + S.cfg.owner + '/' + S.cfg.repo + '/contents/' + path; }

function b64ToText(b64){
  const bin = atob(String(b64).replace(/\n/g, ''));
  const bytes = new Uint8Array(bin.length);
  for(let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}
function textToB64(str){
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for(let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

async function ghList(path){
  const res = await fetch(ghUrl(path), { headers: ghHeaders(), cache: 'no-store' });
  if(res.status === 404) return null;
  if(res.status === 401 || res.status === 403){ S.authError = true; throw new Error('認証エラー(' + res.status + ')'); }
  if(!res.ok) throw new Error('一覧取得失敗(' + res.status + ')');
  const j = await res.json();
  return Array.isArray(j) ? j : [j];
}

async function pullMerge(){
  S.authError = false;
  const files = await ghList('events');
  let merged = 0;
  for(const f of (files || [])){
    if(!f.name || !f.name.endsWith('.json')) continue;
    const res = await fetch(ghUrl('events/' + f.name), { headers: ghHeaders(), cache: 'no-store' });
    if(!res.ok) continue;
    const j = await res.json();
    if(j.truncated) continue;
    let obj = null;
    try{ obj = JSON.parse(b64ToText(j.content || '')); }catch(err){ continue; }
    if(!obj || !obj.id) continue;
    await mergeRemoteEvent(obj);
    merged++;
  }
  return merged;
}

async function putFile(path, text, message){
  const url = ghUrl(path);
  let sha = null;
  const g = await fetch(url, { headers: ghHeaders(), cache: 'no-store' });
  if(g.status === 200){ const j = await g.json(); sha = j.sha; }
  else if(g.status === 404){ sha = null; }
  else if(g.status === 401 || g.status === 403){ S.authError = true; return 'auth'; }
  else return 'error:' + g.status;
  const body = { message, content: textToB64(text) };
  if(sha) body.sha = sha;
  const p = await fetch(url, {
    method: 'PUT',
    headers: Object.assign(ghHeaders(), { 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
  });
  if(p.ok) return 'ok';
  if(p.status === 409 || p.status === 422) return 'conflict';
  if(p.status === 401 || p.status === 403){ S.authError = true; return 'auth'; }
  return 'error:' + p.status;
}

function buildEventFile(ev, ents){
  const file = {
    version: DATA_VERSION, id: ev.id, name: ev.name,
    createdAt: ev.createdAt || 0, updatedAt: ev.updatedAt || 0, updatedBy: ev.updatedBy || '',
    deletedAt: ev.deletedAt || null, entries: {},
  };
  for(const e of ents) file.entries[e.id] = stripLocal(e);
  return JSON.stringify(file, null, 1);
}

async function pushEventFile(evId, conflictLog){
  for(let attempt = 0; attempt < 3; attempt++){
    const ev = await idbGet('events', evId);
    if(!ev) return 'ok';
    const ents = (await idbAll('entries')).filter(e => e.eventId === evId);
    const text = buildEventFile(ev, ents);
    const r = await putFile('events/' + evId + '.json', text, 'oshinagaki: sync ' + ev.name);
    if(r === 'ok'){
      if(ev.dirty){ ev.dirty = 0; await idbPut('events', ev); }
      for(const e of ents){ if(e.dirty){ await idbPut('entries', Object.assign({}, e, { dirty: 0 })); } }
      return 'ok';
    }
    if(r === 'conflict'){
      conflictLog.push('競合検知→再マージ: ' + (ev.name || evId));
      await pullMerge();
      continue;
    }
    return r;
  }
  return 'error:conflict-retry';
}

async function ensureSettingsFile(){
  const url = ghUrl('settings.json');
  const g = await fetch(url, { headers: ghHeaders(), cache: 'no-store' });
  if(g.status === 200) return 'ok';
  if(g.status === 401 || g.status === 403){ S.authError = true; return 'auth'; }
  if(g.status !== 404) return 'error:' + g.status;
  const body = { message: 'oshinagaki: init settings', content: textToB64(JSON.stringify({ version: DATA_VERSION, app: 'ohogaki', updatedAt: now() }, null, 1)) };
  const p = await fetch(url, {
    method: 'PUT',
    headers: Object.assign(ghHeaders(), { 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
  });
  return p.ok ? 'ok' : ('error:' + p.status);
}

async function pushConflictLog(lines){
  try{
    const cur = (await mget('conflictLog')) || [];
    const next = cur.concat(lines.map(l => ({ at: now(), text: l }))).slice(-20);
    await mset('conflictLog', next);
  }catch(err){ /* ignore */ }
}

async function syncNow(opts){
  opts = opts || {};
  if(!syncConfigured()){ if(opts.manual) toast('同期が未設定です(設定タブでセットアップ)'); return false; }
  if(S.syncing){ S.syncQueued = true; return false; }
  S.syncing = true;
  updateSyncBar();
  const conflictLog = [];
  let result = true;
  try{
    await pullMerge();
    await ensureSettingsFile();
    const dirtyEvents = (await idbAll('events')).filter(e => e.dirty);
    const dirtyEntries = (await idbAll('entries')).filter(e => e.dirty);
    const ids = new Set(dirtyEvents.map(e => e.id).concat(dirtyEntries.map(e => e.eventId)));
    let err = null;
    for(const evId of ids){
      const r = await pushEventFile(evId, conflictLog);
      if(r !== 'ok'){ err = r; break; }
    }
    S.lastSyncAt = now();
    await mset('lastSyncAt', S.lastSyncAt);
    if(err){ throw new Error(err); }
    if(opts.manual) toast('同期しました ✓');
  }catch(e){
    result = false;
    const msg = (e && e.message) ? e.message : String(e);
    await pushConflictLog(['同期エラー: ' + msg]);
    if(opts.manual) toast('同期に失敗: ' + msg);
  }finally{
    if(conflictLog.length) await pushConflictLog(conflictLog);
    S.syncing = false;
    await reloadAll();
    renderAll();
    if(S.syncQueued){ S.syncQueued = false; setTimeout(() => syncNow({}), 300); }
  }
  return result;
}

// ================= 変更通知(デバウンスPush) =================
let pushTimer = null;
function schedulePush(){
  updateSyncBar();
  if(!syncConfigured()) return;
  if(pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => { pushTimer = null; syncNow({}); }, 1500);
}
async function touchEntry(rec){
  rec.updatedAt = now();
  rec.updatedBy = S.deviceId;
  rec.dirty = 1;
  await idbPut('entries', rec);
  syncStateEntry(rec);
  schedulePush();
}
function syncStateEntry(rec){
  const i = S.entries.findIndex(x => x.key === rec.key);
  if(i >= 0) S.entries[i] = rec;
  else S.entries.push(rec);
}
async function touchEvent(rec){
  rec.updatedAt = now();
  rec.updatedBy = S.deviceId;
  rec.dirty = 1;
  await idbPut('events', rec);
  schedulePush();
}

// ================= 補完(fxtwitter) =================
async function fxFetch(id){
  const res = await fetch(fxBase() + '/status/' + id, { cache: 'no-store' });
  if(!res.ok) throw new Error('HTTP ' + res.status);
  const j = await res.json();
  if(!j || (j.code && j.code !== 200)) throw new Error((j && j.message) || 'APIエラー');
  return j;
}

function collectMedia(t){
  const out = [];
  const md = t.media || {};
  for(const p of (md.photos || [])){ if(p && p.url) out.push(p.url); }
  for(const v of (md.videos || [])){ if(v && v.thumbnail_url) out.push(v.thumbnail_url); }
  return out;
}

async function enrichOne(entry){
  const j = await fxFetch(entry.id);
  const t = j.tweet;
  if(!t) throw new Error('ツイートを取得できません');
  const rec = await idbGet('entries', entry.key);
  if(!rec || rec.deletedAt) return;
  rec.name = (t.author && t.author.name) || rec.name || '';
  rec.handle = (t.author && t.author.screen_name) ? ('@' + t.author.screen_name) : (rec.handle || '');
  rec.text = t.text || '';
  if(t.url) rec.url = t.url;
  rec.media = collectMedia(t);
  if(!rec.spManual){
    const p = parseSP(t.text || '');
    if(p) rec.sp = p.sp;
  }
  rec.enriched = true;
  await touchEntry(rec);
}

const enrichQueue = [];
let enrichBusy = false;
function enqueueEnrich(tweetId){
  if(!tweetId) return;
  if(!enrichQueue.includes(tweetId)) enrichQueue.push(tweetId);
  pumpEnrich();
}
async function pumpEnrich(){
  if(enrichBusy) return;
  enrichBusy = true;
  try{
    while(enrichQueue.length){
      const id = enrichQueue.shift();
      const targets = (await idbAll('entries')).filter(e => e.id === id && !e.enriched && !e.deletedAt);
      for(const e of targets){
        try{ await enrichOne(e); }catch(err){ /* 失敗は保留のまま(手動再取得可) */ }
        await sleep(250);
      }
      await reloadAll();
      renderCurrent();
    }
  }finally{
    enrichBusy = false;
  }
}
// 未取得エントリの再補完(オンライン復帰時・起動時に呼ぶ。成功するまで繰り返すのではなく、その場で1回試行)
async function retryPendingEnrich(){
  try{
    const pend = (await idbAll('entries')).filter(e => !e.enriched && !e.deletedAt);
    for(const e of pend) enqueueEnrich(e.id);
  }catch(err){ /* ignore */ }
}

// ================= 追加 =================
function extractTweetId(str){
  if(!str) return null;
  const s = nfkc(String(str)).trim();
  let m = s.match(/^\d{10,25}$/);
  if(m) return m[0];
  m = s.match(/(?:twitter|x|vxtwitter|fxtwitter)\.com\/(?:[^/\s]+\/)?(?:status|statuses)\/(\d{10,25})/i);
  if(m) return m[1];
  m = s.match(/\/(?:status|statuses)\/(\d{10,25})/);
  if(m) return m[1];
  return null;
}

const DEFAULT_EVENT_NAME = '無題のイベント';

async function ensureEvent(){
  if(S.currentEvent){ const ev = eventById(S.currentEvent); if(ev) return ev.id; }
  const ev = { id: uid('ev_'), name: DEFAULT_EVENT_NAME, createdAt: now(), updatedAt: now(), updatedBy: S.deviceId, deletedAt: null, dirty: 1 };
  await idbPut('events', ev);
  await mset('currentEvent', ev.id);
  await reloadAll();
  return ev.id;
}

async function createEvent(name){
  const ev = { id: uid('ev_'), name: name || DEFAULT_EVENT_NAME, createdAt: now(), updatedAt: now(), updatedBy: S.deviceId, deletedAt: null, dirty: 1 };
  await idbPut('events', ev);
  await mset('currentEvent', ev.id);
  await reloadAll();
  schedulePush();
  return ev;
}

async function addTweetId(id, opts){
  opts = opts || {};
  const evId = opts.eventId || await ensureEvent();
  const key = evId + '|' + id;
  const prev = await idbGet('entries', key);
  if(prev && !prev.deletedAt){
    return { dup: true, entry: prev, eventId: evId };
  }
  let rec;
  if(prev && prev.deletedAt){
    rec = Object.assign({}, prev, { deletedAt: null, updatedAt: now(), updatedBy: S.deviceId, dirty: 1 });
  }else{
    rec = {
      key, eventId: evId, id, url: 'https://x.com/i/status/' + id,
      name: '', handle: '', text: '', sp: '', spManual: false, media: [],
      enriched: false, checked: false, checkedAt: null, star: false, memo: '',
      addedAt: now(), updatedAt: now(), updatedBy: S.deviceId, deletedAt: null, dirty: 1,
    };
  }
  await idbPut('entries', rec);
  await reloadAll();
  schedulePush();
  enqueueEnrich(id);
  return { dup: false, entry: rec, eventId: evId };
}

async function addFromInput(raw, opts){
  const id = extractTweetId(raw);
  if(!id) return { error: 'not-recognized' };
  return addTweetId(id, opts);
}

async function showAddToast(result){
  const name = eventName(result.eventId) || DEFAULT_EVENT_NAME;
  if(result.dup){
    toast('追加済み ✓「' + (result.entry.name || '取得中…') + '」');
    return;
  }
  toast('「' + name + '」に追加しました ✓', {
    ms: 5000,
    actionLabel: '変更',
    onAction: async () => {
      const target = await pickEvent({ title: '追加先を変更' });
      if(target && target !== result.entry.eventId) await moveEntryTo(result.entry.key, target);
    },
  });
}

async function pickEvent(opts){
  opts = opts || {};
  const items = S.events.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    .map(e => ({ label: e.name + (e.id === S.currentEvent ? '(選択中)' : ''), sub: '作成: ' + fmtJST(e.createdAt), value: e.id }));
  items.push({ label: '＋ 新しいイベント…', value: '__new__' });
  const v = await sheet({ title: opts.title || 'イベントを選択', items });
  if(v === '__new__'){
    const name = await dialog({ title: '新しいイベント', input: true, placeholder: '例: C123', buttons: [{ label: 'キャンセル', value: null }, { label: '作成', primary: true }] });
    if(!name) return null;
    const ev = await createEvent(String(name).trim());
    return ev.id;
  }
  return v;
}

async function moveEntryTo(key, targetEvId){
  const src = await idbGet('entries', key);
  if(!src) return;
  const tgtKey = targetEvId + '|' + src.id;
  const ex = await idbGet('entries', tgtKey);
  if(ex && !ex.deletedAt){
    toast('移動先に同じツイートが既にあります');
    return;
  }
  const moved = Object.assign({}, src, { key: tgtKey, eventId: targetEvId, deletedAt: null, updatedAt: now(), updatedBy: S.deviceId, dirty: 1 });
  await idbPut('entries', moved);
  if(src.dirty === 1 && src.updatedAt === src.addedAt && !src.enriched){
    await idbDel('entries', key);  // 追加直後の未送信分は物理削除(送信不要)
  }else{
    src.deletedAt = now();
    await touchEntry(src);
  }
  await mset('currentEvent', targetEvId);
  await reloadAll();
  renderAll();
  schedulePush();
  toast('移動しました ✓');
}

// ================= イベント操作 =================
async function deleteEvent(evId){
  const ev = eventById(evId);
  if(!ev) return;
  const ok = await dialog({
    title: 'イベントを削除',
    message: '「' + ev.name + '」を削除しますか?\n(中身も非表示になり、同期で他の端末にも反映されます)',
    buttons: [{ label: 'キャンセル', value: null }, { label: '削除', danger: true, primary: true, value: true }],
  });
  if(!ok) return;
  ev.deletedAt = now();
  await touchEvent(ev);
  await reloadAll();
  renderAll();
  toast('イベントを削除しました');
}

async function renameEvent(evId){
  const ev = eventById(evId);
  if(!ev) return;
  const name = await dialog({ title: 'イベント名を変更', input: true, value: ev.name, buttons: [{ label: 'キャンセル', value: null }, { label: '変更', primary: true }] });
  if(name === null) return;
  const trimmed = String(name).trim();
  if(!trimmed) return;
  ev.name = trimmed;
  await touchEvent(ev);
  await reloadAll();
  renderAll();
}

async function softDeleteEntry(key){
  const rec = await idbGet('entries', key);
  if(!rec) return;
  const ok = await dialog({
    title: '削除',
    message: '「' + (rec.name || 'この項目') + '」を削除しますか?',
    buttons: [{ label: 'キャンセル', value: null }, { label: '削除', danger: true, primary: true, value: true }],
  });
  if(!ok) return;
  rec.deletedAt = now();
  await touchEntry(rec);
  await reloadAll();
  renderAll();
}

// ================= 描画 =================
function renderAll(){
  renderHeader();
  renderTour();
  renderManage();
  updateSettingsView();
  updateSyncBar();
}
function renderCurrent(){
  renderHeader();
  if(S.view === 'tour') renderTour();
  if(S.view === 'manage') renderManage();
  updateSyncBar();
}

function renderHeader(){
  const ev = eventById(S.currentEvent);
  const nameEl = $('#eventName');
  if(nameEl) nameEl.textContent = ev ? ev.name : 'イベント未作成';
  const list = currentEventEntries();
  const done = list.filter(e => e.checked).length;
  const stars = list.filter(e => e.star).length;
  const p = $('#progress');
  if(p) p.textContent = list.length ? `行った ${done}/${list.length}・★${stars}` : '';
}

function updateSyncBar(){
  const bar = $('#syncBar');
  if(!bar) return;
  bar.classList.remove('warn');
  const pend = pendingCount();
  if(!syncConfigured()){
    bar.textContent = '💾 端末内保存のみ(同期は未設定)' + (pend ? ' ・未同期 ' + pend + '件' : '');
    return;
  }
  let t = S.syncing ? '🔄 同期中…' : '☁️ 最終同期 ' + fmtJST(S.lastSyncAt || 0);
  if(pend) t += ' ・未同期 ' + pend + '件';
  if(S.authError){ t += ' ・⚠️ トークンを確認'; bar.classList.add('warn'); }
  bar.textContent = t;
}

function applyFilterSort(list){
  let out = list.slice();
  if(S.filter === 'todo') out = out.filter(e => !e.checked);
  else if(S.filter === 'star') out = out.filter(e => e.star);
  if(S.q){
    const q = nfkcLower(S.q);
    out = out.filter(e => nfkcLower([e.name, e.handle, e.text, e.memo, e.sp].join(' ')).includes(q));
  }
  return out;
}

function cmpEntrySP(a, b){
  const ka = spSortKey(a.sp), kb = spSortKey(b.sp);
  if(!ka && !kb) return (a.addedAt || 0) - (b.addedAt || 0);
  if(!ka) return 1;
  if(!kb) return -1;
  return cmpTuple(ka, kb);
}

function sortListForTour(list){
  const arr = list.slice();
  const spCmp = (a, b) => {
    if(S.sink && a.checked !== b.checked) return a.checked ? 1 : -1;
    return cmpEntrySP(a, b);
  };
  if(S.sort === 'sp') arr.sort(spCmp);
  else if(S.sort === 'added') arr.sort((a, b) => (a.addedAt || 0) - (b.addedAt || 0));
  else if(S.sort === 'star') arr.sort((a, b) => {
    if(a.star !== b.star) return a.star ? -1 : 1;
    return spCmp(a, b);
  });
  return arr;
}

function renderTour(){
  document.querySelectorAll('#filterChips .chip').forEach(c => c.classList.toggle('active', c.dataset.f === S.filter));
  const sortSel = $('#sortSel');
  if(sortSel && sortSel.value !== S.sort) sortSel.value = S.sort;
  const listEl = $('#tourList');
  if(!listEl) return;
  const all = currentEventEntries();
  const view = sortListForTour(applyFilterSort(all));
  listEl.textContent = '';
  if(!all.length){
    listEl.append(el('div', { class: 'empty', text: 'まだ追加がありません。\nXでツイートを共有 →「お品書き追加」\n(または管理タブにURLを貼り付け)' }));
    return;
  }
  if(!view.length){
    listEl.append(el('div', { class: 'empty', text: '条件に合う項目がありません' }));
    return;
  }
  if(S.sort === 'sp'){
    const sections = new Map();
    for(const e of view){
      const sec = sectionOf(e.sp);
      if(!sections.has(sec.label)) sections.set(sec.label, { key: sec.key, items: [] });
      sections.get(sec.label).items.push(e);
    }
    const ordered = Array.from(sections.entries()).sort((a, b) => cmpTuple(a[1].key, b[1].key));
    for(const [label, sec] of ordered){
      listEl.append(el('div', { class: 'sect' },
        el('span', { text: label }),
        el('span', { class: 'cnt', text: sec.items.length + '件' })));
      for(const e of sec.items) listEl.append(renderCard(e));
    }
  }else{
    for(const e of view) listEl.append(renderCard(e));
  }
}

function renderCard(e){
  const card = el('article', { class: 'card' + (e.checked ? ' checked' : ''), 'data-key': e.key });
  const thumb = el('button', { class: 'thumb', title: '画像を拡大' });
  if(e.media && e.media.length){
    const img = el('img', { src: imgUrl(e.media[0], 'small'), alt: '', loading: 'lazy' });
    img.addEventListener('error', () => {
      if(img.dataset.fb !== '1'){ img.dataset.fb = '1'; img.src = e.media[0]; }
      else { img.replaceWith(document.createTextNode('🖼')); }
    });
    thumb.append(img);
    if(e.media.length > 1) thumb.append(el('span', { class: 'tcnt', text: String(e.media.length) }));
  }else{
    thumb.append(document.createTextNode('🖼'));
  }
  thumb.addEventListener('click', () => openLightbox(e));
  card.append(thumb);

  const main = el('div', { class: 'main' });
  const displayName = e.name || (e.enriched ? '(名前なし)' : (now() - (e.addedAt || 0) < 90000 ? '取得中…' : '未取得'));
  main.append(el('div', { class: 'name', text: displayName }));
  if(e.handle) main.append(el('div', { class: 'sub', text: e.handle }));

  const sprow = el('div', { class: 'sprow' });
  sprow.append(el('span', { class: 'badge' + (e.sp ? '' : ' none'), text: e.sp || 'SP未設定' }));
  const editBtn = el('button', { class: 'spedit', text: '✎', title: 'SPを手修正' });
  editBtn.addEventListener('click', () => startSpEdit(card, e));
  sprow.append(editBtn);
  main.append(sprow);

  if(e.text){
    const text = el('div', { class: 'text', text: e.text });
    text.addEventListener('click', () => text.classList.toggle('open'));
    main.append(text);
  }

  const memo = el('textarea', { class: 'memo', rows: '1', placeholder: 'メモ' });
  memo.value = e.memo || '';
  let memoTimer = null;
  memo.addEventListener('input', () => {
    if(memoTimer) clearTimeout(memoTimer);
    memoTimer = setTimeout(async () => {
      const rec = await idbGet('entries', e.key);
      if(!rec) return;
      rec.memo = memo.value;
      await touchEntry(rec);
    }, 450);
  });
  main.append(memo);

  const actions = el('div', { class: 'actions' });
  const btnCheck = el('button', { class: e.checked ? 'on' : '', text: '✔ 行った' });
  btnCheck.addEventListener('click', () => toggleCheck(e.key));
  const btnStar = el('button', { class: 'star' + (e.star ? ' on' : ''), text: '★ 要チェック' });
  btnStar.addEventListener('click', () => toggleStar(e.key));
  actions.append(btnCheck, btnStar);
  const linkBtn = el('button', { class: 'link', text: '🔗', title: '元ツイートを開く' });
  linkBtn.addEventListener('click', () => window.open(e.url, '_blank', 'noopener'));
  actions.append(linkBtn);
  if(!e.enriched){
    const reBtn = el('button', { text: '🔄 取得', title: '情報を再取得' });
    reBtn.addEventListener('click', () => { toast('再取得を試します…'); enqueueEnrich(e.id); });
    actions.append(reBtn);
  }
  main.append(actions);
  card.append(main);
  return card;
}

async function toggleCheck(key){
  const rec = await idbGet('entries', key);
  if(!rec) return;
  rec.checked = !rec.checked;
  rec.checkedAt = rec.checked ? now() : null;
  await touchEntry(rec);
  withVT(() => { renderHeader(); renderTour(); });
  if(rec.checked){
    toast('✔ ' + (rec.name || 'この項目') + ' を行ったにしました', {
      ms: 4000,
      actionLabel: '元に戻す',
      onAction: async () => {
        const r2 = await idbGet('entries', key);
        if(!r2 || !r2.checked) return;
        r2.checked = false;
        r2.checkedAt = null;
        await touchEntry(r2);
        withVT(() => { renderHeader(); renderTour(); });
      },
    });
  }
}

async function toggleStar(key){
  const rec = await idbGet('entries', key);
  if(!rec) return;
  rec.star = !rec.star;
  await touchEntry(rec);
  withVT(() => { renderHeader(); renderTour(); });
}

function startSpEdit(card, e){
  const sprow = card.querySelector('.sprow');
  if(!sprow || sprow.dataset.editing === '1') return;
  sprow.dataset.editing = '1';
  sprow.textContent = '';
  const input = el('input', { type: 'text', value: e.sp || '', placeholder: '例: 西3-15', autocapitalize: 'characters', autocomplete: 'off' });
  input.style.maxWidth = '140px';
  const okBtn = el('button', { class: 'spedit', text: '保存' });
  const cancelBtn = el('button', { class: 'spedit', text: '✕' });
  const commit = async () => {
    const rec = await idbGet('entries', e.key);
    if(rec){
      rec.sp = nfkc(input.value).toUpperCase().trim();
      rec.spManual = true;
      await touchEntry(rec);
    }
    withVT(() => { renderHeader(); renderTour(); });
  };
  okBtn.addEventListener('click', commit);
  cancelBtn.addEventListener('click', () => renderTour());
  input.addEventListener('keydown', (ev) => { if(ev.key === 'Enter') commit(); });
  sprow.append(input, okBtn, cancelBtn);
  input.focus();
}

function openLightbox(e){
  if(!e.media || !e.media.length) return;
  const ov = openOverlay('lightbox');
  const bar = el('div', { id: 'lbBar' });
  const label = el('span', { text: (e.name || '') + (e.media.length > 1 ? ` (${e.media.length}枚)` : '') });
  const closeBtn = el('button', { text: '✕ 閉じる' });
  closeBtn.addEventListener('click', closeOverlay);
  bar.append(label, closeBtn);
  const stage = el('div', { id: 'lbStage' });
  for(const m of e.media){
    const img = el('img', { src: imgUrl(m, 'large'), alt: '' });
    img.addEventListener('error', () => {
      if(img.dataset.fb !== '1'){ img.dataset.fb = '1'; img.src = m; }
    });
    stage.append(img);
  }
  ov.append(bar, stage);
  ov.onclick = (ev2) => { if(ev2.target === ov) closeOverlay(); };
}

function renderManage(){
  const box = $('#eventAdminList');
  if(box){
    box.textContent = '';
    if(!S.events.length) box.append(el('div', { class: 'hint', text: 'イベントがまだありません' }));
    for(const ev of S.events){
      const row = el('div', { class: 'erow' });
      row.append(el('span', { class: 'grow', text: ev.name + (ev.id === S.currentEvent ? ' (選択中)' : '') }));
      const btnUse = el('button', { class: 'mini', text: '切替' });
      btnUse.addEventListener('click', async () => { await mset('currentEvent', ev.id); await reloadAll(); renderAll(); });
      const btnRename = el('button', { class: 'mini', text: '改名' });
      btnRename.addEventListener('click', () => renameEvent(ev.id));
      const btnDel = el('button', { class: 'mini', text: '削除' });
      btnDel.addEventListener('click', () => deleteEvent(ev.id));
      row.append(btnUse, btnRename, btnDel);
      box.append(row);
    }
  }
  const mlist = $('#manageList');
  if(mlist){
    mlist.textContent = '';
    const items = currentEventEntries().slice().sort(cmpEntrySP);
    if(!items.length) mlist.append(el('div', { class: 'hint', text: 'このイベントにはまだ登録がありません' }));
    for(const e of items){
      const row = el('div', { class: 'erow' + (e.checked ? ' done' : '') });
      row.append(el('span', { class: 'grow', text: (e.checked ? '✔ ' : '') + (e.name || '取得中…') + (e.sp ? '  [' + e.sp + ']' : '') }));
      const btnMove = el('button', { class: 'mini', text: '移動' });
      btnMove.addEventListener('click', async () => {
        const target = await pickEvent({ title: '移動先のイベント' });
        if(target && target !== e.eventId) await moveEntryTo(e.key, target);
      });
      const btnDel = el('button', { class: 'mini', text: '削除' });
      btnDel.addEventListener('click', () => softDeleteEntry(e.key));
      row.append(btnMove, btnDel);
      mlist.append(row);
    }
  }
}

function updateSettingsView(){
  const view = $('#view-settings');
  if(!view || view.classList.contains('hidden')) return;
  const cfg = S.cfg;
  const owner = $('#stOwner'), repo = $('#stRepo'), pat = $('#stPat');
  if(owner && document.activeElement !== owner) owner.value = cfg.owner || '';
  if(repo && document.activeElement !== repo) repo.value = cfg.repo || '';
  if(pat) pat.placeholder = cfg.pat ? '保存済み(変更する場合のみ入力)' : 'github_pat_…';
  const st = $('#stStatus');
  if(st){
    st.textContent =
      (syncConfigured() ? '設定: ' + cfg.owner + '/' + cfg.repo : '未設定') +
      ' ・ 最終同期: ' + fmtJST(S.lastSyncAt || 0) +
      ' ・ 未同期: ' + pendingCount() + '件' +
      (S.authError ? ' ・ ⚠️ トークンエラー(再作成が必要かも)' : '');
  }
  const log = $('#stLog');
  if(log){
    mget('conflictLog').then((rows) => {
      log.textContent = '';
      const arr = rows || [];
      if(!arr.length){ log.append(el('div', { text: '競合はありません' })); return; }
      for(const r of arr.slice().reverse()) log.append(el('div', { text: fmtJST(r.at) + ' ' + r.text }));
    });
  }
  const exp = $('#stExportInfo');
  if(exp){
    mget('lastExportAt').then((t) => {
      exp.textContent = t ? '最終エクスポート: ' + fmtJST(t) : 'まだエクスポートしていません(1ヶ月に1回がおすすめ)';
    });
  }
  const ver = $('#stVersion');
  if(ver) ver.textContent = 'お品書き帳 ' + APP_VERSION + ' / データスキーマ v' + DATA_VERSION + ' / ' + (S.deviceId || '');
  refreshCacheInfo();
}

async function refreshCacheInfo(){
  const box = $('#stCacheInfo');
  if(!box || $('#view-settings').classList.contains('hidden')) return;
  try{
    const cache = await caches.open(IMG_CACHE_NAME);
    const keys = await cache.keys();
    let est = '';
    if(navigator.storage && navigator.storage.estimate){
      const e = await navigator.storage.estimate();
      est = ' ・使用量 約' + Math.round((e.usage || 0) / 1048576 * 10) / 10 + 'MB';
    }
    box.textContent = '画像キャッシュ: ' + keys.length + '枚' + est;
  }catch(err){ box.textContent = '画像キャッシュ: 取得できません'; }
}

// ================= 一括追加 / 先読み / コピー =================
async function bulkAdd(){
  const ta = $('#bulkText');
  const lines = (ta.value || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  if(!lines.length){ toast('URLを貼り付けてください'); return; }
  let ok = 0, dup = 0, bad = 0;
  for(const line of lines){
    const r = await addFromInput(line);
    if(r.error) bad++;
    else if(r.dup) dup++;
    else ok++;
  }
  ta.value = '';
  await reloadAll();
  renderAll();
  toast(`追加 ${ok}件${dup ? ' ・ 追加済み ' + dup + '件' : ''}${bad ? ' ・ 認識不可 ' + bad + '件' : ''}`);
}

async function prefetchAll(){
  const btn = $('#prefetchBtn');
  const info = $('#prefetchInfo');
  if(S.prefetchRunning){ S.prefetchCancel = true; return; }
  const targets = new Set();
  for(const e of currentEventEntries()) for(const m of (e.media || [])) targets.add(imgUrl(m, 'small'));
  const urls = Array.from(targets);
  if(!urls.length){ toast('先読みする画像がありません'); return; }
  S.prefetchRunning = true;
  S.prefetchCancel = false;
  btn.textContent = 'キャンセル';
  let done = 0;
  const cache = await caches.open(IMG_CACHE_NAME);
  for(const u of urls){
    if(S.prefetchCancel) break;
    try{
      const hit = await cache.match(u);
      if(!hit){
        await new Promise((resolve) => {
          const img = new Image();
          let settled = false;
          const fin = () => { if(!settled){ settled = true; resolve(); } };
          img.onload = fin;
          img.onerror = fin;
          img.src = u;
          setTimeout(fin, 12000);
        });
      }
    }catch(err){ /* ignore */ }
    done++;
    if(done % 5 === 0 || done === urls.length) info.textContent = `先読み中… ${done}/${urls.length}枚`;
  }
  S.prefetchRunning = false;
  btn.textContent = '全件先読み';
  info.textContent = `先読み: ${done}/${urls.length}枚 完了`;
  refreshCacheInfo();
}

async function copyText(text){
  try{
    await navigator.clipboard.writeText(text);
    toast('コピーしました ✓');
  }catch(err){
    const ta = el('textarea');
    ta.value = text;
    document.body.append(ta);
    ta.select();
    try{ document.execCommand('copy'); toast('コピーしました ✓'); }catch(e2){ toast('コピーできませんでした'); }
    ta.remove();
  }
}

// ================= バックアップ(エクスポート/インポート) =================
async function exportJson(){
  const eventsAll = await idbAll('events');
  const entriesAll = await idbAll('entries');
  const dump = { app: 'ohogaki', version: DATA_VERSION, exportedAt: now(), events: eventsAll, entries: entriesAll };
  const dd = new Date(), pp = (n) => String(n).padStart(2, '0');
  const fname = 'ohogaki_backup_' + dd.getFullYear() + pp(dd.getMonth() + 1) + pp(dd.getDate()) + '.json';
  const blob = new Blob([JSON.stringify(dump, null, 1)], { type: 'application/json' });
  const a = el('a', { href: URL.createObjectURL(blob), download: fname });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 5000);
  await mset('lastExportAt', now());
  updateSettingsView();
  toast('エクスポートしました ✓');
}

async function importJsonText(text){
  let dump = null;
  try{ dump = JSON.parse(text); }catch(err){ toast('JSONを読み込めませんでした'); return; }
  if(!dump || !dump.events || !dump.entries){ toast('お品書き帳のバックアップ形式ではありません'); return; }
  let n = 0;
  for(const ev of dump.events){
    if(!ev || !ev.id) continue;
    const lev = await idbGet('events', ev.id);
    if(!lev || winnerIsA(ev, lev)){
      await idbPut('events', {
        id: ev.id, name: ev.name, createdAt: ev.createdAt || 0,
        updatedAt: ev.updatedAt || 0, updatedBy: ev.updatedBy || '',
        deletedAt: ev.deletedAt || null, dirty: 1,
      });
      n++;
    }
  }
  for(const e of dump.entries){
    if(!e || !e.id || !e.eventId) continue;
    const key = e.eventId + '|' + e.id;
    const l = await idbGet('entries', key);
    if(!l || winnerIsA(e, l)){
      await idbPut('entries', Object.assign(stripLocal(e), { key, eventId: e.eventId, id: e.id, dirty: 1 }));
      n++;
    }
  }
  await reloadAll();
  renderAll();
  schedulePush();
  toast('インポートしました(' + n + '件反映)');
}

// ================= 診断 =================
async function runDiagnostics(){
  const out = $('#stDiagOut');
  out.textContent = '';
  const add = (ok, text) => out.append(el('div', { class: ok === null ? '' : (ok ? 'ok' : 'ng'), text: (ok === null ? 'ℹ️ ' : (ok ? '✅ ' : '❌ ')) + text }));

  let pass = 0;
  const fails = [];
  for(const t of SP_TESTS){
    const r = parseSP(t[0]);
    const got = r ? r.sp : null;
    if(got === t[1]) pass++;
    else fails.push(`「${t[0]}」→「${got}」(期待: ${t[1]})`);
  }
  add(fails.length === 0, `SPパーサ: ${pass}/${SP_TESTS.length} OK`);
  for(const f of fails) add(false, '  ' + f);

  try{
    const evs = await idbAll('events');
    const ents = await idbAll('entries');
    add(true, 'IndexedDB: イベント' + evs.length + '件 / エントリ' + ents.length + '件');
  }catch(err){ add(false, 'IndexedDB: ' + err.message); }
  try{
    const cache = await caches.open(IMG_CACHE_NAME);
    const keys = await cache.keys();
    add(true, '画像キャッシュ: ' + keys.length + '枚');
  }catch(err){ add(false, '画像キャッシュ: ' + err.message); }
  if(navigator.storage && navigator.storage.estimate){
    try{
      const e = await navigator.storage.estimate();
      add(true, 'ストレージ: 使用 約' + Math.round((e.usage || 0) / 1048576 * 10) / 10 + 'MB / 上限 約' + Math.round((e.quota || 0) / 1048576) + 'MB');
    }catch(err){ /* ignore */ }
  }

  const sample = S.entries.find(e => !e.deletedAt && e.id);
  if(sample){
    try{
      const j = await fxFetch(sample.id);
      add(!!(j && j.tweet), 'fxtwitter: OK(' + ((j.tweet.author && j.tweet.author.name) || '') + ')');
    }catch(err){ add(false, 'fxtwitter: ' + err.message); }
  }else{
    add(null, 'fxtwitter: エントリが無いためスキップ');
  }

  if(syncConfigured()){
    try{
      const files = await ghList('events');
      add(true, 'GitHub: 読み取りOK(' + ((files || []).length) + 'ファイル)');
    }catch(err){ add(false, 'GitHub: ' + err.message); }
  }else{
    add(null, 'GitHub: 未設定のためスキップ');
  }

  try{
    const regs = await navigator.serviceWorker.getRegistrations();
    add(regs.length > 0, 'Service Worker: ' + (regs.length ? '登録済み' : '未登録'));
  }catch(err){ add(false, 'Service Worker: ' + err.message); }
}

// ================= 同期セットアップ =================
async function saveAndTest(){
  const res = $('#stTestResult');
  res.textContent = '';
  const add = (ok, text) => res.append(el('div', { class: ok === null ? '' : (ok ? 'ok' : 'ng'), text: (ok === null ? 'ℹ️ ' : (ok ? '✅ ' : '❌ ')) + text }));
  const owner = $('#stOwner').value.trim();
  const repo = $('#stRepo').value.trim();
  const pat = $('#stPat').value.trim();
  if(!owner || !repo){ add(false, 'ユーザー名とリポジトリ名を入力してください'); return; }
  const cfg = Object.assign({}, S.cfg, { owner, repo });
  if(pat) cfg.pat = pat;
  if(!cfg.pat){ add(false, 'トークンを入力してください'); return; }
  S.cfg = cfg;

  try{
    const r = await fetch(apiBase() + '/repos/' + owner + '/' + repo, { headers: ghHeaders(), cache: 'no-store' });
    if(r.status === 404){ add(false, 'リポジトリが見つかりません(名前を確認してください)'); return; }
    if(r.status === 401 || r.status === 403){ add(false, 'トークンが無効か権限不足です(' + r.status + ')'); return; }
    if(!r.ok){ add(false, 'リポジトリ確認エラー(' + r.status + ')'); return; }
    const j = await r.json();
    add(true, 'リポジトリOK: ' + j.full_name + (j.private ? '(非公開)' : ''));
    if(!j.private) add(false, '⚠️ 公開リポジトリです!データが誰でも見られる状態になります。非公開にするのを強く推奨します');
  }catch(err){ add(false, '通信エラー: ' + err.message); return; }

  const w = await ensureSettingsFile();
  if(w !== 'ok'){ add(false, '書き込み失敗: ' + w); return; }
  add(true, '書き込みOK(settings.json)');

  saveCfg(S.cfg);
  updateSettingsView();
  const okSync = await syncNow({ manual: false });
  add(okSync, okSync ? '初回同期OK' : '初回同期に失敗(あとで自動再試行します)');
  if(okSync) toast('同期設定を保存しました ✓');
}

async function clearImgCache(){
  const ok = await dialog({
    title: '画像キャッシュを消す',
    message: '一度見た画像の保存データを消します(次回表示時に再取得します)',
    buttons: [{ label: 'キャンセル', value: null }, { label: '消す', danger: true, primary: true, value: true }],
  });
  if(!ok) return;
  await caches.delete(IMG_CACHE_NAME);
  refreshCacheInfo();
  toast('画像キャッシュを消しました');
}

// ================= 起動パラメータ(?add=) =================
async function handleAddParam(){
  const params = new URLSearchParams(location.search);
  const add = params.get('add');
  if(!add) return;
  history.replaceState(null, '', location.pathname);
  const r = await addFromInput(add);
  if(r.error){
    toast('URLからツイートIDを認識できませんでした');
    return;
  }
  await renderAll();
  if(r.dup){
    toast('追加済み ✓');
    flashEntry(r.entry.key);
  }else{
    await showAddToast(r);
    flashEntry(r.entry.key);
    if(window.opener){ setTimeout(() => { try{ window.close(); }catch(err){ /* ignore */ } }, 1800); }
  }
}

function flashEntry(key){
  showTab('tour');
  const card = document.querySelector('.card[data-key="' + CSS.escape(key) + '"]');
  if(card){
    card.scrollIntoView({ block: 'center', behavior: 'smooth' });
    card.classList.add('flash');
    setTimeout(() => card.classList.remove('flash'), 2600);
  }
}

function showTab(name){
  S.view = name;
  for(const v of ['tour', 'manage', 'settings']){
    const sec = document.getElementById('view-' + v);
    if(sec) sec.classList.toggle('hidden', v !== name);
  }
  document.querySelectorAll('#tabbar button').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  if(name === 'tour') renderTour();
  if(name === 'manage') renderManage();
  if(name === 'settings') updateSettingsView();
}

// ================= UI結線 =================
function bindUI(){
  document.querySelectorAll('#tabbar button').forEach(b => b.addEventListener('click', () => showTab(b.dataset.tab)));
  $('#eventBtn').addEventListener('click', async () => {
    const target = await pickEvent({ title: 'イベントを切替' });
    if(target){ await mset('currentEvent', target); await reloadAll(); renderAll(); }
  });
  $('#search').addEventListener('input', (e) => { S.q = e.target.value; renderTour(); });
  document.querySelectorAll('#filterChips .chip').forEach(c => c.addEventListener('click', () => { S.filter = c.dataset.f; renderTour(); }));
  $('#sortSel').addEventListener('change', (e) => { S.sort = e.target.value; renderTour(); });
  $('#bulkAdd').addEventListener('click', bulkAdd);
  $('#newEventBtn').addEventListener('click', async () => {
    const name = await dialog({ title: '新しいイベント', input: true, placeholder: '例: C123', buttons: [{ label: 'キャンセル', value: null }, { label: '作成', primary: true }] });
    if(!name) return;
    await createEvent(String(name).trim());
    await reloadAll();
    renderAll();
    toast('イベントを作成しました ✓');
  });
  $('#prefetchBtn').addEventListener('click', prefetchAll);
  $('#stSaveTest').addEventListener('click', saveAndTest);
  $('#stPull').addEventListener('click', async () => {
    if(!syncConfigured()){ toast('先に同期設定をしてください'); return; }
    S.syncing = true;
    updateSyncBar();
    try{
      const n = await pullMerge();
      S.lastSyncAt = now();
      await mset('lastSyncAt', S.lastSyncAt);
      await reloadAll();
      renderAll();
      toast('読み込み完了(' + n + 'イベント)');
    }catch(err){ toast('読み込み失敗: ' + err.message); }
    finally{ S.syncing = false; updateSyncBar(); }
  });
  $('#stPush').addEventListener('click', () => syncNow({ manual: true }));
  $('#stReset').addEventListener('click', async () => {
    const ok = await dialog({
      title: '同期設定をリセット',
      message: 'トークン・リポジトリ設定をこの端末から消します(データは消えません)',
      buttons: [{ label: 'キャンセル', value: null }, { label: 'リセット', danger: true, primary: true, value: true }],
    });
    if(!ok) return;
    localStorage.removeItem(LS_KEY);
    S.cfg = {};
    S.authError = false;
    updateSettingsView();
    updateSyncBar();
    toast('リセットしました');
  });
  $('#copyShortcut').addEventListener('click', () => copyText($('#guideText').textContent));
  $('#copyBookmarklet').addEventListener('click', () => copyText($('#bmCode').textContent));
  $('#stExport').addEventListener('click', exportJson);
  $('#stImportBtn').addEventListener('click', () => $('#stImportFile').click());
  $('#stImportFile').addEventListener('change', async (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    if(!f) return;
    const text = await f.text();
    await importJsonText(text);
  });
  $('#stImportPaste').addEventListener('click', async () => {
    const text = await dialog({ title: '貼り付けでインポート', message: 'バックアップJSONの中身を貼り付けてください', textarea: true, buttons: [{ label: 'キャンセル', value: null }, { label: 'インポート', primary: true }] });
    if(text) await importJsonText(text);
  });
  $('#stDiagBtn').addEventListener('click', runDiagnostics);
  $('#stCacheClear').addEventListener('click', clearImgCache);
  $('#stSinkToggle').addEventListener('change', async (e) => { S.sink = !!e.target.checked; await mset('sink', S.sink); renderTour(); });
}

// ================= Service Worker =================
function registerSW(){
  if(!('serviceWorker' in navigator)) return;
  let userAskedUpdate = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if(userAskedUpdate) location.reload(); });
  const doRegister = async () => {
    try{
      const reg = await navigator.serviceWorker.register('sw.js');
      const showUpdate = (worker) => {
        toast('新しいバージョンがあります', {
          sticky: true,
          actionLabel: '更新',
          onAction: () => { userAskedUpdate = true; worker.postMessage({ type: 'SKIP_WAITING' }); },
        });
      };
      if(reg.waiting && navigator.serviceWorker.controller) showUpdate(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const w = reg.installing;
        if(!w) return;
        w.addEventListener('statechange', () => {
          if(w.state === 'installed' && navigator.serviceWorker.controller) showUpdate(w);
        });
      });
    }catch(err){ /* SW登録失敗は致命的ではない */ }
  };
  if(document.readyState === 'complete') doRegister();
  else window.addEventListener('load', doRegister);
}

// ================= 起動 =================
async function boot(){
  S.deviceId = await mget('deviceId');
  if(!S.deviceId){ S.deviceId = uid('dev_'); await mset('deviceId', S.deviceId); }
  const sinkMeta = await mget('sink');
  S.sink = sinkMeta === undefined ? true : !!sinkMeta;
  S.lastSyncAt = (await mget('lastSyncAt')) || 0;
  await reloadAll();
  bindUI();
  const sinkToggle = $('#stSinkToggle');
  if(sinkToggle) sinkToggle.checked = S.sink;
  renderAll();
  handleAddParam();
  registerSW();
  if(navigator.onLine) retryPendingEnrich();
  if(syncConfigured()) syncNow({});
  setInterval(() => {
    if(document.visibilityState === 'visible' && syncConfigured() && now() - (S.lastSyncAt || 0) > 5 * 60 * 1000) syncNow({});
  }, 60000);
  document.addEventListener('visibilitychange', () => {
    if(document.visibilityState === 'visible' && syncConfigured() && now() - (S.lastSyncAt || 0) > 60000) syncNow({});
  });
  window.addEventListener('online', () => {
    if(syncConfigured()) syncNow({});
    retryPendingEnrich();
  });
  if(navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  const lastExp = await mget('lastExportAt');
  if(!lastExp && S.entries.length > 0){
    setTimeout(() => toast('そろそろバックアップを(設定タブ→エクスポート)', { ms: 6000 }), 4000);
  }else if(lastExp && now() - lastExp > 30 * 86400000){
    setTimeout(() => toast('1ヶ月以上エクスポートしていません(設定タブ)', { ms: 6000 }), 4000);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  boot().catch(err => {
    console.error(err);
    toast('起動エラー: ' + (err && err.message ? err.message : err));
  });
});
})();
