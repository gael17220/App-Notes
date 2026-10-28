'use strict';

/* =========================================================
   AppNotes — notes libres + matrice d'Eisenhower
   Données : localStorage (toujours) + fichier JSON dans un
   dépôt GitHub privé (si les réglages sont remplis).
   Images : Cache Storage local + dossier images/ du dépôt.
   ========================================================= */

const LISTS = ['notes', 'q1', 'q2', 'q3', 'q4'];
const LIST_NAMES = { notes: 'Notes', q1: 'Faire', q2: 'Planifier', q3: 'Déléguer', q4: 'Éliminer' };
const TYPES = { h1: 'Titre', h2: 'Sous-titre', text: 'Texte', bullet: 'Liste', check: 'Checklist' };
const PLACEHOLDERS = { h1: 'Titre', h2: 'Sous-titre', text: 'Écris…', bullet: 'Élément', check: 'Tâche' };
// Raccourcis tapés en début de ligne (l'ordre compte)
const SHORTCUTS = [
  [/^-\s?\[\s?\]\s/, 'check'],
  [/^\[\s?\]\s/, 'check'],
  [/^##\s/, 'h2'],
  [/^#\s/, 'h1'],
  [/^[-*•]\s/, 'bullet'],
];

const KEY_STATE = 'appnotes.state';
const KEY_META = 'appnotes.meta';
const KEY_SETTINGS = 'appnotes.settings';
const KEY_VIEW = 'appnotes.view';
const KEY_COLLAPSED = 'appnotes.collapsed';
const KEY_THEME = 'appnotes.theme';
const KEY_WS = 'appnotes.workspace';

const $ = (sel, root = document) => root.querySelector(sel);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const mk = (type, text = '', done = false) => ({ id: uid(), type, text, done });
const isDone = b => b.type === 'check' && b.done;

function readJSON(key, fallback) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
}
function writeJSON(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* stockage indisponible */ }
}

/* ---------------- Texte enrichi (gras, italique, liens) ---------------- */

const escapeHtml = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const URL_RE = /\bhttps?:\/\/[^\s<]+[^\s<.,;:!?)\]'"]/g;
const linkify = plain => escapeHtml(plain).replace(URL_RE, url => `<a href="${url}">${url}</a>`);
const safeHref = href => /^(https?:|mailto:)/i.test(href);

/** Ne garde que <b>, <i>, <a href> et <br> : tout le reste devient du texte. */
function sanitize(html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  const out = document.createElement('div');
  cleanInto(tpl.content, out);
  while (out.lastChild?.nodeName === 'BR') out.lastChild.remove();
  return out.innerHTML;
}

function cleanInto(src, dst) {
  for (const n of src.childNodes) {
    if (n.nodeType === Node.TEXT_NODE) { dst.append(n.data); continue; }
    if (n.nodeType !== Node.ELEMENT_NODE) continue;
    const tag = n.tagName;
    if (tag === 'BR') { dst.append(document.createElement('br')); continue; }
    if (tag === 'DIV' || tag === 'P') {
      if (dst.childNodes.length) dst.append(document.createElement('br'));
      cleanInto(n, dst);
      continue;
    }
    let wrap = null;
    const weight = n.style?.fontWeight;
    if (tag === 'B' || tag === 'STRONG' || weight === 'bold' || Number(weight) >= 600) wrap = document.createElement('b');
    else if (tag === 'I' || tag === 'EM' || n.style?.fontStyle === 'italic') wrap = document.createElement('i');
    else if (tag === 'A' && safeHref(n.getAttribute('href') || '')) {
      wrap = document.createElement('a');
      wrap.setAttribute('href', n.getAttribute('href'));
    }
    if (wrap) { cleanInto(n, wrap); if (wrap.childNodes.length) dst.append(wrap); }
    else cleanInto(n, dst);
  }
}

function textOf(html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  return tpl.content.textContent;
}

/* ---------------- État ---------------- */

const emptyLists = () => ({ notes: [], q1: [], q2: [], q3: [], q4: [] });
const newWorkspace = name => ({ id: uid(), name, lists: emptyLists() });

function defaultState() {
  const ws = newWorkspace('Perso');
  ws.lists.notes = [
    mk('h1', 'Bienvenue'),
    mk('text', 'Écris librement ici. Tape « # » pour un titre, « ## » pour un sous-titre, « - » pour une liste et « [] » pour une case à cocher. Sélectionne du texte pour le mettre en <b>gras</b> ou en <i>italique</i>, ou colle une image.'),
    mk('text', 'Crée tes espaces de travail (Perso, École…) avec le + des onglets en haut.'),
    mk('check', 'Glisse-moi dans la matrice avec la poignée ⋮⋮'),
    mk('check', 'Une tâche terminée', true),
  ];
  return { version: 3, updatedAt: 0, workspaces: [ws] };
}

function normalize(s) {
  if (!s || typeof s !== 'object') return null;
  // v1 : texte brut → v2 : HTML limité
  if (s.lists && (!s.version || s.version < 2)) {
    for (const k of LISTS) for (const b of s.lists[k] || []) b.text = escapeHtml(b.text || '').replace(/\n/g, '<br>');
  }
  // v2 : une seule page → v3 : espaces de travail
  if (s.lists && !s.workspaces) {
    s.workspaces = [{ id: uid(), name: 'Perso', lists: s.lists }];
    delete s.lists;
  }
  if (!Array.isArray(s.workspaces) || !s.workspaces.length) return null;
  s.version = 3;
  for (const ws of s.workspaces) {
    ws.name = ws.name || 'Sans nom';
    ws.lists = ws.lists || {};
    for (const k of LISTS) if (!Array.isArray(ws.lists[k])) ws.lists[k] = [];
    // Les tâches réalisées de la matrice vivent dans les Notes
    for (const k of LISTS.slice(1)) {
      const done = ws.lists[k].filter(isDone);
      if (!done.length) continue;
      ws.lists[k] = ws.lists[k].filter(b => !isDone(b));
      done.forEach(b => { b.from = k; });
      ws.lists.notes.push(...done);
    }
    LISTS.forEach(k => partition(ws.lists[k]));
  }
  s.updatedAt = s.updatedAt || 0;
  return s;
}

/** Les tâches réalisées restent toujours en bas de leur liste. Renvoie true si l'ordre a changé. */
function partition(list) {
  const sorted = [...list.filter(b => !isDone(b)), ...list.filter(isDone)];
  if (sorted.every((b, i) => b === list[i])) return false;
  list.splice(0, list.length, ...sorted);
  return true;
}

let state = normalize(readJSON(KEY_STATE, null)) || defaultState();
let meta = readJSON(KEY_META, { sha: null, dirty: false, pendingImages: [] });
let settings = readJSON(KEY_SETTINGS, null);
let activeId = null;
const collapsed = new Set(readJSON(KEY_COLLAPSED, []));
const collapseKey = k => `${cur().id}:${k}`;

// L'espace affiché est propre à chaque appareil (il n'est pas synchronisé)
let currentWs = null;
try { currentWs = localStorage.getItem(KEY_WS); } catch { /* rien */ }

/** Espace de travail affiché. */
function cur() {
  return state.workspaces.find(w => w.id === currentWs) || state.workspaces[0];
}

function saveMeta() { writeJSON(KEY_META, meta); }

