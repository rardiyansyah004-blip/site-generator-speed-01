// Fast drop-in for makefun-site 1.0.0 (site-generator-speed-01).
// Own implementation of the same build, written for speed: single-pass
// Markdown, chunked HTML escaping, memoised slugs, one card per source,
// and a flat template renderer. No imports, no dependencies.
// Semantics follow makefun-site's README and reference code exactly:
// byte-for-byte output for every input.

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const ESC = { 38: '&amp;', 60: '&lt;', 62: '&gt;', 34: '&quot;', 39: '&#39;' };
const RESERVED = ['posts', 'tags', 'page'];

/** Code-unit order. */
function byCodeUnits(a, b) { return a < b ? -1 : a > b ? 1 : 0; }

const ESC_RE = /[&<>"']/;
/** Escape &, <, >, ", '. Fast path returns the input unchanged when it holds none. */
function escapeHtml(text) {
  const first = text.search(ESC_RE);
  if (first === -1) return text;
  let out = text.slice(0, first);
  for (let i = first; i < text.length; i++) {
    const e = ESC[text.charCodeAt(i)];
    out += e === undefined ? text[i] : e;
  }
  return out;
}

/** Slug of text, memoised per build in `cache`. */
function slugify(text, cache) {
  const hit = cache.get(text);
  if (hit !== undefined) return hit;
  const plain = text.normalize('NFKD').replace(/\p{M}/gu, '');
  let out = '';
  let gap = false;
  for (let i = 0; i < plain.length; i++) {
    const c = plain.charCodeAt(i);
    let keep = 0;
    if (c >= 65 && c <= 90) keep = c + 32;
    else if ((c >= 97 && c <= 122) || (c >= 48 && c <= 57)) keep = c;
    if (keep === 0) { gap = out.length > 0; continue; }
    if (gap) out += '-';
    gap = false;
    out += String.fromCharCode(keep);
  }
  if (out.length > 64) out = out.slice(0, 64);
  let end = out.length;
  while (end > 0 && out.charCodeAt(end - 1) === 45) end--;
  if (end !== out.length) out = out.slice(0, end);
  if (out === '') out = 'untitled';
  cache.set(text, out);
  return out;
}

/** First of slug, slug-2, slug-3 ... not taken (added to `taken`). */
function uniqueSlug(slug, taken) {
  if (!taken.has(slug)) { taken.add(slug); return slug; }
  let n = 2;
  let out = slug + '-2';
  while (taken.has(out)) { n++; out = slug + '-' + n; }
  taken.add(out);
  return out;
}

/** YYYY-MM-DD in words, from the string alone. */
function longDate(date) {
  const y = date.slice(0, 4);
  const m = Number(date.slice(5, 7));
  const d = Number(date.slice(8, 10));
  return d + ' ' + MONTHS[m - 1] + ' ' + y;
}

const dirOf = (path) => { const i = path.lastIndexOf('/'); return i === -1 ? '' : path.slice(0, i); };

function resolvePath(dir, rel) {
  const parts = dir === '' ? [] : dir.split('/');
  const segs = rel.split('/');
  for (let k = 0; k < segs.length; k++) {
    const seg = segs[k];
    if (seg === '' || seg === '.') continue;
    if (seg === '..') { if (parts.length === 0) return null; parts.pop(); }
    else parts.push(seg);
  }
  return parts.join('/');
}

// ---------------------------------------------------------------- front matter

const KEYS = ['title', 'date', 'tags', 'draft', 'layout', 'slug', 'summary'];

function daysIn(y, m) {
  if (m === 2) return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28;
  return m === 4 || m === 6 || m === 9 || m === 11 ? 30 : 31;
}

function stringOf(raw) {
  if (raw.charCodeAt(0) === 34) {
    if (raw.length < 2 || raw.charCodeAt(raw.length - 1) !== 34) return { error: 'a quoted string is not closed' };
    let out = '';
    for (let i = 1; i < raw.length - 1; i++) {
      const c = raw[i];
      if (c === '\\') {
        const n = raw[i + 1];
        if ((n !== '"' && n !== '\\') || i + 1 === raw.length - 1) return { error: 'a quoted string holds an escape other than \\" or \\\\' };
        out += n;
        i++;
      } else if (c === '"') return { error: 'a quoted string holds a stray quote' };
      else out += c;
    }
    return { value: out };
  }
  if (raw.charCodeAt(0) === 91) return { error: 'a bare string opens on [' };
  return { value: raw };
}

function valueOf(key, raw) {
  switch (key) {
    case 'title':
    case 'summary': {
      const s = stringOf(raw);
      return 'error' in s ? { error: 'key "' + key + '": ' + s.error } : s;
    }
    case 'date': {
      const ok = raw.length === 10 && raw.charCodeAt(4) === 45 && raw.charCodeAt(7) === 45;
      let y = 0, mo = 0, d = 0;
      if (ok) {
        y = Number(raw.slice(0, 4)); mo = Number(raw.slice(5, 7)); d = Number(raw.slice(8, 10));
      }
      if (!ok || !/^\d{4}-\d{2}-\d{2}$/.test(raw) || y < 1970 || y > 2099 || mo < 1 || mo > 12 || d < 1 || d > daysIn(y, mo))
        return { error: 'key "date": not a date from 1970-01-01 to 2099-12-31 (YYYY-MM-DD)' };
      return { value: raw };
    }
    case 'tags': {
      if (raw.charCodeAt(0) !== 91 || raw.charCodeAt(raw.length - 1) !== 93) return { error: 'key "tags": not a list [a, b]' };
      const inner = raw.slice(1, -1);
      if (inner.trim() === '') return { value: [] };
      const tags = inner.split(',');
      for (let i = 0; i < tags.length; i++) {
        tags[i] = tags[i].trim();
        const t = tags[i];
        if (t === '' || t.indexOf('"') !== -1 || t.indexOf('[') !== -1 || t.indexOf(']') !== -1)
          return { error: 'key "tags": an empty tag, or one holding " [ or ]' };
      }
      return { value: tags };
    }
    case 'draft':
      return raw === 'true' ? { value: true } : raw === 'false' ? { value: false } : { error: 'key "draft": true or false' };
    case 'layout': {
      let good = raw.length > 0;
      for (let i = 0; i < raw.length && good; i++) {
        const c = raw.charCodeAt(i);
        good = (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 45;
      }
      return good ? { value: raw } : { error: 'key "layout": not a template name' };
    }
    case 'slug': {
      let good = raw.length > 0 && raw.length <= 64;
      let prevDash = true;
      for (let i = 0; i < raw.length && good; i++) {
        const c = raw.charCodeAt(i);
        const alnum = (c >= 97 && c <= 122) || (c >= 48 && c <= 57);
        if (c === 45) { if (prevDash) good = false; prevDash = true; }
        else if (alnum) prevDash = false;
        else good = false;
      }
      if (prevDash) good = false;
      return good ? { value: raw } : { error: 'key "slug": not a slug' };
    }
    default:
      return { error: 'unknown key "' + key + '"' };
  }
}

function isBlank(line) {
  for (let i = 0; i < line.length; i++) { const c = line.charCodeAt(i); if (c !== 32 && c !== 9) return false; }
  return true;
}

function trimEndST(s) {
  let e = s.length;
  while (e > 0) { const c = s.charCodeAt(e - 1); if (c !== 32 && c !== 9) break; e--; }
  return s.slice(0, e);
}

function trimLine(line) {
  let a = 0, b = line.length;
  while (a < b) { const c = line.charCodeAt(a); if (c !== 32 && c !== 9) break; a++; }
  while (b > a) { const c = line.charCodeAt(b - 1); if (c !== 32 && c !== 9) break; b--; }
  return line.slice(a, b);
}

/**
 * Parse front matter from `lines` (already split). Returns { data, bodyStart }
 * or { error }. bodyStart is the index of the first body line.
 */
function parseFrontMatter(lines) {
  if (lines.length === 0 || lines[0] !== '---') return { error: 'no front matter' };
  let close = -1;
  for (let i = 1; i < lines.length; i++) { if (lines[i] === '---') { close = i; break; } }
  if (close === -1) return { error: 'the front matter is not closed' };
  const data = {};
  for (let i = 1; i < close; i++) {
    const line = lines[i];
    if (isBlank(line) || line.charCodeAt(0) === 35) continue;
    const colon = line.indexOf(':');
    if (colon === -1) return { error: 'line ' + (i + 1) + ' is not "key: value"' };
    const key = line.slice(0, colon);
    let keyOk = key.length > 0;
    for (let k = 0; k < key.length && keyOk; k++) {
      const c = key.charCodeAt(k);
      keyOk = (c >= 97 && c <= 122) || c === 95;
    }
    if (!keyOk) return { error: 'line ' + (i + 1) + ' is not "key: value"' };
    const rest = line.slice(colon + 1);
    let raw;
    if (rest === '') raw = '';
    else if (rest.charCodeAt(0) === 32) raw = rest.slice(1);
    else return { error: 'line ' + (i + 1) + ' is not "key: value"' };
    raw = trimEndST(raw);
    if (KEYS.indexOf(key) === -1) return { error: 'unknown key "' + key + '"' };
    if (Object.hasOwn(data, key)) return { error: 'key "' + key + '" is given twice' };
    if (raw === '') return { error: 'key "' + key + '" has no value' };
    const v = valueOf(key, raw);
    if ('error' in v) return v;
    data[key] = v.value;
  }
  if (!Object.hasOwn(data, 'title')) return { error: 'no title' };
  return { data, bodyStart: close + 1 };
}

// ---------------------------------------------------------------- markdown

const ESCAPABLE = new Set(['\\', '`', '*', '_', '[', ']', '(', ')', '#', '+', '-', '.', '!', '>']);

function findUnescaped(s, what, from) {
  for (let j = from; j <= s.length - what.length; j++) {
    if (s[j] === '\\' && j + 1 < s.length && ESCAPABLE.has(s[j + 1])) { j++; continue; }
    if (s.startsWith(what, j)) return j;
  }
  return -1;
}

function findSingleStar(s, from) {
  for (let j = from; j < s.length; j++) {
    const c = s[j];
    if (c === '\\' && j + 1 < s.length && ESCAPABLE.has(s[j + 1])) { j++; continue; }
    if (c !== '*') continue;
    if (s[j + 1] === '*') { j++; continue; }
    return j;
  }
  return -1;
}

/** Inline rendering into `out` (array of pieces). `env` resolves link targets. */
function inlineInto(s, env, out) {
  let i = 0;
  let start = 0;
  const n = s.length;
  const flush = (to) => { if (to > start) out.push(escapeHtml(s.slice(start, to))); };
  while (i < n) {
    // Jump to the next inline-significant character (C++ indexOf scans).
    let next = s.indexOf('\\', i);
    if (next === -1) next = n;
    let j = s.indexOf('`', i);
    if (j !== -1 && j < next) next = j;
    j = s.indexOf('*', i);
    if (j !== -1 && j < next) next = j;
    j = s.indexOf('[', i);
    if (j !== -1 && j < next) next = j;
    if (next === n) break;
    i = next;
    const c = s[i];
    if (c === '\\' && i + 1 < n && ESCAPABLE.has(s[i + 1])) {
      flush(i);
      out.push(escapeHtml(s[i + 1]));
      i += 2; start = i;
      continue;
    }
    if (c === '`') {
      const j = s.indexOf('`', i + 1);
      if (j > i + 1) {
        flush(i);
        out.push('<code>', escapeHtml(s.slice(i + 1, j)), '</code>');
        i = j + 1; start = i;
      } else { i++; }
      continue;
    }
    if (c === '*') {
      if (s[i + 1] === '*') {
        const j = findUnescaped(s, '**', i + 2);
        if (j > i + 2) {
          flush(i);
          out.push('<strong>');
          inlineInto(s.slice(i + 2, j), env, out);
          out.push('</strong>');
          i = j + 2; start = i;
        } else { i += 2; }
        continue;
      }
      const j = findSingleStar(s, i + 1);
      if (j > i + 1) {
        flush(i);
        out.push('<em>');
        inlineInto(s.slice(i + 1, j), env, out);
        out.push('</em>');
        i = j + 1; start = i;
      } else { i++; }
      continue;
    }
    if (c === '[') {
      const k = findUnescaped(s, ']', i + 1);
      const m = k !== -1 && s[k + 1] === '(' ? s.indexOf(')', k + 2) : -1;
      const target = m === -1 ? '' : s.slice(k + 2, m);
      if (target !== '' && !/\s/.test(target)) {
        flush(i);
        out.push('<a href="', escapeHtml(env.link(target)), '">');
        inlineInto(s.slice(i + 1, k), env, out);
        out.push('</a>');
        i = m + 1; start = i;
        continue;
      }
      i++;
      continue;
    }
    i++;
  }
  flush(n);
}

function inline(s, env) {
  const out = [];
  inlineInto(s, env, out);
  return out.join('');
}

/** Heading info for a line, or null. */
function headingOf(line) {
  let h = 0;
  while (h < 6 && line.charCodeAt(h) === 35) h++;
  if (h === 0) return null;
  if (h === 6 && line.charCodeAt(6) === 35) return null; // 7+ hashes: not a heading
  let s = h;
  if (line.charCodeAt(s) !== 32 && line.charCodeAt(s) !== 9) return null;
  while (s < line.length && (line.charCodeAt(s) === 32 || line.charCodeAt(s) === 9)) s++;
  let e = line.length;
  while (e > s) { const cc = line.charCodeAt(e - 1); if (cc !== 32 && cc !== 9) break; e--; }
  if (e === s) return null;
  return { depth: h, text: line.slice(s, e) };
}

function isFenceOpen(line) {
  if (!line.startsWith('```')) return null;
  let i = 3;
  while (i < line.length) {
    const c = line.charCodeAt(i);
    if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 95 || c === 43 || c === 45) i++;
    else break;
  }
  const lang = line.slice(3, i);
  while (i < line.length) { const c = line.charCodeAt(i); if (c !== 32 && c !== 9) return null; i++; }
  return lang;
}

function isFenceClose(line) {
  if (!line.startsWith('```')) return false;
  for (let i = 3; i < line.length; i++) { const c = line.charCodeAt(i); if (c !== 32 && c !== 9) return false; }
  return true;
}

function isHr(line) {
  if (line !== '---' && line !== '***') {
    if (!line.startsWith('---') && !line.startsWith('***')) return false;
    const head = line.slice(0, 3);
    if (head !== '---' && head !== '***') return false;
    for (let i = 3; i < line.length; i++) { const c = line.charCodeAt(i); if (c !== 32 && c !== 9) return false; }
    return true;
  }
  return true;
}

function endsParagraph(line) {
  return isBlank(line) || isFenceOpen(line) !== null || headingOf(line) !== null || isHr(line);
}

/**
 * Render Markdown lines [from, to) to HTML. Returns { html, toc, excerpt }.
 * `env` resolves link targets; `slugCache` memoises slugs.
 */
function renderMarkdown(lines, from, to, env, slugCache) {
  const ids = new Set();
  const blocks = [];
  const toc = [];
  let excerpt = null;
  let i = from;
  while (i < to) {
    const line = lines[i];
    if (isBlank(line)) { i++; continue; }
    const lang = isFenceOpen(line);
    if (lang !== null) {
      i++;
      const body = [];
      while (i < to && !isFenceClose(lines[i])) body.push(lines[i++]);
      i++;
      const cls = lang === '' ? '' : ' class="language-' + escapeHtml(lang) + '"';
      let code = '';
      for (let k = 0; k < body.length; k++) code += escapeHtml(body[k]) + '\n';
      blocks.push('<pre><code' + cls + '>' + code + '</code></pre>');
      continue;
    }
    const heading = headingOf(line);
    if (heading !== null) {
      const id = uniqueSlug(slugify(heading.text, slugCache), ids);
      const html = inline(heading.text, env);
      blocks.push('<h' + heading.depth + ' id="' + id + '">' + html + '</h' + heading.depth + '>');
      if (heading.depth === 2 || heading.depth === 3) toc.push({ level: heading.depth, id, html });
      i++;
      continue;
    }
    if (isHr(line)) { blocks.push('<hr>'); i++; continue; }
    if (line.charCodeAt(0) === 62) {
      const body = [];
      while (i < to && lines[i].charCodeAt(0) === 62) {
        let l = lines[i++];
        l = l.startsWith('> ') ? l.slice(2) : l.slice(1);
        l = trimLine(l);
        if (l !== '') body.push(l);
      }
      blocks.push(body.length === 0 ? '<blockquote>\n</blockquote>' : '<blockquote>\n<p>' + inline(body.join('\n'), env) + '</p>\n</blockquote>');
      continue;
    }
    const bullet = (line.startsWith('- ') || line.startsWith('* ')) ? line[0] : null;
    let ordered = null;
    if (bullet === null) {
      const dot = line.indexOf('. ');
      if (dot > 0 && dot <= 9) {
        let digits = true;
        for (let k = 0; k < dot; k++) { const c = line.charCodeAt(k); if (c < 48 || c > 57) { digits = false; break; } }
        if (digits) ordered = { num: line.slice(0, dot), rest: line.slice(dot + 2) };
      }
    }
    if (bullet !== null || ordered !== null) {
      const isOrdered = ordered !== null;
      const items = [];
      while (i < to) {
        const l = lines[i];
        if (isOrdered) {
          const dot = l.indexOf('. ');
          let ok = false;
          if (dot > 0 && dot <= 9) {
            ok = true;
            for (let k = 0; k < dot; k++) { const c = l.charCodeAt(k); if (c < 48 || c > 57) { ok = false; break; } }
          }
          if (ok) { items.push([trimLine(l.slice(dot + 2))]); i++; continue; }
        } else if (l.startsWith('- ') || l.startsWith('* ')) {
          // same kind only: baseline's marker is /^[-*] / so either - or * continues
          items.push([trimLine(l.slice(2))]); i++; continue;
        }
        if (l.length >= 3 && l.charCodeAt(0) === 32 && l.charCodeAt(1) === 32 && l.charCodeAt(2) !== 32 && l.charCodeAt(2) !== 9) {
          items[items.length - 1].push(trimLine(l)); i++; continue;
        }
        break;
      }
      const tag = isOrdered ? 'ol' : 'ul';
      const open = isOrdered && Number(ordered.num) !== 1 ? '<ol start="' + ordered.num + '">' : '<' + tag + '>';
      let html = open + '\n';
      for (let k = 0; k < items.length; k++) html += '<li>' + inline(items[k].join('\n'), env) + '</li>\n';
      html += '</' + tag + '>';
      blocks.push(html);
      continue;
    }
    const body = [trimLine(line)];
    i++;
    while (i < to && !endsParagraph(lines[i])) body.push(trimLine(lines[i++]));
    const html = inline(body.join('\n'), env);
    if (excerpt === null) excerpt = html;
    blocks.push('<p>' + html + '</p>');
  }
  let html = '';
  for (let k = 0; k < blocks.length; k++) html += blocks[k] + '\n';
  return { html, toc, excerpt: excerpt ?? '' };
}

// ---------------------------------------------------------------- templates

class TemplateError extends Error {}

const PATH_RE = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/;
const FOR_RE = /^for ([A-Za-z_][A-Za-z0-9_]*) in (\S+)$/;
const IF_RE = /^if (not )?(\S+)$/;
const INCLUDE_RE = /^include "([a-z0-9-]+)"$/;
const INCLUDE_DEPTH = 8;

function pathOf(name, text) {
  if (!PATH_RE.test(text)) throw new TemplateError('template "' + name + '": ' + JSON.stringify(text) + ' is not a path');
  return text.split('.');
}

function tokenize(name, src) {
  const tokens = [];
  let text = '';
  let i = 0;
  while (i < src.length) {
    const open = src.indexOf('{', i);
    if (open === -1 || open === src.length - 1) { text += src.slice(i); break; }
    const next = src[open + 1];
    if (next !== '{' && next !== '%') { text += src.slice(i, open + 1); i = open + 1; continue; }
    text += src.slice(i, open);
    if (next === '{') {
      const raw = src[open + 2] === '{';
      const close = src.indexOf(raw ? '}}}' : '}}', open + (raw ? 3 : 2));
      if (close === -1) throw new TemplateError('template "' + name + '": a ' + (raw ? '{{{' : '{{') + ' is not closed');
      if (text !== '') tokens.push({ t: 'text', text });
      text = '';
      tokens.push({ t: raw ? 'raw' : 'var', path: pathOf(name, src.slice(open + (raw ? 3 : 2), close).trim()) });
      i = close + (raw ? 3 : 2);
      continue;
    }
    const close = src.indexOf('%}', open + 2);
    if (close === -1) throw new TemplateError('template "' + name + '": a {% is not closed');
    const end = close + 2;
    const lineStart = src.lastIndexOf('\n', open - 1) + 1;
    const nl = src.indexOf('\n', end);
    const lineEnd = nl === -1 ? src.length : nl;
    const standalone = /^[ \t]*$/.test(src.slice(lineStart, open)) && /^[ \t]*$/.test(src.slice(end, lineEnd));
    if (standalone) text = text.slice(0, text.length - (open - lineStart));
    if (text !== '') tokens.push({ t: 'text', text });
    text = '';
    tokens.push({ t: 'tag', tag: src.slice(open + 2, close).trim() });
    i = standalone ? (nl === -1 ? src.length : nl + 1) : end;
  }
  if (text !== '') tokens.push({ t: 'text', text });
  return tokens;
}

function parseTemplate(name, src) {
  const root = { kind: 'root', body: [] };
  const stack = [root];
  let body = root.body;
  for (const tok of tokenize(name, src)) {
    if (tok.t === 'text') body.push({ kind: 'text', text: tok.text });
    else if (tok.t === 'var' || tok.t === 'raw') body.push({ kind: tok.t, path: tok.path });
    else {
      const tag = tok.tag;
      const top = stack[stack.length - 1];
      let m;
      if ((m = FOR_RE.exec(tag)) !== null) {
        const node = { kind: 'for', name: m[1], path: pathOf(name, m[2]), body: [] };
        body.push(node);
        stack.push(node);
        body = node.body;
      } else if ((m = IF_RE.exec(tag)) !== null) {
        const node = { kind: 'if', not: m[1] !== undefined, path: pathOf(name, m[2]), then: [], else: null };
        body.push(node);
        stack.push(node);
        body = node.then;
      } else if (tag === 'else') {
        if (top.kind !== 'if' || top.else !== null) throw new TemplateError('template "' + name + '": an else outside an if');
        top.else = [];
        body = top.else;
      } else if (tag === 'endfor' || tag === 'endif') {
        if (top.kind !== (tag === 'endfor' ? 'for' : 'if')) throw new TemplateError('template "' + name + '": an ' + tag + ' with no open ' + tag.slice(3));
        stack.pop();
        const parent = stack[stack.length - 1];
        body = parent.kind === 'root' ? parent.body : parent.kind === 'for' ? parent.body : parent.else ?? parent.then;
      } else if ((m = INCLUDE_RE.exec(tag)) !== null) body.push({ kind: 'include', name: m[1] });
      else throw new TemplateError('template "' + name + '": {% ' + tag + ' %} is not a tag');
    }
  }
  if (stack.length > 1) throw new TemplateError('template "' + name + '": a ' + stack[stack.length - 1].kind + ' is not closed');
  return root.body;
}

function lookup(scopes, path) {
  for (let s = scopes.length - 1; s >= 0; s--) {
    const vars = scopes[s];
    if (vars.__for === true) {
      if (path[0] === vars.name) {
        let v = vars.value;
        for (let k = 1; k < path.length; k++) {
          if (v === null || typeof v !== 'object' || !Object.hasOwn(v, path[k])) return undefined;
          v = v[path[k]];
        }
        return v;
      }
      if (path[0] === 'loop') {
        let v = vars.loop;
        for (let k = 1; k < path.length; k++) {
          if (v === null || typeof v !== 'object' || !Object.hasOwn(v, path[k])) return undefined;
          v = v[path[k]];
        }
        return v;
      }
      continue;
    }
    if (Object.hasOwn(vars, path[0])) {
      let v = vars[path[0]];
      for (let k = 1; k < path.length; k++) {
        if (v === null || typeof v !== 'object' || !Object.hasOwn(v, path[k])) return undefined;
        v = v[path[k]];
      }
      return v;
    }
  }
  return undefined;
}

function textOf(v) {
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (Array.isArray(v)) return v.map(textOf).join(', ');
  return '';
}

function truthy(v) {
  if (Array.isArray(v)) return v.length > 0;
  return v !== undefined && v !== null && v !== false && v !== '' && v !== 0;
}

/** Render `nodes` into `out` (array). `scopes` is a stack of vars objects. */
function renderNodes(nodes, scopes, ctx, depth, out) {
  for (let ni = 0; ni < nodes.length; ni++) {
    const n = nodes[ni];
    switch (n.kind) {
      case 'text':
        out.push(n.text);
        break;
      case 'var':
        out.push(escapeHtml(textOf(lookup(scopes, n.path))));
        break;
      case 'raw':
        out.push(textOf(lookup(scopes, n.path)));
        break;
      case 'if': {
        const v = truthy(lookup(scopes, n.path));
        const branch = v !== n.not ? n.then : n.else;
        if (branch !== null) renderNodes(branch, scopes, ctx, depth, out);
        break;
      }
      case 'for': {
        const xs = lookup(scopes, n.path);
        if (!Array.isArray(xs)) break;
        const len = xs.length;
        // One reusable frame per for-node per include depth: no object
        // allocated per element, and include recursion stays correct.
        let frames = n.frames;
        if (frames === undefined) { frames = []; n.frames = frames; }
        let frame = frames[depth];
        if (frame === undefined) { frame = { __for: true, name: n.name, value: undefined, loop: { index: 0, first: false, last: false, length: 0 } }; frames[depth] = frame; }
        frame.loop.length = len;
        scopes.push(frame);
        for (let k = 0; k < len; k++) {
          frame.value = xs[k];
          frame.loop.index = k + 1;
          frame.loop.first = k === 0;
          frame.loop.last = k === len - 1;
          renderNodes(n.body, scopes, ctx, depth, out);
        }
        scopes.pop();
        break;
      }
      case 'include': {
        const t = ctx.templates.get(n.name);
        if (t !== undefined && depth < INCLUDE_DEPTH) renderNodes(t, scopes, ctx, depth + 1, out);
        break;
      }
    }
  }
}

// ---------------------------------------------------------------- build

function wordsOf(text) {
  // Count runs of non-whitespace. ASCII fast path; any non-ASCII char falls
  // back to the regex so Unicode whitespace matches /\S/ exactly.
  for (let i = 0; i < text.length; i++) { if (text.charCodeAt(i) > 127) { const m = text.match(/\S+/g); return m === null ? 0 : m.length; } }
  let count = 0;
  let inWord = false;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    const ws = c === 32 || c === 9 || c === 10 || c === 13 || c === 11 || c === 12;
    if (ws) inWord = false;
    else if (!inWord) { inWord = true; count++; }
  }
  return count;
}