/** À appeler après chaque modification de `state`. */
function commit() {
  const moved = LISTS.filter(k => partition(cur().lists[k]));
  state.updatedAt = Date.now();
  writeJSON(KEY_STATE, state);
  meta.dirty = true;
  saveMeta();
  sync.editVersion++;
  sync.schedule();
  if (moved.length) keepFocus(() => moved.forEach(renderList));
  renderWsTabs(); // compteurs de tâches à jour
}

function find(id) {
  for (const k of LISTS) {
    const list = cur().lists[k];
    const i = list.findIndex(b => b.id === id);
    if (i !== -1) return { k, i, b: list[i], list };
  }
  return null;
}

const activeCount = k => cur().lists[k].filter(b => !isDone(b)).length;

/* ---------------- Rendu ---------------- */

const listEl = k => $(`.blocklist[data-list="${k}"]`);

function blockEl(b) {
  const el = document.createElement('div');
  el.dataset.id = b.id;

  const handle = document.createElement('span');
  handle.className = 'handle';
  handle.textContent = '⋮⋮';
  handle.title = 'Glisser pour déplacer · Cliquer pour le menu';
  el.append(handle);

  if (b.type === 'image') {
    el.className = 'block type-image';
    const wrap = document.createElement('div');
    wrap.className = 'image-wrap';
    wrap.tabIndex = 0;
    const img = document.createElement('img');
    img.alt = '';
    img.draggable = false;
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'img-del';
    del.title = 'Supprimer l\'image';
    del.setAttribute('aria-label', 'Supprimer l\'image');
    del.textContent = '×';
    wrap.append(img, del);
    el.append(wrap);
    imageURL(b.src).then(url => {
      if (url) img.src = url; else wrap.classList.add('missing');
    });
    return el;
  }

  const text = document.createElement('div');
  text.className = 'text';
  text.contentEditable = 'true';
  text.spellcheck = true;
  text.innerHTML = sanitize(b.text);
  el.append(text);

  decorate(el, b);
  return el;
}

/** Met à jour l'apparence d'un bloc (type, case cochée) sans toucher au texte en cours d'édition. */
function decorate(el, b) {
  el.className = `block type-${b.type}` + (isDone(b) ? ' done' : '');
  const text = el.querySelector('.text');
  if (!text) return;
  text.dataset.placeholder = PLACEHOLDERS[b.type] || '';
  el.querySelector('.marker')?.remove();
  el.querySelector('.del')?.remove();

  if (isDone(b)) {
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'del';
    del.title = 'Supprimer';
    del.setAttribute('aria-label', 'Supprimer');
    del.textContent = '×';
    el.append(del);
  }
  if (b.type !== 'check' && b.type !== 'bullet') return;

  const marker = document.createElement('span');
  marker.className = 'marker';
  if (b.type === 'check') {
    const box = document.createElement('button');
    box.type = 'button';
    box.className = 'checkbox';
    box.setAttribute('aria-label', b.done ? 'Décocher' : 'Cocher');
    marker.append(box);
  } else {
    const dot = document.createElement('span');
    dot.className = 'bullet-dot';
    marker.append(dot);
  }
  el.insertBefore(marker, text);
}

function doneHeader(k, count) {
  const el = document.createElement('div');
  el.className = 'done-header';
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'done-toggle';
  toggle.dataset.list = k;
  toggle.textContent = `${collapsed.has(collapseKey(k)) ? '▸' : '▾'} Tâches réalisées (${count})`;
  const clear = document.createElement('button');
  clear.type = 'button';
  clear.className = 'done-clear';
  clear.dataset.list = k;
  clear.textContent = 'Tout supprimer';
  el.append(toggle, clear);
  return el;
}

function renderList(k) {
  const list = cur().lists[k];
  const done = list.filter(isDone).length;
  const els = [];
  list.forEach((b, i) => {
    if (done && i === list.length - done) els.push(doneHeader(k, done));
    els.push(blockEl(b));
  });
  const c = listEl(k);
  c.replaceChildren(...els);
  c.classList.toggle('done-collapsed', collapsed.has(collapseKey(k)));
}

function renderAll() {
  LISTS.forEach(renderList);
  renderWsTabs();
  document.title = `${cur().name} · AppNotes`;
  updateToolbar();
}

function rerenderBlock(id) {
  const f = find(id);
  const el = document.querySelector(`.block[data-id="${id}"]`);
  if (!f || !el) return;
  decorate(el, f.b);
  const text = el.querySelector('.text');
  if (text && sanitize(text.innerHTML) !== f.b.text) text.innerHTML = sanitize(f.b.text);
}

/** Exécute `fn` (qui re-rend des listes) en gardant le curseur où il était. */
function keepFocus(fn) {
  const t = document.activeElement?.closest?.('.text');
  const id = t?.closest('.block')?.dataset.id;
  const off = t ? caretOffset(t) : 0;
  fn();
  if (!id || !find(id)) return;
  const nt = document.querySelector(`.block[data-id="${id}"] .text`);
  if (nt && nt !== t) placeCaret(nt, off);
}

/* ---------------- Curseur ---------------- */

function caretOffset(el) {
  const sel = getSelection();
  if (!sel.rangeCount) return 0;
  const r = sel.getRangeAt(0);
  if (!el.contains(r.startContainer)) return 0;
  const pre = r.cloneRange();
  pre.selectNodeContents(el);
  pre.setEnd(r.startContainer, r.startOffset);
  return pre.toString().length;
}

function selectionCollapsed() {
  const sel = getSelection();
  return sel.rangeCount > 0 && sel.getRangeAt(0).collapsed;
}

function placeCaret(el, offset) {
  el.focus({ preventScroll: false });
  const sel = getSelection();
  const r = document.createRange();
  let rest = offset;
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    if (rest <= node.length) {
      r.setStart(node, rest);
      r.collapse(true);
      sel.removeAllRanges();
      sel.addRange(r);
      return;
    }
    rest -= node.length;
  }
  r.selectNodeContents(el);
  r.collapse(false);
  sel.removeAllRanges();
  sel.addRange(r);
}

function focusBlock(id, offset = 0) {
  const block = document.querySelector(`.block[data-id="${id}"]`);
  if (!block) return;
  const t = block.querySelector('.text');
  if (t) placeCaret(t, offset === 'end' ? t.textContent.length : offset);
  else block.querySelector('.image-wrap')?.focus();
  block.scrollIntoView({ block: 'nearest' });
}

/* ---------------- Édition ---------------- */

function blockFromEvent(e) {
  const t = e.target.closest?.('.text');
  if (!t) return null;
  const f = find(t.closest('.block').dataset.id);
  return f ? { t, ...f } : null;
}

function matchShortcut(txt) {
  for (const [re, type] of SHORTCUTS) {
    const m = txt.match(re);
    if (m) return { type, len: m[0].length };
  }
  return null;
}

document.addEventListener('input', e => {
  const ctx = blockFromEvent(e);
  if (!ctx) return;
  const { t, b } = ctx;
  const sc = b.type === 'text' && !e.isComposing ? matchShortcut(t.textContent) : null;
  if (sc) {
    // On efface le raccourci dans le premier nœud texte pour que le curseur suive la frappe
    const node = document.createTreeWalker(t, NodeFilter.SHOW_TEXT).nextNode();
    if (node && node.data.length >= sc.len) {
      node.deleteData(0, sc.len);
      const r = document.createRange();
      r.setStart(node, 0);
      r.collapse(true);
      getSelection().removeAllRanges();
      getSelection().addRange(r);
    }
    b.type = sc.type;
    b.text = sanitize(t.innerHTML);
    commit();
    rerenderBlock(b.id);
    updateToolbar();
    return;
  }
  b.text = sanitize(t.innerHTML);
  commit();
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { closeMenu(); closeWsMenu(); }

  // Bloc image sélectionné
  const wrap = e.target.closest?.('.image-wrap');
  if (wrap) {
    const f = find(wrap.closest('.block').dataset.id);
    if (!f) return;
    if (e.key === 'Backspace' || e.key === 'Delete') {
      e.preventDefault();
      const neighbour = f.list[f.i - 1] || f.list[f.i + 1];
      deleteBlock(f.b.id);
      if (neighbour) focusBlock(neighbour.id, 'end');
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const nb = mk('text');
      f.list.splice(f.i + 1, 0, nb);
      commit();
      renderList(f.k);
      focusBlock(nb.id);
    } else if (e.key === 'ArrowUp' && f.i > 0) {
      e.preventDefault();
      focusBlock(f.list[f.i - 1].id, 'end');
    } else if (e.key === 'ArrowDown' && f.i < f.list.length - 1) {
      e.preventDefault();
      focusBlock(f.list[f.i + 1].id, 0);
    }
    return;
  }

  const ctx = blockFromEvent(e);
  if (!ctx || e.isComposing) return;
  const { t, k, i, b, list } = ctx;
  const mod = e.metaKey || e.ctrlKey;

  if (mod && !e.shiftKey && !e.altKey) {
    const key = e.key.toLowerCase();
    if (key === 'b') { e.preventDefault(); format('bold'); return; }
    if (key === 'i') { e.preventDefault(); format('italic'); return; }
    if (key === 'k') { e.preventDefault(); makeLink(); return; }
    if (e.key === 'Enter') {
      if (b.type === 'check') { e.preventDefault(); toggleDone(b.id); }
      return;
    }
  }

  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    const sel = getSelection();
    if (!sel.rangeCount) return;
    const r = sel.getRangeAt(0);
    if (!r.collapsed) r.deleteContents();
    const len = t.textContent.length;
    const off = caretOffset(t);
    // Entrée sur une puce ou case vide : on sort de la liste
    if ((b.type === 'check' || b.type === 'bullet') && t.textContent.trim() === '') {
      b.type = 'text';
      b.done = false;
      commit();
      rerenderBlock(b.id);
      focusBlock(b.id);
      updateToolbar();
      return;
    }
    const nextType = (b.type === 'h1' || b.type === 'h2') ? 'text' : b.type;
    if (off === 0 && len > 0) {
      list.splice(i, 0, mk(nextType));
      commit();
      renderList(k);
      focusBlock(b.id, 0);
      return;
    }
    // Coupe le HTML au niveau du curseur
    const tail = document.createRange();
    tail.setStart(r.startContainer, r.startOffset);
    tail.setEnd(t, t.childNodes.length);
    const holder = document.createElement('div');
    holder.append(tail.extractContents());
    b.text = sanitize(t.innerHTML);
    const nb = mk(nextType, sanitize(holder.innerHTML));
    list.splice(i + 1, 0, nb);
    commit();
    renderList(k);
    focusBlock(nb.id, 0);
    return;
  }

  if (e.key === 'Backspace' && selectionCollapsed() && caretOffset(t) === 0) {
    if (b.type !== 'text') {
      e.preventDefault();
      b.type = 'text';
      b.done = false;
      b.text = sanitize(t.innerHTML);
      commit();
      rerenderBlock(b.id);
      focusBlock(b.id, 0);
      updateToolbar();
      return;
    }
    const prev = list[i - 1];
    if (prev && prev.type === 'image') {
      e.preventDefault();
      if (t.textContent === '') { list.splice(i, 1); commit(); renderList(k); }
      focusBlock(prev.id);
      return;
    }
    if (prev) {
      e.preventDefault();
      if (t.textContent !== '') snapshot();
      const join = textOf(prev.text).length;
      prev.text = sanitize(prev.text + b.text);
      list.splice(i, 1);
      commit();
      renderList(k);
      focusBlock(prev.id, join);
      return;
    }
    if (t.textContent === '' && list.length > 1) {
      e.preventDefault();
      list.splice(i, 1);
      commit();
      renderList(k);
      focusBlock(list[0].id, 0);
    }
    return;
  }

  if (e.key === 'ArrowUp' && caretOffset(t) === 0 && i > 0) {
    e.preventDefault();
    focusBlock(list[i - 1].id, 'end');
  } else if (e.key === 'ArrowDown' && caretOffset(t) === t.textContent.length && i < list.length - 1) {
    e.preventDefault();
    focusBlock(list[i + 1].id, 0);
  }
});

const imageFiles = list => [...(list || [])].filter(f => f.type.startsWith('image/'));

document.addEventListener('paste', e => {
  const files = imageFiles(e.clipboardData?.files);
  const ctx = blockFromEvent(e);
  if (files.length) {
    e.preventDefault();
    if (ctx) insertImages(files, ctx.k, ctx.i + 1);
    else insertImages(files, defaultList());
    return;
  }
  if (!ctx) return;
  e.preventDefault();
  const pasted = (e.clipboardData?.getData('text/plain') || '').replace(/\r/g, '');
  const lines = pasted.split('\n');
  const { t, k, i, b, list } = ctx;

  if (lines.length === 1) {
    const url = pasted.trim();
    if (/^https?:\/\/\S+$/.test(url) && !selectionCollapsed()) {
      document.execCommand('createLink', false, url);
    } else {
      document.execCommand('insertHTML', false, linkify(pasted));
    }
    return;
  }

  // Plusieurs lignes : une ligne = un bloc
  const sel = getSelection();
  const r = sel.getRangeAt(0);
  if (!r.collapsed) r.deleteContents();
  const tail = document.createRange();
  tail.setStart(r.startContainer, r.startOffset);
  tail.setEnd(t, t.childNodes.length);
  const holder = document.createElement('div');
  holder.append(tail.extractContents());
  const after = sanitize(holder.innerHTML);

  b.text = sanitize(t.innerHTML + linkify(lines[0]));
  const baseType = b.type === 'h1' || b.type === 'h2' ? 'text' : b.type;
  const added = lines.slice(1).map(line => {
    const sc = matchShortcut(line);
    return sc ? mk(sc.type, linkify(line.slice(sc.len))) : mk(baseType, linkify(line));
  });
  const last = added[added.length - 1];
  const caret = textOf(last.text).length;
  last.text = sanitize(last.text + after);
  list.splice(i + 1, 0, ...added);
  commit();
  renderList(k);
  focusBlock(last.id, caret);
});

function format(cmd) {
  document.execCommand('styleWithCSS', false, false);
  document.execCommand(cmd);
  updateToolbar();
}

function makeLink() {
  const t = document.activeElement?.closest?.('.text');
  if (!t) return;
  const sel = getSelection();
  const range = sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
  const existing = range && range.startContainer.parentElement?.closest('a');
  const answer = prompt('Adresse du lien (laisser vide pour retirer le lien)', existing ? existing.getAttribute('href') : 'https://');
  if (answer === null) return;
  t.focus();
  if (range) { sel.removeAllRanges(); sel.addRange(range); }
  const url = answer.trim();
  if (!url || url === 'https://') {
    if (existing) {
      const r = document.createRange();
      r.selectNode(existing);
      sel.removeAllRanges();
      sel.addRange(r);
    }
    document.execCommand('unlink');
    return;
  }
  const href = /^[a-z]+:/i.test(url) ? url : `https://${url}`;
  if (!safeHref(href)) return;
  if (range && !range.collapsed) document.execCommand('createLink', false, href);
  else document.execCommand('insertHTML', false, `<a href="${escapeHtml(href)}">${escapeHtml(url)}</a>`);
}