export function run(input) {
  const slugCache = new Map();
  const templates = new Map();
  const report = [];
  const names = Object.keys(input.templates).sort(byCodeUnits);
  for (let i = 0; i < names.length; i++) {
    const name = names[i];
    try {
      templates.set(name, parseTemplate(name, input.templates[name]));
    } catch (err) {
      if (!(err instanceof TemplateError)) throw err;
      report.push(err.message);
    }
  }
  const base = input.site.base_url.replace(/\/+$/, '');
  const output = {};
  const broken = new Set();
  const bySource = new Map();
  const statics = [];
  const sources = [];

  // 1+2. Sources in code-unit order of path, front matter checked in order.
  const files = [...input.files].sort((x, y) => byCodeUnits(x.path, y.path));
  for (let fi = 0; fi < files.length; fi++) {
    const f = files[fi];
    if (!f.path.endsWith('.md')) { statics.push(f); continue; }
    const lines = f.content.replace(/\r\n?/g, '\n').split('\n');
    const fm = parseFrontMatter(lines);
    if ('error' in fm) { report.push('refused ' + f.path + ': ' + fm.error); continue; }
    const s = { path: f.path, lines, bodyStart: fm.bodyStart, data: fm.data, post: f.path.startsWith('posts/') };
    let own = null;
    for (let d = 0; d < RESERVED.length; d++) {
      const dir = RESERVED[d];
      if (dir !== 'posts' && s.path.startsWith(dir + '/')) { own = dir; break; }
    }
    if (own !== null) { report.push('refused ' + f.path + ': ' + own + '/ is the generator\'s own'); continue; }
    if (s.post && !Object.hasOwn(s.data, 'date')) { report.push('refused ' + f.path + ': a post needs a date'); continue; }
    const layout = s.data.layout ?? (s.post ? 'post' : 'page');
    if (!templates.has(layout)) { report.push('refused ' + f.path + ': layout "' + layout + '" is no template that parses'); continue; }
    s.layout = layout;
    if (s.data.draft === true) { report.push('draft ' + f.path); continue; }
    sources.push(s);
  }

  // 3. Permalinks.
  const taken = new Map();
  for (let i = 0; i < sources.length; i++) {
    const s = sources[i];
    const dir = s.post ? 'posts' : dirOf(s.path);
    let set = taken.get(dir);
    if (set === undefined) { set = new Set(dir === '' ? RESERVED : []); taken.set(dir, set); }
    const slug = uniqueSlug(s.data.slug ?? slugify(s.data.title, slugCache), set);
    s.slug = slug;
    s.outDir = dir === '' ? slug : dir + '/' + slug;
    s.url = base + '/' + s.outDir + '/';
    bySource.set(s.path, s);
  }

  // 4. Markdown.
  const staticPaths = new Set();
  for (let i = 0; i < statics.length; i++) staticPaths.add(statics[i].path);
  for (let i = 0; i < sources.length; i++) {
    const s = sources[i];
    const dir = dirOf(s.path);
    const env = {
      link: (target) => {
        if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(target) || target.startsWith('/') || target.startsWith('#')) return target;
        const hash = target.indexOf('#');
        const rel = hash === -1 ? target : target.slice(0, hash);
        const frag = hash === -1 ? '' : target.slice(hash);
        const path = rel === '' ? null : resolvePath(dir, rel);
        if (path !== null && bySource.has(path)) return bySource.get(path).url + frag;
        if (path !== null && staticPaths.has(path)) return base + '/' + path + frag;
        broken.add('broken-link ' + s.path + ' -> ' + target);
        return target;
      },
    };
    const md = renderMarkdown(s.lines, s.bodyStart, s.lines.length, env, slugCache);
    s.html = md.html;
    s.toc = md.toc;
    s.excerpt = md.excerpt;
    s.body = s.lines.slice(s.bodyStart).join('\n');
  }

  // 5. Collections.
  const posts = [];
  for (let i = 0; i < sources.length; i++) if (sources[i].post) posts.push(sources[i]);
  posts.sort((x, y) => byCodeUnits(y.data.date, x.data.date) || byCodeUnits(x.slug, y.slug));
  for (let k = 0; k < posts.length; k++) {
    posts[k].newer = k === 0 ? null : posts[k - 1];
    posts[k].older = k === posts.length - 1 ? null : posts[k + 1];
  }

  // 6. Tags.
  const bySlug = new Map();
  const ownTags = (s) => {
    const seen = new Set();
    const out = [];
    const tags = s.data.tags ?? [];
    for (let i = 0; i < tags.length; i++) {
      const name = tags[i];
      const slug = slugify(name, slugCache);
      if (seen.has(slug)) continue;
      seen.add(slug);
      out.push(name);
    }
    return out;
  };
  for (let i = 0; i < posts.length; i++) {
    const p = posts[i];
    p.tagRefs = [];
    const names2 = ownTags(p);
    for (let j = 0; j < names2.length; j++) {
      const name = names2[j];
      const slug = slugify(name, slugCache);
      let tag = bySlug.get(slug);
      if (tag === undefined) { tag = { name, slug, url: base + '/tags/' + slug + '/', posts: [] }; bySlug.set(slug, tag); }
      tag.posts.push(p);
      p.tagRefs.push(tag);
    }
  }
  for (let i = 0; i < sources.length; i++) {
    const s = sources[i];
    if (s.post) continue;
    const names2 = ownTags(s);
    s.tagRefs = [];
    for (let j = 0; j < names2.length; j++) {
      const name = names2[j];
      const slug = slugify(name, slugCache);
      const t = bySlug.get(slug);
      s.tagRefs.push(t !== undefined ? t : { name, slug, url: '', posts: [] });
    }
  }
  const tags = [...bySlug.values()].sort((x, y) => y.posts.length - x.posts.length || byCodeUnits(x.slug, y.slug));

  // Cards and page objects, built once per source and reused.
  const linkOf = (s) => (s === null ? null : { title: s.data.title, url: s.url, date: s.data.date ?? '', date_long: s.data.date === undefined ? '' : longDate(s.data.date) });
  for (let i = 0; i < sources.length; i++) {
    const s = sources[i];
    s.card = {
      title: s.data.title,
      url: s.url,
      date: s.data.date ?? '',
      date_long: s.data.date === undefined ? '' : longDate(s.data.date),
      summary: s.data.summary ?? '',
      excerpt: s.excerpt,
      reading_minutes: Math.max(1, Math.ceil(wordsOf(s.body) / 200)),
      tags: s.tagRefs.map((t) => ({ name: t.name, slug: t.slug, url: t.url })),
    };
    s.pageObj = {
      ...s.card,
      slug: s.slug,
      content: s.html,
      toc: s.toc.map((h) => ({ level: h.level, id: h.id, html: h.html })),
      newer: linkOf(s.newer ?? null),
      older: linkOf(s.older ?? null),
      is_post: s.post,
    };
  }

  // 7. Layouts.
  const site = { title: input.site.title, base_url: base };
  const allTags = tags.map((t) => ({ name: t.name, slug: t.slug, url: t.url, count: t.posts.length }));
  const recent = posts.slice(0, input.site.recent).map((p) => p.card);
  const ctx = { templates };
  const render = (name, vars) => {
    const nodes = templates.get(name);
    if (nodes === undefined) return null;
    const out = [];
    renderNodes(nodes, [{ site, tags: allTags, recent, ...vars }], ctx, 0, out);
    return out.join('');
  };
  for (let i = 0; i < sources.length; i++) {
    const s = sources[i];
    output[s.outDir + '/index.html'] = render(s.layout, { page: s.pageObj });
  }
  const per = input.site.per_page;
  const pages = Math.max(1, Math.ceil(posts.length / per));
  const indexUrl = (k) => (k === 1 ? base + '/' : base + '/page/' + k + '/');
  for (let k = 1; k <= pages; k++) {
    const html = render('index', {
      posts: posts.slice((k - 1) * per, k * per).map((p) => p.card),
      pager: { number: k, total: pages, url: indexUrl(k), newer_url: k === 1 ? '' : indexUrl(k - 1), older_url: k === pages ? '' : indexUrl(k + 1) },
    });
    if (html !== null) output[k === 1 ? 'index.html' : 'page/' + k + '/index.html'] = html;
  }
  for (let i = 0; i < tags.length; i++) {
    const t = tags[i];
    const html = render('tag', { tag: { name: t.name, slug: t.slug, url: t.url, count: t.posts.length, posts: t.posts.map((p) => p.card) } });
    if (html !== null) output['tags/' + t.slug + '/index.html'] = html;
  }
  const tagsHtml = render('tags', {});
  if (tagsHtml !== null) output['tags/index.html'] = tagsHtml;
  for (let i = 0; i < statics.length; i++) {
    const f = statics[i];
    if (Object.hasOwn(output, f.path)) report.push('shadowed ' + f.path + ': a built page has its path');
    else output[f.path] = f.content;
  }

  // 8. Report.
  const lines = [...report, ...broken].sort(byCodeUnits);
  let pages2 = 0;
  for (let i = 0; i < sources.length; i++) if (!sources[i].post) pages2++;
  lines.push('built ' + pages2 + ' pages, ' + posts.length + ' posts, ' + tags.length + ' tags and ' + statics.length + ' static files');
  output['build-report.txt'] = lines.join('\n') + '\n';
  return output;
}