/**
 * Cocher range la tâche en haut des « Tâches réalisées » des Notes (même depuis la matrice) ;
 * décocher la renvoie à la fin des tâches en cours de sa case d'origine.
 */
function toggleDone(id) {
  const f = find(id);
  if (!f) return;
  snapshot();
  f.list.splice(f.i, 1);
  f.b.done = !f.b.done;
  let k = f.k;
  if (f.b.done && k !== 'notes') {
    f.b.from = k;
    k = 'notes';
    toast('Réalisée → Notes › Tâches réalisées');
  } else if (!f.b.done && f.b.from) {
    if (LISTS.includes(f.b.from)) k = f.b.from;
    delete f.b.from;
  }
  cur().lists[k].splice(activeCount(k), 0, f.b);
  commit();
  renderList(f.k);
  if (k !== f.k) renderList(k);
}

function setType(id, type) {
  const f = find(id);
  if (!f || f.b.type === 'image') return;
  snapshot();
  f.b.type = f.b.type === type && type !== 'text' ? 'text' : type;
  if (f.b.type !== 'check') { f.b.done = false; delete f.b.from; }
  commit();
  rerenderBlock(id);
  updateToolbar();
}

function deleteBlock(id) {
  const f = find(id);
  if (!f) return;
  snapshot();
  f.list.splice(f.i, 1);
  commit();
  renderList(f.k);
  toast(f.b.type === 'image' ? 'Image supprimée' : 'Élément supprimé');
}

function moveBlock(id, toK, toIdx) {
  const f = find(id);
  if (!f) return;
  snapshot();
  // Une tâche réalisée déposée dans la matrice redevient à faire
  if (toK !== 'notes' && isDone(f.b)) {
    f.b.done = false;
    delete f.b.from;
    toIdx = activeCount(toK);
  }
  const dest = cur().lists[toK];
  if (toIdx == null) toIdx = isDone(f.b) ? dest.length : activeCount(toK);
  if (toIdx > dest.length) toIdx = dest.length;
  if (f.k === toK && toIdx > f.i) toIdx--;
  if (f.k === toK && toIdx === f.i) return;
  f.list.splice(f.i, 1);
  dest.splice(toIdx, 0, f.b);
  commit();
  renderList(f.k);
  if (toK !== f.k) renderList(toK);
}

/* ---------------- Barre d'outils, onglets, clics ---------------- */

function updateToolbar() {
  const f = activeId && find(activeId);
  document.querySelectorAll('#toolbar button[data-type]').forEach(btn => {
    btn.classList.toggle('active', !!f && btn.dataset.type === f.b.type);
  });
  const editing = !!document.activeElement?.closest?.('.text');
  for (const cmd of ['bold', 'italic']) {
    let on = false;
    try { on = editing && document.queryCommandState(cmd); } catch { /* rien */ }
    $(`#toolbar button[data-cmd="${cmd}"]`).classList.toggle('active', on);
  }
}

document.addEventListener('selectionchange', () => updateToolbar());

document.addEventListener('focusin', e => {
  const block = e.target.closest?.('.block');
  if (block && (e.target.classList.contains('text') || e.target.classList.contains('image-wrap'))) {
    activeId = block.dataset.id;
    updateToolbar();
  }
});

function defaultList() { return currentView() === 'matrix' ? 'q1' : 'notes'; }

const toolbar = $('#toolbar');
const imageInput = $('#image-input');
// Ne pas voler le focus au texte en cours d'édition
toolbar.addEventListener('pointerdown', e => e.preventDefault());
toolbar.addEventListener('mousedown', e => e.preventDefault());

/* Sur téléphone : la barre de mise en forme reste en bas, collée au-dessus du clavier */
const mobileQuery = matchMedia('(max-width: 820px)');

function placeToolbar() {
  const vv = window.visualViewport;
  if (!mobileQuery.matches || !vv) {
    toolbar.style.top = '';
    toolbar.style.bottom = '';
    document.body.classList.remove('kb-open');
    return;
  }
  const kbOpen = vv.height < innerHeight - 120;
  document.body.classList.toggle('kb-open', kbOpen);
  document.documentElement.style.setProperty('--toolbar-h', `${toolbar.offsetHeight}px`);
  if (kbOpen) {
    // Clavier ouvert : la pilule flotte juste au-dessus
    toolbar.style.bottom = 'auto';
    toolbar.style.top = `${vv.offsetTop + vv.height - toolbar.offsetHeight - 8}px`;
  } else {
    // Clavier fermé : position par défaut du CSS (en bas, au-dessus de la barre d'accueil)
    toolbar.style.top = '';
    toolbar.style.bottom = '';
  }
  keepCaretVisible();
}

/** Fait défiler la note pour que la ligne en cours reste visible, ni sous la barre ni hors de l'écran. */
function keepCaretVisible() {
  if (!mobileQuery.matches) return;
  const el = document.activeElement?.closest?.('.text, .image-wrap');
  const scroller = el?.closest('.notes-panel, .matrix-panel');
  if (!scroller) return;
  let rect = null;
  const sel = getSelection();
  if (el.classList.contains('text') && sel.rangeCount) {
    const r = sel.getRangeAt(0).cloneRange();
    r.collapse(false);
    rect = r.getClientRects()[0] || null;
  }
  if (!rect) rect = el.getBoundingClientRect();
  const bottom = toolbar.getBoundingClientRect().top - 16;
  const top = Math.max(scroller.getBoundingClientRect().top, window.visualViewport?.offsetTop || 0) + 8;
  if (rect.bottom > bottom) scroller.scrollTop += rect.bottom - bottom;
  else if (rect.top < top) scroller.scrollTop -= top - rect.top;
}

window.visualViewport?.addEventListener('resize', placeToolbar);
window.visualViewport?.addEventListener('scroll', placeToolbar);
mobileQuery.addEventListener('change', placeToolbar);
document.addEventListener('focusin', () => setTimeout(placeToolbar, 50));
document.addEventListener('input', () => requestAnimationFrame(keepCaretVisible));
toolbar.addEventListener('click', e => {
  const cmdBtn = e.target.closest('button[data-cmd]');
  if (cmdBtn) {
    const cmd = cmdBtn.dataset.cmd;
    if (cmd === 'image') imageInput.click();
    else if (cmd === 'link') makeLink();
    else format(cmd);
    return;
  }
  const btn = e.target.closest('button[data-type]');
  if (!btn) return;
  const type = btn.dataset.type;
  if (activeId && find(activeId) && find(activeId).b.type !== 'image') {
    const t = document.querySelector(`.block[data-id="${activeId}"] .text`);
    const off = t && document.activeElement === t ? caretOffset(t) : 'end';
    setType(activeId, type);
    focusBlock(activeId, off);
  } else {
    const k = defaultList();
    const nb = mk(type);
    cur().lists[k].splice(activeCount(k), 0, nb);
    commit();
    renderList(k);
    focusBlock(nb.id);
  }
});

imageInput.addEventListener('change', () => {
  const files = imageFiles(imageInput.files);
  imageInput.value = '';
  if (!files.length) return;
  const f = activeId && find(activeId);
  if (f) insertImages(files, f.k, f.i + 1);
  else insertImages(files, defaultList());
});

function currentView() { return $('.layout').dataset.view; }

function setView(view) {
  $('.layout').dataset.view = view;
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.view === view));
  try { localStorage.setItem(KEY_VIEW, view); } catch { /* rien */ }
}

// Un lien s'ouvre au premier toucher, ou avec ⌘/Ctrl+clic pendant l'édition
let linkWasEditing = false;
document.addEventListener('pointerdown', e => {
  const a = e.target.closest?.('.text a');
  linkWasEditing = !!a && document.activeElement === a.closest('.text');
}, true);

document.addEventListener('click', e => {
  const a = e.target.closest('.text a');
  if (a && (e.metaKey || e.ctrlKey || !linkWasEditing)) {
    e.preventDefault();
    window.open(a.href, '_blank', 'noopener');
    return;
  }
  const box = e.target.closest('.checkbox');
  if (box) {
    toggleDone(box.closest('.block').dataset.id);
    return;
  }
  const del = e.target.closest('.del, .img-del');
  if (del) {
    deleteBlock(del.closest('.block').dataset.id);
    return;
  }
  const toggle = e.target.closest('.done-toggle');
  if (toggle) {
    const k = toggle.dataset.list;
    if (collapsed.has(collapseKey(k))) collapsed.delete(collapseKey(k)); else collapsed.add(collapseKey(k));
    writeJSON(KEY_COLLAPSED, [...collapsed]);
    renderList(k);
    return;
  }
  const clear = e.target.closest('.done-clear');
  if (clear) {
    const k = clear.dataset.list;
    const n = cur().lists[k].filter(isDone).length;
    snapshot();
    cur().lists[k] = cur().lists[k].filter(b => !isDone(b));
    commit();
    renderList(k);
    toast(`${n} tâche${n > 1 ? 's' : ''} réalisée${n > 1 ? 's' : ''} supprimée${n > 1 ? 's' : ''}`);
    return;
  }
  const tab = e.target.closest('.tab');
  if (tab) {
    setView(tab.dataset.view);
    return;
  }
  // Clic dans une zone vide : on continue la dernière ligne ou on en crée une
  const zone = e.target.closest('[data-drop]');
  if (zone && !e.target.closest('.block, .done-header')) {
    const k = zone.dataset.drop;
    const list = cur().lists[k];
    const n = activeCount(k);
    const last = list[n - 1];
    if (last && last.type !== 'image' && textOf(last.text) === '') { focusBlock(last.id); return; }
    const nb = mk(k === 'notes' ? 'text' : 'check');
    list.splice(n, 0, nb);
    commit();
    renderList(k);
    focusBlock(nb.id);
  }
});

/* ---------------- Menu d'un bloc ---------------- */

const menu = $('#block-menu');
let menuId = null;

function openMenu(id, anchor) {
  const f = find(id);
  if (!f) return;
  if (menuId === id) { closeMenu(); return; }
  menuId = id;

  $('#menu-move').replaceChildren(...LISTS.filter(k => k !== f.k).map(k => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.target = k;
    btn.textContent = LIST_NAMES[k];
    btn.onclick = () => { closeMenu(); moveBlock(id, k); };
    return btn;
  }));
  const others = state.workspaces.filter(w => w.id !== cur().id);
  $('#menu-ws').replaceChildren(...others.map(w => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = w.name;
    btn.onclick = () => { closeMenu(); moveToWorkspace(id, w.id); };
    return btn;
  }));
  $('#menu-ws').hidden = !others.length;
  $('#menu-ws-title').hidden = !others.length;

  const isImage = f.b.type === 'image';
  $('#menu-type').replaceChildren(...(isImage ? [] : Object.entries(TYPES).map(([type, label]) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = label;
    btn.classList.toggle('current', f.b.type === type);
    btn.onclick = () => { closeMenu(); setType(id, type); };
    return btn;
  })));
  $('#menu-type').hidden = isImage;
  $('#menu-type-title').hidden = isImage;
  $('#menu-delete').onclick = () => { closeMenu(); deleteBlock(id); };

  menu.hidden = false;
  const r = anchor.getBoundingClientRect();
  const left = Math.min(r.right + 6, innerWidth - menu.offsetWidth - 8);
  const top = Math.min(r.top, innerHeight - menu.offsetHeight - 8);
  menu.style.left = `${Math.max(8, left)}px`;
  menu.style.top = `${Math.max(8, top)}px`;
}

function closeMenu() {
  menu.hidden = true;
  menuId = null;
}

/* ---------------- Espaces de travail ---------------- */

const wsTabs = $('#ws-tabs');
const wsMenu = $('#ws-menu');
let wsMenuId = null;

function switchWorkspace(id) {
  currentWs = id;
  try { localStorage.setItem(KEY_WS, id); } catch { /* rien */ }
  activeId = null;
  closeWsMenu();
  renderAll();
  wsTabs.querySelector('.ws-tab.current')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

/** Onglets des espaces, côte à côte. L'onglet ouvert porte un bouton ⋯ (renommer / supprimer). */
function renderWsTabs() {
  const tabs = state.workspaces.map(w => {
    const todo = LISTS.reduce((n, k) => n + w.lists[k].filter(b => b.type === 'check' && !b.done).length, 0);
    const isCur = w.id === cur().id;
    const tab = document.createElement('div');
    tab.className = 'ws-tab' + (isCur ? ' current' : '');
    tab.dataset.ws = w.id;

    const pick = document.createElement('button');
    pick.type = 'button';
    pick.className = 'ws-pick';
    pick.title = isCur ? 'Double-clic pour renommer' : `Ouvrir ${w.name}`;
    const name = document.createElement('span');
    name.className = 'ws-label';
    name.textContent = w.name;
    pick.append(name);
    if (todo) {
      const count = document.createElement('span');
      count.className = 'count';
      count.textContent = todo;
      count.title = `${todo} tâche${todo > 1 ? 's' : ''} à faire`;
      pick.append(count);
    }
    tab.append(pick);

    if (isCur) {
      const more = document.createElement('button');
      more.type = 'button';
      more.className = 'ws-more';
      more.title = 'Renommer ou supprimer';
      more.setAttribute('aria-label', `Options de ${w.name}`);
      more.textContent = '⋯';
      tab.append(more);
    }
    return tab;
  });

  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'ws-new';
  add.title = 'Nouvel espace';
  add.setAttribute('aria-label', 'Nouvel espace');
  add.textContent = '+';
  wsTabs.replaceChildren(...tabs, add);
}

wsTabs.addEventListener('click', e => {
  if (e.target.closest('.ws-new')) { createWorkspace(); return; }
  const tab = e.target.closest('.ws-tab');
  if (!tab) return;
  if (e.target.closest('.ws-more')) { openWsMenu(tab.dataset.ws, e.target.closest('.ws-more')); return; }
  if (tab.dataset.ws !== cur().id) switchWorkspace(tab.dataset.ws);
});
wsTabs.addEventListener('dblclick', e => {
  const tab = e.target.closest('.ws-tab');
  if (tab && !e.target.closest('.ws-more')) renameWorkspace(tab.dataset.ws);
});

function openWsMenu(id, anchor) {
  closeMenu();
  if (wsMenuId === id && !wsMenu.hidden) { closeWsMenu(); return; }
  wsMenuId = id;
  wsMenu.hidden = false;
  const r = anchor.getBoundingClientRect();
  wsMenu.style.left = `${Math.max(8, Math.min(r.left, innerWidth - wsMenu.offsetWidth - 8))}px`;
  wsMenu.style.top = `${r.bottom + 6}px`;
}

function closeWsMenu() {
  wsMenu.hidden = true;
  wsMenuId = null;
}

$('#ws-rename').addEventListener('click', () => { const id = wsMenuId; closeWsMenu(); renameWorkspace(id); });
$('#ws-delete').addEventListener('click', () => { const id = wsMenuId; closeWsMenu(); deleteWorkspace(id); });

function askName(message, initial = '') {
  const name = prompt(message, initial);
  return name === null ? null : name.trim().slice(0, 40) || null;
}

function createWorkspace() {
  const name = askName('Nom du nouvel espace (ex. École, Perso, Travail)');
  if (!name) return;
  const ws = newWorkspace(name);
  state.workspaces.push(ws);
  commit();
  switchWorkspace(ws.id);
}

function renameWorkspace(id) {
  const ws = state.workspaces.find(w => w.id === id);
  const name = ws && askName('Nouveau nom de l\'espace', ws.name);
  if (!name || name === ws.name) return;
  snapshot();
  ws.name = name;
  commit();
  renderAll();
}

function deleteWorkspace(id) {
  const i = state.workspaces.findIndex(w => w.id === id);
  if (i === -1) return;
  if (state.workspaces.length === 1) { alert('Il faut garder au moins un espace. Tu peux le renommer.'); return; }
  const ws = state.workspaces[i];
  const n = LISTS.reduce((sum, k) => sum + ws.lists[k].length, 0);
  const detail = n ? ` et ses ${n} élément${n > 1 ? 's' : ''}` : '';
  if (!confirm(`Supprimer l'espace « ${ws.name} »${detail} ?`)) return;
  snapshot();
  state.workspaces.splice(i, 1);
  commit();
  if (id === cur().id || !state.workspaces.some(w => w.id === currentWs)) switchWorkspace(state.workspaces[0].id);
  else renderAll();
  toast(`Espace « ${ws.name} » supprimé`);
}

/** Envoie un bloc dans la même zone (notes, Faire…) d'un autre espace. */
function moveToWorkspace(id, wsId) {
  const f = find(id);
  const target = state.workspaces.find(w => w.id === wsId);
  if (!f || !target) return;
  snapshot();
  f.list.splice(f.i, 1);
  const dest = target.lists[f.k];
  dest.splice(isDone(f.b) ? dest.length : dest.filter(b => !isDone(b)).length, 0, f.b);
  commit();
  renderList(f.k);
  toast(`Déplacé vers « ${target.name} »`);
}

/* ---------------- Annuler / Refaire ---------------- */

const undoStack = [];
const redoStack = [];
const undoBtn = $('#undo-btn');
const redoBtn = $('#redo-btn');
const toastEl = $('#toast');
let toastTimer = null;

function updateHistoryButtons() {
  undoBtn.disabled = !undoStack.length;
  redoBtn.disabled = !redoStack.length;
}

function clearHistory() {
  undoStack.length = 0;
  redoStack.length = 0;
  updateHistoryButtons();
}

/** À appeler juste AVANT une modification qu'on veut pouvoir annuler. */
function snapshot() {
  undoStack.push(JSON.stringify(state));
  if (undoStack.length > 50) undoStack.shift();
  redoStack.length = 0; // une nouvelle action efface ce qu'on pouvait refaire
  updateHistoryButtons();
}

/** Remplace l'état par `from.pop()` en gardant l'état actuel dans `to`. */
function travel(from, to) {
  const target = from.pop();
  hideToast();
  if (!target) return;
  to.push(JSON.stringify(state));
  state = JSON.parse(target);
  updateHistoryButtons();
  commit();
  closeMenu();
  closeWsMenu();
  renderAll();
}

const undo = () => travel(undoStack, redoStack);
const redo = () => travel(redoStack, undoStack);

function toast(message) {
  $('.toast-msg', toastEl).textContent = message;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, 6000);
}

function hideToast() {
  toastEl.hidden = true;
  clearTimeout(toastTimer);
}

undoBtn.addEventListener('click', undo);
redoBtn.addEventListener('click', redo);
$('.toast-undo', toastEl).addEventListener('click', undo);
// Hors d'un texte : ⌘/Ctrl+Z annule, ⌘/Ctrl+Maj+Z ou Ctrl+Y refait
// (dans un texte, l'annulation de frappe du navigateur reste active)
document.addEventListener('keydown', e => {
  if (!(e.metaKey || e.ctrlKey) || e.target.closest?.('.text, input, textarea')) return;
  const key = e.key.toLowerCase();
  if (key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
  else if ((key === 'z' && e.shiftKey) || key === 'y') { e.preventDefault(); redo(); }
});


/* ---------------- Glisser-déposer (souris + tactile) ---------------- */

let drag = null;

document.addEventListener('pointerdown', e => {
  const handle = e.target.closest('.handle');
  if (!handle) {
    if (!e.target.closest('#block-menu')) closeMenu();
    if (!e.target.closest('#ws-menu, .ws-more')) closeWsMenu();
    return;
  }
  e.preventDefault();
  const block = handle.closest('.block');
  drag = { id: block.dataset.id, el: block, handle, x: e.clientX, y: e.clientY, active: false, target: null };
});

document.addEventListener('pointermove', e => {
  if (!drag) return;
  if (!drag.active) {
    if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 6) return;
    startDrag();
  }
  e.preventDefault();
  updateDrag(e.clientX, e.clientY);
}, { passive: false });

document.addEventListener('pointerup', e => {
  if (!drag) return;
  const d = drag;
  drag = null;
  if (!d.active) {
    openMenu(d.id, d.handle);
    return;
  }
  updateDrag(e.clientX, e.clientY, d);
  endDrag(d);
  if (d.target?.ws) moveToWorkspace(d.id, d.target.ws);
  else if (d.target) moveBlock(d.id, d.target.k, d.target.idx);
});

document.addEventListener('pointercancel', () => {
  if (drag?.active) endDrag(drag);
  drag = null;
});

function startDrag() {
  closeMenu();
  drag.active = true;
  const b = find(drag.id)?.b;
  drag.ghost = document.createElement('div');
  drag.ghost.className = 'drag-ghost';
  drag.ghost.textContent = b?.type === 'image' ? '🖼 Image'
    : (b?.type === 'check' ? '○ ' : '') + (textOf(b?.text || '') || '(vide)');
  document.body.append(drag.ghost);
  drag.indicator = document.createElement('div');
  drag.indicator.className = 'drop-indicator';
  drag.el.classList.add('dragging');
  document.body.classList.add('is-dragging');
}

function updateDrag(x, y, d = drag) {
  d.ghost.style.transform = `translate(${x + 14}px, ${y - 16}px)`;

  document.querySelectorAll('.drop-target').forEach(el => el.classList.remove('drop-target'));
  const under = document.elementFromPoint(x, y);

  // Sur téléphone : survoler un onglet bascule de vue
  const tab = under?.closest('.tab');
  if (tab && tab.dataset.view !== currentView()) setView(tab.dataset.view);

  // Déposer sur l'onglet d'un autre espace = envoyer la tâche dans cet espace
  const wsTab = under?.closest('.ws-tab');
  if (wsTab && wsTab.dataset.ws !== cur().id) {
    d.indicator.remove();
    wsTab.classList.add('drop-target');
    d.target = { ws: wsTab.dataset.ws };
    return;
  }

  const zone = under?.closest('[data-drop]');
  if (!zone) {
    d.indicator.remove();
    d.target = null;
    return;
  }
  const k = zone.dataset.drop;
  const container = listEl(k);
  const blocks = [...container.children].filter(c => c.classList.contains('block') && c.offsetParent);
  let idx = blocks.findIndex(b => {
    const r = b.getBoundingClientRect();
    return y < r.top + r.height / 2;
  });
  if (idx === -1) {
    idx = blocks.length;
    const header = container.querySelector('.done-header');
    if (header && header.nextElementSibling && !header.nextElementSibling.offsetParent) {
      // Section réalisée repliée : on dépose avant elle
      container.insertBefore(d.indicator, header);
      idx = activeCount(k);
    } else container.append(d.indicator);
  } else {
    container.insertBefore(d.indicator, blocks[idx]);
    idx = cur().lists[k].findIndex(b => b.id === blocks[idx].dataset.id);
  }
  d.target = { k, idx };
  zone.closest('.quadrant')?.classList.add('drop-target');
  autoScroll(container, y);
}

function autoScroll(container, y) {
  const scroller = [container, container.closest('.panel')]
    .find(el => el && el.scrollHeight > el.clientHeight && getComputedStyle(el).overflowY !== 'visible');
  if (!scroller) return;
  const r = scroller.getBoundingClientRect();
  if (y < r.top + 40) scroller.scrollTop -= 10;
  else if (y > r.bottom - 40) scroller.scrollTop += 10;
}

function endDrag(d) {
  d.ghost?.remove();
  d.indicator?.remove();
  d.el.classList.remove('dragging');
  document.body.classList.remove('is-dragging');
  document.querySelectorAll('.drop-target').forEach(el => el.classList.remove('drop-target'));
}

// Fichiers image glissés depuis le Finder / l'Explorateur
document.addEventListener('dragover', e => {
  if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
});
document.addEventListener('drop', e => {
  const files = imageFiles(e.dataTransfer?.files);
  if (!files.length) return;
  e.preventDefault();
  const zone = e.target.closest?.('[data-drop]');
  const k = zone ? zone.dataset.drop : defaultList();
  const block = e.target.closest?.('.block');
  const f = block && find(block.dataset.id);
  insertImages(files, k, f && f.k === k ? f.i + 1 : undefined);
});

/* ---------------- Images ---------------- */

const IMG_CACHE = 'appnotes-images';
const MIME = { jpg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp' };
const EXT = Object.fromEntries(Object.entries(MIME).map(([ext, type]) => [type, ext]));
const imgURLs = new Map();
const memBlobs = new Map();
const imgKey = name => new URL(`__img/${name}`, location.href).href;

/** Réduit les grosses images (photos) pour garder une synchro rapide. */
async function prepareImage(file) {
  if (file.type === 'image/gif' || (file.size < 300_000 && EXT[file.type])) return file;
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => canvas.toBlob(b => (b ? resolve(b) : reject(new Error('conversion'))), 'image/jpeg', 0.85));
}

async function storeImage(name, blob) {
  memBlobs.set(name, blob);
  try { await (await caches.open(IMG_CACHE)).put(imgKey(name), new Response(blob, { headers: { 'Content-Type': blob.type } })); } catch { /* pas de cache */ }
}

async function loadImageBlob(name, allowRemote = true) {
  if (memBlobs.has(name)) return memBlobs.get(name);
  try {
    const hit = await (await caches.open(IMG_CACHE)).match(imgKey(name));
    if (hit) return hit.blob();
  } catch { /* pas de cache */ }
  if (allowRemote && sync.configured() && navigator.onLine) {
    const r = await ghFetch(settings, sync.url(`images/${name}`), 'GET', null, 'application/vnd.github.raw+json');
    if (r.ok) {
      const type = MIME[name.split('.').pop()] || 'image/jpeg';
      const blob = new Blob([await r.blob()], { type });
      await storeImage(name, blob);
      return blob;
    }
  }
  return null;
}

async function imageURL(name) {
  if (imgURLs.has(name)) return imgURLs.get(name);
  try {
    const blob = await loadImageBlob(name);
    if (!blob) return null;
    const url = URL.createObjectURL(blob);
    imgURLs.set(name, url);
    return url;
  } catch {
    return null;
  }
}

async function insertImages(files, k, idx) {
  const blocks = [];
  for (const file of files) {
    try {
      const blob = await prepareImage(file);
      const name = `${uid()}.${EXT[blob.type] || 'jpg'}`;
      await storeImage(name, blob);
      imgURLs.set(name, URL.createObjectURL(blob));
      meta.pendingImages = [...(meta.pendingImages || []), name];
      blocks.push({ id: uid(), type: 'image', src: name, text: '', done: false });
    } catch {
      alert(`Impossible de lire l'image « ${file.name || 'collée'} ».`);
    }
  }
  if (!blocks.length) return;
  saveMeta();
  const list = cur().lists[k];
  const at = Math.min(idx ?? activeCount(k), list.length);
  list.splice(at, 0, ...blocks);
  commit();
  renderList(k);
  focusBlock(blocks[blocks.length - 1].id);
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/* ---------------- Synchronisation GitHub ---------------- */

function b64encode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function b64decode(b64) {
  const bin = atob(b64.replace(/\s/g, ''));
  return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0)));
}

function ghError(status) {
  if (status === 401) return 'Jeton invalide ou expiré';
  if (status === 403) return 'Accès refusé : vérifie les droits du jeton';
  if (status === 404) return 'Dépôt introuvable (nom ou droits du jeton ?)';
  return `Erreur GitHub ${status}`;
}

function ghFetch(cfg, url, method = 'GET', body, accept = 'application/vnd.github+json') {
  return fetch(url, {
    method,
    cache: 'no-store',
    headers: {
      Accept: accept,
      Authorization: `Bearer ${cfg.token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

const statusBtn = $('#sync-status');
const STATUS_LABELS = {
  local: 'Local', pending: 'En attente', syncing: 'Synchro…', ok: 'Synchronisé', offline: 'Hors ligne', error: 'Erreur',
};

function setStatus(s, detail = '') {
  statusBtn.dataset.state = s;
  $('.label', statusBtn).textContent = STATUS_LABELS[s];
  statusBtn.title = detail || (s === 'local'
    ? 'Notes gardées sur cet appareil uniquement. Configure GitHub dans les réglages.'
    : 'Cliquer pour synchroniser maintenant');
}

const sync = {
  timer: null,
  busy: false,
  again: false,
  editVersion: 0,

  configured() {
    return !!(settings && settings.owner && settings.repo && settings.token);
  },

  url(file = settings.path || 'data.json') {
    const path = file.split('/').map(encodeURIComponent).join('/');
    return `https://api.github.com/repos/${encodeURIComponent(settings.owner)}/${encodeURIComponent(settings.repo)}/contents/${path}`;
  },

  schedule() {
    if (!this.configured()) return;
    setStatus('pending');
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.run(), 3000);
  },

  async run() {
    clearTimeout(this.timer);
    if (!this.configured()) { setStatus('local'); return; }
    if (this.busy) { this.again = true; return; }
    if (!navigator.onLine) { setStatus('offline', 'Les modifications seront envoyées au retour du réseau'); return; }
    this.busy = true;
    setStatus('syncing');
    try {
      await this.pull();
      await this.uploadImages();
      if (meta.dirty) await this.push();
      setStatus(meta.dirty ? 'pending' : 'ok', `Dernière synchro : ${new Date().toLocaleTimeString('fr-FR')}`);
    } catch (err) {
      setStatus(navigator.onLine ? 'error' : 'offline', err.message);
    } finally {
      this.busy = false;
      if (this.again) { this.again = false; this.schedule(); }
    }
  },

  async pull() {
    const r = await ghFetch(settings, this.url());
    if (r.status === 404) {
      // Le fichier n'existe pas encore : on le créera au prochain envoi
      meta.sha = null;
      meta.dirty = true;
      saveMeta();
      return;
    }
    if (!r.ok) throw new Error(ghError(r.status));
    const file = await r.json();
    if (file.sha === meta.sha) return;

    const remote = normalize(JSON.parse(b64decode(file.content)));
    if (!remote) throw new Error('Le fichier distant est illisible');

    // La version modifiée en dernier gagne
    if (meta.dirty && state.updatedAt >= remote.updatedAt) {
      meta.sha = file.sha;
      saveMeta();
      return;
    }
    state = remote;
    clearHistory(); // l'historique local ne correspond plus aux données reçues
    meta.sha = file.sha;
    meta.dirty = false;
    writeJSON(KEY_STATE, state);
    saveMeta();
    keepFocus(renderAll);
  },

  // Les images partent avant les notes, pour qu'un autre appareil les trouve tout de suite
  async uploadImages() {
    for (const name of [...(meta.pendingImages || [])]) {
      const blob = await loadImageBlob(name, false);
      if (blob) {
        const r = await ghFetch(settings, this.url(`images/${name}`), 'PUT', {
          message: `Image ${name}`,
          content: await blobToBase64(blob),
        });
        if (!r.ok && r.status !== 422) throw new Error(ghError(r.status));
      }
      meta.pendingImages = meta.pendingImages.filter(n => n !== name);
      saveMeta();
    }
  },

  async push() {
    const version = this.editVersion;
    const body = {
      message: `Notes mises à jour (${new Date().toISOString().slice(0, 16).replace('T', ' ')})`,
      content: b64encode(JSON.stringify(state, null, 1)),
    };
    if (meta.sha) body.sha = meta.sha;
    let r = await ghFetch(settings, this.url(), 'PUT', body);
    if (r.status === 409 || r.status === 422) {
      // Le fichier a changé entre-temps : on récupère sa version et on réessaie
      const g = await ghFetch(settings, this.url());
      if (g.ok) body.sha = (await g.json()).sha; else delete body.sha;
      r = await ghFetch(settings, this.url(), 'PUT', body);
    }
    if (!r.ok) throw new Error(ghError(r.status));
    const res = await r.json();
    meta.sha = res.content.sha;
    if (this.editVersion === version) meta.dirty = false;
    saveMeta();
  },
};

statusBtn.addEventListener('click', () => {
  if (sync.configured()) sync.run(); else openSettings();
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') sync.run();
});
addEventListener('online', () => sync.run());
addEventListener('offline', () => sync.configured() && setStatus('offline'));
setInterval(() => {
  if (document.visibilityState === 'visible') sync.run();
}, 60_000);

/* ---------------- Réglages ---------------- */

const dialog = $('#settings');
const form = $('.settings-form', dialog);
const result = $('#settings-result');

function formValues() {
  const v = Object.fromEntries(['owner', 'repo', 'path', 'token'].map(n => [n, form.elements[n].value.trim()]));
  if (!v.path) v.path = 'data.json';
  return v;
}

function showResult(msg, kind = '') {
  result.textContent = msg;
  result.className = `hint ${kind}`;
}

function openSettings() {
  const s = settings || {};
  form.elements.owner.value = s.owner || '';
  form.elements.repo.value = s.repo || 'appnotes-data';
  form.elements.path.value = s.path || 'data.json';
  form.elements.token.value = s.token || '';
  showResult('');
  dialog.showModal();
}

$('#open-settings').addEventListener('click', openSettings);

$('#settings-test').addEventListener('click', async () => {
  const v = formValues();
  if (!v.owner || !v.repo || !v.token) { showResult('Remplis l\'utilisateur, le dépôt et le jeton.', 'err'); return; }
  showResult('Test en cours…');
  try {
    const r = await ghFetch(v, `https://api.github.com/repos/${encodeURIComponent(v.owner)}/${encodeURIComponent(v.repo)}`);
    if (!r.ok) { showResult(ghError(r.status), 'err'); return; }
    const repo = await r.json();
    if (!repo.private) showResult('Connexion OK, mais attention : ce dépôt est PUBLIC. Tout le monde pourrait lire tes notes.', 'err');
    else if (repo.permissions && !repo.permissions.push) showResult('Connexion OK, mais le jeton ne peut pas écrire (droit « Contents : Read and write » manquant).', 'err');
    else showResult('Connexion OK : dépôt privé accessible en écriture.', 'ok');
  } catch {
    showResult('Impossible de joindre GitHub (réseau ?)', 'err');
  }
});

$('#settings-save').addEventListener('click', () => {
  const v = formValues();
  if (!v.owner || !v.repo || !v.token) { showResult('Remplis l\'utilisateur, le dépôt et le jeton.', 'err'); return; }
  settings = v;
  writeJSON(KEY_SETTINGS, settings);
  meta = { ...meta, sha: null, dirty: true };
  saveMeta();
  dialog.close();
  sync.run();
});

$('#settings-clear').addEventListener('click', () => {
  settings = null;
  try { localStorage.removeItem(KEY_SETTINGS); } catch { /* rien */ }
  dialog.close();
  setStatus('local');
});

/* ---------------- Thème clair / sombre ---------------- */

// Deux thèmes seulement. Au tout premier lancement, on suit le réglage de l'appareil.
const THEME_TITLES = { light: 'Passer en thème sombre', dark: 'Passer en thème clair' };
const themeBtn = $('#theme-toggle');

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  themeBtn.dataset.mode = theme;
  themeBtn.title = THEME_TITLES[theme];
  themeBtn.setAttribute('aria-label', THEME_TITLES[theme]);
  document.querySelectorAll('meta[name="theme-color"]').forEach(m => m.setAttribute('content', theme === 'dark' ? '#1c1c1e' : '#f7f5ef'));
}

themeBtn.addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  try { localStorage.setItem(KEY_THEME, next); } catch { /* rien */ }
  applyTheme(next);
});

/* ---------------- Démarrage ---------------- */

let savedView = 'notes';
let savedTheme = null;
try {
  savedView = localStorage.getItem(KEY_VIEW) || 'notes';
  savedTheme = localStorage.getItem(KEY_THEME);
} catch { /* rien */ }
if (savedTheme !== 'light' && savedTheme !== 'dark') {
  savedTheme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
applyTheme(savedTheme);
setView(savedView);
renderAll();
placeToolbar();
setStatus('local');
sync.run();

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  // Mise à jour automatique : quand une nouvelle version est publiée, l'app se recharge toute seule
  // (sauf si tu es en train d'écrire : elle attend que tu quittes la ligne)
  const hadController = !!navigator.serviceWorker.controller;
  let reloadPending = false;
  const reloadWhenIdle = () => {
    if (!document.activeElement?.closest?.('.text, input, textarea, dialog[open]')) location.reload();
    else reloadPending = true;
  };
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController) reloadWhenIdle(); });
  document.addEventListener('focusout', () => { if (reloadPending) setTimeout(reloadWhenIdle, 300); });

  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(reg => {
    // Vérifie s'il y a une nouvelle version à chaque retour sur l'app, et toutes les 10 minutes
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') reg.update().catch(() => {});
    });
    setInterval(() => reg.update().catch(() => {}), 10 * 60_000);
  }).catch(() => { /* hors ligne non disponible */ });
}
