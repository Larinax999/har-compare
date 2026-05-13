(function(){
  'use strict';

  // ---- Error reporting ----
  var errbar = document.getElementById('errbar');
  function showErr(msg){ errbar.textContent = msg; errbar.classList.add('on'); }
  window.addEventListener('error', function(e){ showErr('JS error: ' + (e.message||e.error) + (e.filename?(' @ '+e.filename+':'+e.lineno):'')); });
  window.addEventListener('unhandledrejection', function(e){ showErr('Promise error: ' + (e.reason && e.reason.message || e.reason)); });

  // ---- Utilities ----
  function h(s){ return String(s==null?'':s).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
  function urlPath(u){ try { return new URL(u).pathname; } catch(_) { return u; } }
  function urlHostPath(u){ try { var x = new URL(u); return x.host + x.pathname; } catch(_) { return u; } }
  function urlMatchKey(m, u){ return (m||'').toUpperCase() + ' ' + urlPath(u); }
  function urlSyncKey(m, u, mode){
    var meth = (m||'').toUpperCase();
    if (mode === 'strict') return meth + ' ' + (u||'');
    return meth + ' ' + urlHostPath(u||'');
  }
  function truncUrl(u, max){ max = max||120; if (!u) return ''; if (u.length <= max) return u; var head = Math.floor(max*0.6), tail = max - head - 1; return u.slice(0, head) + '…' + u.slice(u.length - tail); }
  function getContentType(headers){
    if (!headers || !headers.length) return '';
    for (var i = 0; i < headers.length; i++) {
      if ((headers[i].name||'').toLowerCase() === 'content-type') {
        return String(headers[i].value||'').split(';')[0].trim().toLowerCase();
      }
    }
    return '';
  }
  function b64Decode(s){
    var bin = atob(s);
    var n = bin.length, bytes = new Uint8Array(n);
    for (var i = 0; i < n; i++) bytes[i] = bin.charCodeAt(i);
    try { return new TextDecoder('utf-8', { fatal: false }).decode(bytes); }
    catch(_) { return bin; }
  }
  function tryBase64Decode(text){
    if (!text) return { text: text, decoded: false };
    var t = String(text).replace(/\s+/g, '');
    if (!t || t.length % 4 !== 0 || !/^[A-Za-z0-9+/]+=*$/.test(t)) return { text: text, decoded: false };
    try { return { text: b64Decode(t), decoded: true }; }
    catch(_) { return { text: text, decoded: false }; }
  }
  function flattenJson(obj){
    var out = [];
    function walk(v, path){
      if (v === null || typeof v !== 'object') {
        out.push({ name: path || '(root)', value: v === undefined ? 'undefined' : (typeof v === 'string' ? v : JSON.stringify(v)) });
        return;
      }
      if (Array.isArray(v)) {
        if (v.length === 0) { out.push({ name: path + ' (empty array)', value: '[]' }); return; }
        for (var i = 0; i < v.length; i++) walk(v[i], path + '[' + i + ']');
        return;
      }
      var keys = Object.keys(v);
      if (keys.length === 0) { out.push({ name: path + ' (empty object)', value: '{}' }); return; }
      for (var k = 0; k < keys.length; k++) {
        var key = keys[k];
        var next = path ? path + '.' + key : key;
        walk(v[key], next);
      }
    }
    walk(obj, '');
    return out;
  }
  function parseForm(text){
    if (!text) return [];
    var pairs = String(text).split('&');
    var out = [];
    for (var i = 0; i < pairs.length; i++) {
      var p = pairs[i];
      if (!p) continue;
      var eq = p.indexOf('=');
      var name = eq === -1 ? p : p.slice(0, eq);
      var value = eq === -1 ? '' : p.slice(eq+1);
      try { name = decodeURIComponent(name.replace(/\+/g, ' ')); } catch(_) {}
      try { value = decodeURIComponent(value.replace(/\+/g, ' ')); } catch(_) {}
      out.push({ name: name, value: value });
    }
    return out;
  }
  function parseBody(text, contentType){
    if (!text) return { kind: 'empty', pairs: [] };
    var ct = (contentType||'').toLowerCase();
    var looksJson = ct.indexOf('json') !== -1;
    var looksForm = ct.indexOf('x-www-form-urlencoded') !== -1;
    if (!looksJson && !looksForm) {
      var t = String(text).trim();
      if (t && (t[0] === '{' || t[0] === '[')) looksJson = true;
    }
    if (looksJson) {
      try { return { kind: 'json', pairs: flattenJson(JSON.parse(text)) }; }
      catch(_) { /* fall through */ }
    }
    if (looksForm) {
      return { kind: 'form', pairs: parseForm(text) };
    }
    return { kind: 'none', pairs: null };
  }

  // ---- Method / status colors ----
  var METHOD_COLORS = {
    GET:     '#7ec7ff',
    POST:    '#ffd166',
    PUT:     '#ff9f5a',
    PATCH:   '#c39cff',
    DELETE:  '#ff7a7a',
    HEAD:    '#9fbdb2',
    OPTIONS: '#9fbdb2',
    CONNECT: '#bbbbbb',
    TRACE:   '#bbbbbb',
  };
  function methodColor(m){
    return METHOD_COLORS[(m||'').toUpperCase()] || '#cfd2d6';
  }
  var STATUS_HUES = { 1: 210, 2: 135, 3: 45, 4: 15, 5: 330 };
  function statusColor(s){
    var code = parseInt(s, 10);
    if (!code) return '';
    var cls = Math.floor(code / 100);
    var hueBase = STATUS_HUES[cls];
    if (hueBase == null) return '';
    var sub = code % 100;
    var hShift = ((sub * 13) % 25) - 12;
    var lShift = ((sub *  7) % 18) - 9;
    return 'hsl(' + (hueBase + hShift) + ',62%,' + (60 + lShift) + '%)';
  }

  function scrollSelectedIntoView(sideKey){
    var col = document.querySelector('.list-col[data-side="'+sideKey+'"]');
    var sel = col && col.querySelector('.entry.selected');
    if (sel && sel.scrollIntoView) sel.scrollIntoView({ block: 'nearest' });
  }

  // Set selection on one side, and — when auto-sync is on — also select the
  // matching entry on the other side. Re-renders both lists. Caller is
  // responsible for renderDiff() (and renderTabs() if the active tab changed).
  function selectEntry(sideKey, idx){
    state[sideKey].selIdx = idx;
    if (state.autoSync === 'off') {
      renderList(sideKey);
      return;
    }
    var clicked = state[sideKey].entries[idx];
    var otherKey = sideKey === 'left' ? 'right' : 'left';
    var matched = false;
    if (clicked) {
      var key = urlSyncKey(clicked.method, clicked.url, state.autoSync);
      // Occurrence index of the clicked entry among same-key entries on its own side
      var occurrence = 0;
      var sameSide = state[sideKey].entries;
      for (var s = 0; s < sameSide.length; s++) {
        if (sameSide[s].idx === clicked.idx) break;
        if (urlSyncKey(sameSide[s].method, sameSide[s].url, state.autoSync) === key) occurrence++;
      }
      var others = state[otherKey].entries;
      var lastMatchIdx = -1;
      var seen = 0;
      for (var i = 0; i < others.length; i++) {
        if (urlSyncKey(others[i].method, others[i].url, state.autoSync) === key) {
          lastMatchIdx = others[i].idx;
          if (state.matchNth) {
            if (seen === occurrence) { state[otherKey].selIdx = others[i].idx; matched = true; break; }
            seen++;
          } else {
            state[otherKey].selIdx = others[i].idx; matched = true; break;
          }
        }
      }
      // matchNth fallback: clicked is e.g. the 3rd duplicate but other side only has 1-2 — pick the last available
      if (!matched && state.matchNth && lastMatchIdx !== -1) {
        state[otherKey].selIdx = lastMatchIdx;
        matched = true;
      }
    }
    renderList('left'); renderList('right');
    if (matched && state.autoScroll) scrollSelectedIntoView(otherKey);
  }

  // ---- HAR parsing ----
  function parseHar(text){
    var har = JSON.parse(text);
    var entries = (har.log && har.log.entries) || [];
    return entries.map(function(e, idx){
      return {
        idx: idx,
        startedDateTime: e.startedDateTime || '',
        method: (e.request && e.request.method) || '',
        url: (e.request && e.request.url) || '',
        status: (e.response && e.response.status) || 0,
        raw: e,
      };
    });
  }

  // ---- Header alignment (ordered, case-sensitive) ----
  // Returns [{left,right,status}] where status ∈ equal|value_diff|case_diff|reorder|only_left|only_right
  function alignHeaders(L, R){
    var n = L.length, m = R.length;
    if (n === 0 && m === 0) return [];
    // LCS on byte-equal (name,value)
    var dp = new Array(n+1);
    for (var i = 0; i <= n; i++) dp[i] = new Int32Array(m+1);
    for (var i = n-1; i >= 0; i--) {
      for (var j = m-1; j >= 0; j--) {
        if (L[i].name === R[j].name && L[i].value === R[j].value) dp[i][j] = 1 + dp[i+1][j+1];
        else dp[i][j] = Math.max(dp[i+1][j], dp[i][j+1]);
      }
    }
    var pairOf = {}, revPair = {}, status = {};
    var ii = 0, jj = 0;
    while (ii < n && jj < m) {
      if (L[ii].name === R[jj].name && L[ii].value === R[jj].value) {
        pairOf[ii] = jj; revPair[jj] = ii; status[ii] = 'equal';
        ii++; jj++;
      } else if (dp[ii+1][jj] >= dp[ii][jj+1]) ii++;
      else jj++;
    }
    function pairRemaining(keyFn, st){
      var pool = {};
      for (var j = 0; j < m; j++) {
        if (j in revPair) continue;
        var k = keyFn(R[j]); if (k == null) continue;
        (pool[k] = pool[k] || []).push(j);
      }
      for (var i = 0; i < n; i++) {
        if (i in pairOf) continue;
        var k = keyFn(L[i]); if (k == null) continue;
        var arr = pool[k];
        if (arr && arr.length) {
          var j = arr.shift();
          pairOf[i] = j; revPair[j] = i; status[i] = st;
        }
      }
    }
    pairRemaining(function(x){ return x.name + '\x00' + x.value; }, 'reorder');
    pairRemaining(function(x){ return x.name; }, 'value_diff');
    pairRemaining(function(x){ return x.name.toLowerCase(); }, 'case_diff');

    var rows = [];
    var emitted = {};
    var i = 0, j = 0;
    while (i < n || j < m) {
      if (i < n) {
        if (i in pairOf) {
          var pj = pairOf[i];
          while (j < pj) {
            if (!(j in revPair) && !emitted[j]) { rows.push({left:null, right:R[j], status:'only_right'}); emitted[j] = true; }
            j++;
          }
          rows.push({ left: L[i], right: R[pj], status: status[i] });
          emitted[pj] = true;
          if (pj + 1 > j) j = pj + 1;
          i++;
        } else {
          rows.push({ left: L[i], right: null, status: 'only_left' });
          i++;
        }
      } else {
        while (j < m) {
          if (!emitted[j] && !(j in revPair)) rows.push({ left: null, right: R[j], status: 'only_right' });
          j++;
        }
      }
    }
    return rows;
  }

  // ---- Character-level diff for value_diff rows ----
  var CHAR_CAP = 1200;
  function charDiffHTML(a, b){
    if (a === b) { var s = h(a); return { left: s, right: s }; }
    if (a.length > CHAR_CAP || b.length > CHAR_CAP) return { left: h(a), right: h(b) };
    var n = a.length, m = b.length;
    var dp = new Array(n+1);
    for (var i = 0; i <= n; i++) dp[i] = new Uint16Array(m+1);
    for (var i = n-1; i >= 0; i--) {
      var dpi = dp[i], dpi1 = dp[i+1];
      for (var j = m-1; j >= 0; j--) {
        if (a.charCodeAt(i) === b.charCodeAt(j)) dpi[j] = 1 + dpi1[j+1];
        else { var x = dpi1[j], y = dpi[j+1]; dpi[j] = x > y ? x : y; }
      }
    }
    var ops = [];
    var i = 0, j = 0;
    while (i < n && j < m) {
      if (a.charCodeAt(i) === b.charCodeAt(j)) { ops.push(0); i++; j++; }
      else if (dp[i+1][j] >= dp[i][j+1]) { ops.push(-1); i++; }
      else { ops.push(1); j++; }
    }
    while (i < n) { ops.push(-1); i++; }
    while (j < m) { ops.push(1); j++; }
    var left = '', right = '', ai = 0, bi = 0, k = 0;
    while (k < ops.length) {
      if (ops[k] === 0) {
        var s = '';
        while (k < ops.length && ops[k] === 0) { s += a[ai++]; bi++; k++; }
        var hs = h(s); left += hs; right += hs;
      } else {
        var dl = '', ad = '';
        while (k < ops.length && ops[k] === -1) { dl += a[ai++]; k++; }
        while (k < ops.length && ops[k] === 1)  { ad += b[bi++]; k++; }
        if (dl) left  += '<span class="chg-left">'  + h(dl) + '</span>';
        if (ad) right += '<span class="chg-right">' + h(ad) + '</span>';
      }
    }
    return { left: left, right: right };
  }

  // ---- Body diff (LCS over lines) ----
  var BODY_CAP = 100 * 1024;
  var LINE_CAP = 4000;

  function extractRequestBody(req){
    if (!req) return '';
    var pd = req.postData;
    if (!pd) return '';
    var text = typeof pd.text === 'string' ? pd.text
             : (Array.isArray(pd.params) ? pd.params.map(function(p){ return p.name + '=' + (p.value || ''); }).join('&') : '');
    if (text && pd.encoding === 'base64') {
      try { return b64Decode(text.replace(/\s+/g,'')); } catch(_) {}
    }
    return text;
  }
  function extractResponseBody(res){
    if (!res) return '';
    var c = res.content;
    if (!c) return '';
    if (typeof c.text !== 'string') return '';
    if (c.encoding === 'base64') {
      try { return b64Decode(c.text.replace(/\s+/g,'')); } catch(_) {}
    }
    return c.text;
  }
  function maybeManualB64(text){
    if (!state.base64Decode) return { text: text, decoded: false, attempted: false };
    var r = tryBase64Decode(text);
    return { text: r.text, decoded: r.decoded, attempted: true };
  }
  function prettyIfJson(text){
    if (!text) return { text: '', isJson: false };
    var t = text.trim();
    if (!t || (t[0] !== '{' && t[0] !== '[')) return { text: text, isJson: false };
    try { var o = JSON.parse(t); return { text: JSON.stringify(o, null, 2), isJson: true }; }
    catch(_) { return { text: text, isJson: false }; }
  }
  function capBody(text){
    if (text.length <= BODY_CAP) return { text: text, capped: false };
    return { text: text.slice(0, BODY_CAP), capped: true };
  }
  // LCS line diff producing row-aligned rows
  function diffLinesRows(aText, bText){
    var A = aText.split('\n'), B = bText.split('\n');
    if (A.length && A[A.length-1] === '' && aText.endsWith('\n')) A.pop();
    if (B.length && B[B.length-1] === '' && bText.endsWith('\n')) B.pop();
    // Quick paths
    if (aText === bText) {
      return { rows: A.map(function(x){ return {left:x, right:x, status:'equal'}; }), lineCapped:false };
    }
    var lineCapped = false;
    if (A.length > LINE_CAP) { A = A.slice(0, LINE_CAP); lineCapped = true; }
    if (B.length > LINE_CAP) { B = B.slice(0, LINE_CAP); lineCapped = true; }
    var n = A.length, m = B.length;

    // LCS DP (Uint16 sufficient as line counts are capped at 4000 < 65535)
    var dp = new Array(n+1);
    for (var i = 0; i <= n; i++) dp[i] = new Uint16Array(m+1);
    for (var i = n-1; i >= 0; i--) {
      var dpi = dp[i], dpi1 = dp[i+1];
      for (var j = m-1; j >= 0; j--) {
        if (A[i] === B[j]) dpi[j] = 1 + dpi1[j+1];
        else { var a = dpi1[j], b = dpi[j+1]; dpi[j] = a > b ? a : b; }
      }
    }
    // Traceback -> ops
    var ops = [];
    var i = 0, j = 0;
    while (i < n && j < m) {
      if (A[i] === B[j]) { ops.push({ t: 'eq', a: A[i], b: B[j] }); i++; j++; }
      else if (dp[i+1][j] >= dp[i][j+1]) { ops.push({ t: 'del', a: A[i] }); i++; }
      else { ops.push({ t: 'add', b: B[j] }); j++; }
    }
    while (i < n) { ops.push({ t: 'del', a: A[i++] }); }
    while (j < m) { ops.push({ t: 'add', b: B[j++] }); }

    // Combine adjacent del+add runs into paired value_diff rows
    var rows = [];
    var k = 0;
    while (k < ops.length) {
      var o = ops[k];
      if (o.t === 'eq') { rows.push({ left: o.a, right: o.b, status: 'equal' }); k++; continue; }
      // collect del run then add run (either order allowed)
      var dels = [], adds = [];
      while (k < ops.length && ops[k].t === 'del') { dels.push(ops[k].a); k++; }
      while (k < ops.length && ops[k].t === 'add') { adds.push(ops[k].b); k++; }
      var pairs = Math.min(dels.length, adds.length);
      for (var p = 0; p < pairs; p++) rows.push({ left: dels[p], right: adds[p], status: 'value_diff' });
      for (var p = pairs; p < dels.length; p++) rows.push({ left: dels[p], right: null, status: 'only_left' });
      for (var p = pairs; p < adds.length; p++) rows.push({ left: null, right: adds[p], status: 'only_right' });
    }
    return { rows: rows, lineCapped: lineCapped };
  }

  // ---- State ----
  var TABS = [
    { id: 'reqline',         label: 'Request Line',           kind: 'req' },
    { id: 'reqheaders',      label: 'Request Headers',        kind: 'req' },
    { id: 'reqbody',         label: 'Request Body',           kind: 'req' },
    { id: 'reqbody_parsed',  label: 'Request Body (parsed)',  kind: 'req' },
    { id: 'resline',         label: 'Response Line',          kind: 'res' },
    { id: 'resheaders',      label: 'Response Headers',       kind: 'res' },
    { id: 'resbody',         label: 'Response Body',          kind: 'res' },
    { id: 'resbody_parsed',  label: 'Response Body (parsed)', kind: 'res' },
  ];
  var state = {
    left:  { name: '', entries: [], filter: '', selIdx: -1 },
    right: { name: '', entries: [], filter: '', selIdx: -1 },
    activeTab: 'reqheaders',
    base64Decode: false,
    autoSync: 'off',
    autoScroll: true,
    matchNth: true,
    search: { query: '', results: [], open: false, capped: false },
  };

  // ---- Renderers ----
  function renderTabs(){
    var tabsEl = document.querySelector('.tabs');
    function tabHtml(t){
      return '<div class="tab tab-'+t.kind+(state.activeTab===t.id?' active':'')+'" data-tab="'+t.id+'">'+h(t.label)+'</div>';
    }
    var reqTabs = TABS.filter(function(t){ return t.kind==='req'; }).map(tabHtml).join('');
    var resTabs = TABS.filter(function(t){ return t.kind==='res'; }).map(tabHtml).join('');
    tabsEl.innerHTML =
        '<div class="tab-row tab-row-req">'
      +   '<span class="tab-group-label tab-group-req">REQ</span>'
      +   reqTabs
      +   '<span class="spacer"></span>'
      +   '<button class="tab-btn" data-copy="left" title="Copy LEFT pane content (current tab) to clipboard">Copy L</button>'
      +   '<button class="tab-btn" data-copy="right" title="Copy RIGHT pane content (current tab) to clipboard">Copy R</button>'
      +   '<button class="tab-btn sep-left'+(state.base64Decode?' active':'')+'" id="b64-toggle" title="Try base64-decoding bodies before display">Decode base64</button>'
      + '</div>'
      + '<div class="tab-row tab-row-res">'
      +   '<span class="tab-group-label tab-group-res">RES</span>'
      +   resTabs
      + '</div>';
  }

  function filteredEntries(sideKey){
    var side = state[sideKey];
    var f = (side.filter || '').trim().toLowerCase();
    if (!f) return side.entries;
    return side.entries.filter(function(e){
      return e.url.toLowerCase().indexOf(f) !== -1
          || e.method.toLowerCase().indexOf(f) !== -1
          || String(e.status).indexOf(f) !== -1;
    });
  }

  function renderList(sideKey){
    var side = state[sideKey];
    var col = document.querySelector('.list-col[data-side="'+sideKey+'"]');
    var body = col.querySelector('.list-body');
    var rows = filteredEntries(sideKey);
    if (!rows.length) {
      body.innerHTML = '<div class="placeholder" style="padding:16px">' + (side.entries.length ? 'No matches for filter.' : 'No file loaded.') + '</div>';
      return;
    }
    body.innerHTML = rows.map(function(e){
      var sc = statusColor(e.status);
      return '<div class="entry'+(side.selIdx===e.idx?' selected':'')+'" data-idx="'+e.idx+'">'
        + '<span class="m" style="color:'+methodColor(e.method)+'">'+h(e.method)+'</span>'
        + '<span class="s"'+(sc?' style="color:'+sc+'"':'')+'>'+h(e.status||'')+'</span>'
        + '<span class="u" title="'+h(e.url)+'">'+h(truncUrl(e.url, 180))+'</span>'
        + '</div>';
    }).join('');
  }

  function renderDropInfo(sideKey){
    var side = state[sideKey];
    var el = document.querySelector('.drop[data-side="'+sideKey+'"] .info');
    if (side.name) {
      el.classList.remove('hint');
      el.classList.add('fname');
      el.textContent = side.name + ' — ' + side.entries.length + ' entries';
    } else {
      el.classList.add('hint');
      el.classList.remove('fname');
      el.textContent = 'drop a .har file here';
    }
  }

  function getSelectedEntry(sideKey){
    var s = state[sideKey];
    return s.selIdx >= 0 ? s.entries[s.selIdx] : null;
  }

  function renderReqLine(leftReq, rightReq){
    var fields = [
      { k: 'method', L: (leftReq&&leftReq.method)||'', R: (rightReq&&rightReq.method)||'' },
      { k: 'url',    L: (leftReq&&leftReq.url)||'',    R: (rightReq&&rightReq.url)||'' },
      { k: 'httpVersion', L: (leftReq&&leftReq.httpVersion)||'', R: (rightReq&&rightReq.httpVersion)||'' },
    ];
    function v(f, side){
      var val = f[side];
      var style = (f.k === 'method' && val) ? ' style="color:'+methodColor(val)+'"' : '';
      return '<span class="v"'+style+'>'+h(val)+'</span>';
    }
    return {
      left: '<div class="reqline">' + fields.map(function(f){ return '<div class="field'+(f.L!==f.R?' diff':'')+'"><span class="k">'+h(f.k)+'</span>'+v(f,'L')+'</div>'; }).join('') + '</div>',
      right:'<div class="reqline">' + fields.map(function(f){ return '<div class="field'+(f.L!==f.R?' diff':'')+'"><span class="k">'+h(f.k)+'</span>'+v(f,'R')+'</div>'; }).join('') + '</div>',
    };
  }
  function renderResLine(leftRes, rightRes){
    var fields = [
      { k: 'status',     L: (leftRes&&String(leftRes.status))||'', R: (rightRes&&String(rightRes.status))||'' },
      { k: 'statusText', L: (leftRes&&leftRes.statusText)||'', R: (rightRes&&rightRes.statusText)||'' },
      { k: 'httpVersion',L: (leftRes&&leftRes.httpVersion)||'', R: (rightRes&&rightRes.httpVersion)||'' },
    ];
    function v(f, side){
      var val = f[side];
      var style = '';
      if (f.k === 'status' && val) {
        var sc = statusColor(val);
        if (sc) style = ' style="color:'+sc+'"';
      }
      return '<span class="v"'+style+'>'+h(val)+'</span>';
    }
    return {
      left: '<div class="reqline">' + fields.map(function(f){ return '<div class="field'+(f.L!==f.R?' diff':'')+'"><span class="k">'+h(f.k)+'</span>'+v(f,'L')+'</div>'; }).join('') + '</div>',
      right:'<div class="reqline">' + fields.map(function(f){ return '<div class="field'+(f.L!==f.R?' diff':'')+'"><span class="k">'+h(f.k)+'</span>'+v(f,'R')+'</div>'; }).join('') + '</div>',
    };
  }

  function renderHeaderRows(L, R){
    var rows = alignHeaders(L||[], R||[]);
    if (!rows.length) return { left: '<div class="placeholder">No headers.</div>', right: '<div class="placeholder">No headers.</div>' };
    var lh = [], rh = [];
    var lineL = 0, lineR = 0;
    rows.forEach(function(r){
      if (r.left)  lineL++;
      if (r.right) lineR++;
      var tagL = (r.status !== 'equal' && r.left)  ? ' <span class="tag '+r.status+'">'+r.status.replace('_',' ')+'</span>' : '';
      var tagR = (r.status !== 'equal' && r.right) ? ' <span class="tag '+r.status+'">'+r.status.replace('_',' ')+'</span>' : '';
      var nameL = r.left ? h(r.left.name) : '';
      var nameR = r.right ? h(r.right.name) : '';
      var valL = r.left ? h(r.left.value) : '';
      var valR = r.right ? h(r.right.value) : '';
      if (r.left && r.right) {
        if (r.status === 'value_diff') {
          var cv = charDiffHTML(r.left.value, r.right.value);
          valL = cv.left; valR = cv.right;
        } else if (r.status === 'case_diff') {
          var cn = charDiffHTML(r.left.name, r.right.name);
          nameL = cn.left; nameR = cn.right;
          if (r.left.value !== r.right.value) {
            var cv2 = charDiffHTML(r.left.value, r.right.value);
            valL = cv2.left; valR = cv2.right;
          }
        }
      }
      lh.push('<div class="row '+r.status+'"><span class="ln">'+(r.left?lineL:'')+'</span><span class="cell">'
        + (r.left ? '<span class="n">'+nameL+'</span><span class="sep">: </span><span class="v">'+valL+'</span>'+tagL : '')
        + '</span></div>');
      rh.push('<div class="row '+r.status+'"><span class="ln">'+(r.right?lineR:'')+'</span><span class="cell">'
        + (r.right ? '<span class="n">'+nameR+'</span><span class="sep">: </span><span class="v">'+valR+'</span>'+tagR : '')
        + '</span></div>');
    });
    return { left: lh.join(''), right: rh.join('') };
  }

  function renderBody(leftText, rightText){
    var lb64 = maybeManualB64(leftText), rb64 = maybeManualB64(rightText);
    leftText = lb64.text; rightText = rb64.text;
    var lp = prettyIfJson(leftText), rp = prettyIfJson(rightText);
    var lc = capBody(lp.text), rc = capBody(rp.text);
    var result = diffLinesRows(lc.text, rc.text);
    var capped = lc.capped || rc.capped || result.lineCapped;
    var banner = capped ? '<div class="banner">Body truncated for diff performance ('+BODY_CAP/1024+' KB or '+LINE_CAP+' lines per side).</div>' : '';
    if (lb64.attempted || rb64.attempted) {
      var msg = 'Manual base64 decode: '
        + 'left ' + (lb64.attempted ? (lb64.decoded ? 'decoded' : 'not base64') : 'n/a')
        + ' · right ' + (rb64.attempted ? (rb64.decoded ? 'decoded' : 'not base64') : 'n/a');
      banner = '<div class="banner">' + h(msg) + '</div>' + banner;
    }
    if (!result.rows.length) {
      return { left: banner + '<div class="placeholder">Empty body.</div>', right: banner + '<div class="placeholder">Empty body.</div>' };
    }
    var lh = [banner], rh = [banner];
    var lineL = 0, lineR = 0;
    result.rows.forEach(function(r){
      if (r.left !== null) lineL++;
      if (r.right !== null) lineR++;
      var leftCell = r.left !== null ? h(r.left) : '';
      var rightCell = r.right !== null ? h(r.right) : '';
      if (r.status === 'value_diff' && r.left !== null && r.right !== null) {
        var cd = charDiffHTML(r.left, r.right);
        leftCell = cd.left; rightCell = cd.right;
      }
      lh.push('<div class="row '+r.status+'"><span class="ln">'+(r.left!==null?lineL:'')+'</span><span class="cell">'+leftCell+'</span></div>');
      rh.push('<div class="row '+r.status+'"><span class="ln">'+(r.right!==null?lineR:'')+'</span><span class="cell">'+rightCell+'</span></div>');
    });
    return { left: lh.join(''), right: rh.join('') };
  }

  function isImageType(ct){ return /^image\//.test(ct||''); }
  function imageInfo(rawSource, ctFromHeader){
    if (!rawSource || typeof rawSource.text !== 'string' || !rawSource.text) return null;
    var text = rawSource.text;
    var ct = ctFromHeader || ((rawSource.mimeType||'').split(';')[0].trim().toLowerCase()) || 'image/png';
    var b64;
    if (rawSource.encoding === 'base64') {
      b64 = text.replace(/\s+/g, '');
    } else {
      try {
        var s = '';
        for (var i = 0; i < text.length; i++) s += String.fromCharCode(text.charCodeAt(i) & 0xff);
        b64 = btoa(s);
      } catch(_) { return null; }
    }
    return { ct: ct, base64: b64 };
  }
  function renderImagePane(raw, ct){
    if (!isImageType(ct)) {
      if (!raw || !raw.text) return '<div class="placeholder">No body.</div>';
      return '<div class="placeholder">Not an image (content-type: '+h(ct||'(none)')+').</div>';
    }
    var info = imageInfo(raw, ct);
    if (!info) return '<div class="placeholder">No image data.</div>';
    var sizeKb = (info.base64.length * 3 / 4 / 1024).toFixed(1);
    return '<div class="image-preview"><img src="data:'+h(info.ct)+';base64,'+info.base64+'" alt="preview" onerror="this.style.display=\'none\';this.nextElementSibling.classList.add(\'err\');this.nextElementSibling.textContent=\'Failed to decode image.\'"/>'
      + '<div class="meta">'+h(info.ct)+' &middot; ~'+sizeKb+' KB</div></div>';
  }

  function renderParsedBody(lReq, rReq, lRes, rRes, kind){
    var lText, rText, lCT, rCT, lRaw, rRaw;
    if (kind === 'request') {
      lText = extractRequestBody(lReq||{}); rText = extractRequestBody(rReq||{});
      lCT = getContentType(lReq && lReq.headers); rCT = getContentType(rReq && rReq.headers);
      lRaw = lReq && lReq.postData; rRaw = rReq && rReq.postData;
    } else {
      lText = extractResponseBody(lRes||{}); rText = extractResponseBody(rRes||{});
      lCT = getContentType(lRes && lRes.headers); rCT = getContentType(rRes && rRes.headers);
      lRaw = lRes && lRes.content; rRaw = rRes && rRes.content;
    }
    if (isImageType(lCT) || isImageType(rCT)) {
      return { left: renderImagePane(lRaw, lCT), right: renderImagePane(rRaw, rCT) };
    }
    var lb64 = maybeManualB64(lText), rb64 = maybeManualB64(rText);
    lText = lb64.text; rText = rb64.text;
    var lp = parseBody(lText, lCT), rp = parseBody(rText, rCT);
    var manualBanner = '';
    if (lb64.attempted || rb64.attempted) {
      var msg = 'Manual base64 decode: '
        + 'left ' + (lb64.attempted ? (lb64.decoded ? 'decoded' : 'not base64') : 'n/a')
        + ' · right ' + (rb64.attempted ? (rb64.decoded ? 'decoded' : 'not base64') : 'n/a');
      manualBanner = '<div class="banner">' + h(msg) + '</div>';
    }
    if ((!lp.pairs || !lp.pairs.length) && (!rp.pairs || !rp.pairs.length)) {
      var hint = manualBanner + '<div class="placeholder">Body is not JSON or x-www-form-urlencoded.<br/>Use the raw body tab instead.</div>';
      return { left: hint, right: hint };
    }
    var kindBanner = '';
    var lk = lp.kind || 'empty', rk = rp.kind || 'empty';
    if (lk !== 'none' || rk !== 'none') {
      kindBanner = '<div class="banner">Parsed as: left=' + h(lk) + ' · right=' + h(rk) + '</div>';
    }
    var hdr = renderHeaderRows(lp.pairs || [], rp.pairs || []);
    return { left: manualBanner + kindBanner + hdr.left, right: manualBanner + kindBanner + hdr.right };
  }

  function highlightInPane(paneEl, query){
    if (!query) return;
    var rx;
    try { rx = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'); }
    catch(_) { return; }
    var walker = document.createTreeWalker(paneEl, NodeFilter.SHOW_TEXT, null);
    var nodes = [];
    while (walker.nextNode()) {
      var n = walker.currentNode;
      var parent = n.parentNode;
      if (!parent || parent.nodeName === 'MARK' || parent.nodeName === 'SCRIPT' || parent.nodeName === 'STYLE') continue;
      rx.lastIndex = 0;
      if (rx.test(n.nodeValue)) nodes.push(n);
    }
    nodes.forEach(function(n){
      var s = n.nodeValue, frag = document.createDocumentFragment(), lastIdx = 0;
      rx.lastIndex = 0;
      var match;
      while ((match = rx.exec(s)) !== null) {
        var idx = match.index;
        if (idx > lastIdx) frag.appendChild(document.createTextNode(s.slice(lastIdx, idx)));
        var mk = document.createElement('mark');
        mk.className = 'search-hit';
        mk.textContent = match[0];
        frag.appendChild(mk);
        lastIdx = idx + match[0].length;
        if (match[0].length === 0) rx.lastIndex++;
      }
      if (lastIdx < s.length) frag.appendChild(document.createTextNode(s.slice(lastIdx)));
      n.parentNode.replaceChild(frag, n);
    });
  }

  function renderDiff(){
    var lEntry = getSelectedEntry('left'), rEntry = getSelectedEntry('right');
    var lPane = document.querySelector('.pane[data-pane="left"] .pane-body');
    var rPane = document.querySelector('.pane[data-pane="right"] .pane-body');
    var lHead = document.querySelector('.pane[data-pane="left"] .pane-head');
    var rHead = document.querySelector('.pane[data-pane="right"] .pane-head');
    lHead.textContent = 'LEFT' + (lEntry ? ' — ' + lEntry.method + ' ' + truncUrl(lEntry.url, 80) : '');
    rHead.textContent = 'RIGHT' + (rEntry ? ' — ' + rEntry.method + ' ' + truncUrl(rEntry.url, 80) : '');
    if (!lEntry && !rEntry) {
      lPane.innerHTML = '<div class="placeholder">Load HAR files on both sides, then click Auto-match or pick entries from the lists above.</div>';
      rPane.innerHTML = '<div class="placeholder">&nbsp;</div>';
      return;
    }
    var lReq = lEntry ? lEntry.raw.request : null;
    var rReq = rEntry ? rEntry.raw.request : null;
    var lRes = lEntry ? lEntry.raw.response : null;
    var rRes = rEntry ? rEntry.raw.response : null;
    var out;
    switch (state.activeTab) {
      case 'reqline':        out = renderReqLine(lReq, rReq); break;
      case 'resline':        out = renderResLine(lRes, rRes); break;
      case 'reqheaders':     out = renderHeaderRows(lReq && lReq.headers, rReq && rReq.headers); break;
      case 'resheaders':     out = renderHeaderRows(lRes && lRes.headers, rRes && rRes.headers); break;
      case 'reqbody':        out = renderBody(extractRequestBody(lReq||{}), extractRequestBody(rReq||{})); break;
      case 'resbody':        out = renderBody(extractResponseBody(lRes||{}), extractResponseBody(rRes||{})); break;
      case 'reqbody_parsed': out = renderParsedBody(lReq, rReq, lRes, rRes, 'request'); break;
      case 'resbody_parsed': out = renderParsedBody(lReq, rReq, lRes, rRes, 'response'); break;
    }
    lPane.innerHTML = out.left;
    rPane.innerHTML = out.right;
    if (state.search.query) {
      highlightInPane(lPane, state.search.query);
      highlightInPane(rPane, state.search.query);
    }
  }

  function renderAll(){
    renderTabs();
    renderDropInfo('left');
    renderDropInfo('right');
    renderList('left');
    renderList('right');
    renderDiff();
  }

  function getPaneCopyText(side){
    var pane = document.querySelector('.pane[data-pane="'+side+'"] .pane-body');
    if (!pane) return '';
    var img = pane.querySelector('.image-preview img');
    if (img && img.getAttribute('src')) return img.getAttribute('src');
    var rows = pane.querySelectorAll('.row');
    if (rows.length) {
      var lines = [];
      for (var i = 0; i < rows.length; i++) {
        if (rows[i].classList.contains('pad')) continue;
        var cell = rows[i].querySelector('.cell');
        lines.push(cell ? cell.textContent : '');
      }
      return lines.join('\n');
    }
    var fields = pane.querySelectorAll('.reqline .field');
    if (fields.length) {
      var lines2 = [];
      for (var k = 0; k < fields.length; k++) {
        var fk = fields[k].querySelector('.k');
        var fv = fields[k].querySelector('.v');
        lines2.push((fk ? fk.textContent : '') + ': ' + (fv ? fv.textContent : ''));
      }
      return lines2.join('\n');
    }
    return (pane.textContent || '').trim();
  }
  function flashBtn(btn, msg, cls, ms){
    if (!btn) return;
    var orig = btn.getAttribute('data-orig') || btn.textContent;
    btn.setAttribute('data-orig', orig);
    btn.textContent = msg;
    btn.classList.add(cls);
    btn.disabled = true;
    setTimeout(function(){
      if (!btn.isConnected) return;
      btn.textContent = orig;
      btn.classList.remove(cls);
      btn.disabled = false;
      btn.removeAttribute('data-orig');
    }, ms);
  }
  function copyPaneToClipboard(side, btn){
    var text = getPaneCopyText(side);
    if (!text) { flashBtn(btn, 'Empty', 'failed', 1200); return; }
    function fallback(){
      try {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed'; ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        var ok = document.execCommand && document.execCommand('copy');
        document.body.removeChild(ta);
        flashBtn(btn, ok ? 'Copied!' : 'Failed', ok ? 'copied' : 'failed', 1200);
      } catch(_) { flashBtn(btn, 'Failed', 'failed', 1500); }
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(
        function(){ flashBtn(btn, 'Copied!', 'copied', 1200); },
        function(){ fallback(); }
      );
    } else {
      fallback();
    }
  }

  // ---- Actions ----
  async function loadFile(sideKey, file){
    if (!file) return;
    try {
      var text = await file.text();
      var entries = parseHar(text);
      state[sideKey].name = file.name;
      state[sideKey].entries = entries;
      state[sideKey].selIdx = entries.length > 0 ? 0 : -1;
      state[sideKey].filter = '';
      var filterInput = document.querySelector('.list-col[data-side="'+sideKey+'"] .filter');
      if (filterInput) filterInput.value = '';
      renderAll();
    } catch (e) {
      showErr('Failed to parse ' + file.name + ': ' + e.message);
    }
  }

  var SEARCH_CAP = 500;
  var SNIPPET_RADIUS = 40;
  function makeSnippet(text, idx, qlen){
    var start = Math.max(0, idx - SNIPPET_RADIUS);
    var end = Math.min(text.length, idx + qlen + SNIPPET_RADIUS);
    var pre = (start > 0 ? '…' : '') + text.slice(start, idx);
    var hit = text.slice(idx, idx + qlen);
    var post = text.slice(idx + qlen, end) + (end < text.length ? '…' : '');
    return h(pre) + '<mark class="search-hit">' + h(hit) + '</mark>' + h(post);
  }
  function searchField(text, q){
    if (!text) return -1;
    return String(text).toLowerCase().indexOf(q);
  }
  function runSearch(){
    var q = (state.search.query || '').toLowerCase();
    state.search.results = [];
    state.search.capped = false;
    if (!q) { renderSearchResults(); return; }
    var sides = ['left','right'];
    outer: for (var si = 0; si < sides.length; si++) {
      var side = sides[si];
      var entries = state[side].entries;
      for (var i = 0; i < entries.length; i++) {
        var e = entries[i];
        var req = e.raw && e.raw.request, res = e.raw && e.raw.response;
        // URL / method / status
        var combined = (e.method||'') + ' ' + (e.url||'') + ' ' + (e.status||'');
        var idx = searchField(combined, q);
        if (idx !== -1) state.search.results.push({ side: side, entryIdx: e.idx, fieldKind: 'url', snippet: makeSnippet(combined, idx, q.length) });
        // Request headers
        if (req && Array.isArray(req.headers)) {
          for (var hi = 0; hi < req.headers.length; hi++) {
            var line = (req.headers[hi].name||'') + ': ' + (req.headers[hi].value||'');
            var ix = searchField(line, q);
            if (ix !== -1) { state.search.results.push({ side: side, entryIdx: e.idx, fieldKind: 'reqheader', snippet: makeSnippet(line, ix, q.length) }); break; }
          }
        }
        // Request body
        var rb = extractRequestBody(req);
        if (rb) {
          var ix2 = searchField(rb, q);
          if (ix2 !== -1) state.search.results.push({ side: side, entryIdx: e.idx, fieldKind: 'reqbody', snippet: makeSnippet(rb, ix2, q.length) });
        }
        // Response headers
        if (res && Array.isArray(res.headers)) {
          for (var hj = 0; hj < res.headers.length; hj++) {
            var rline = (res.headers[hj].name||'') + ': ' + (res.headers[hj].value||'');
            var ix3 = searchField(rline, q);
            if (ix3 !== -1) { state.search.results.push({ side: side, entryIdx: e.idx, fieldKind: 'resheader', snippet: makeSnippet(rline, ix3, q.length) }); break; }
          }
        }
        // Response body
        var rsb = extractResponseBody(res);
        if (rsb) {
          var ix4 = searchField(rsb, q);
          if (ix4 !== -1) state.search.results.push({ side: side, entryIdx: e.idx, fieldKind: 'resbody', snippet: makeSnippet(rsb, ix4, q.length) });
        }
        if (state.search.results.length >= SEARCH_CAP) { state.search.capped = true; break outer; }
      }
    }
    renderSearchResults();
  }
  function renderSearchResults(){
    var resultsEl = document.getElementById('search-results');
    var countEl = document.getElementById('search-count');
    var r = state.search.results;
    if (!state.search.query) { resultsEl.innerHTML = ''; countEl.textContent = ''; return; }
    countEl.textContent = r.length + (state.search.capped ? ' (capped)' : '') + ' hits';
    if (!r.length) { resultsEl.innerHTML = '<div class="placeholder" style="padding:16px">No matches.</div>'; return; }
    var labelMap = { url:'url', reqheader:'req header', reqbody:'req body', resheader:'res header', resbody:'res body' };
    resultsEl.innerHTML = r.map(function(hit){
      var entry = state[hit.side].entries[hit.entryIdx];
      if (!entry) return '';
      var sc = statusColor(entry.status);
      return '<div class="sresult" data-side="'+hit.side+'" data-idx="'+hit.entryIdx+'" data-kind="'+hit.fieldKind+'">'
        + '<span class="sb '+(hit.side==='left'?'L':'R')+'">'+(hit.side==='left'?'L':'R')+'</span>'
        + '<span class="m" style="color:'+methodColor(entry.method)+'">'+h(entry.method)+'</span>'
        + '<span class="s"'+(sc?' style="color:'+sc+'"':'')+'>'+h(entry.status||'')+'</span>'
        + '<div class="meta">'
        +   '<div class="url" title="'+h(entry.url)+'">'+h(truncUrl(entry.url, 200))+'</div>'
        +   '<div class="snip"><span class="kind">'+h(labelMap[hit.fieldKind]||hit.fieldKind)+':</span>'+hit.snippet+'</div>'
        + '</div>'
        + '</div>';
    }).join('');
  }

  function autoMatch(){
    if (!state.left.entries.length || !state.right.entries.length) return;
    var rightMap = {};
    state.right.entries.forEach(function(e){
      var k = urlMatchKey(e.method, e.url);
      (rightMap[k] = rightMap[k] || []).push(e.idx);
    });
    for (var i = 0; i < state.left.entries.length; i++) {
      var le = state.left.entries[i];
      var arr = rightMap[urlMatchKey(le.method, le.url)];
      if (arr && arr.length) {
        state.left.selIdx = le.idx;
        state.right.selIdx = arr.shift();
        renderList('left'); renderList('right'); renderDiff();
        return;
      }
    }
    showErr('Auto-match found no matching (method + path) pair.');
  }

  // ---- Panel layout state + persistence ----
  var LS_KEY = 'harcompare.layout.v1';
  var layout = {
    listsH: null,
    asideW: 320,
    asideOpen: false,
    collapsed: { lists: false, diff: false, search: false },
  };
  try {
    var saved = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
    if (saved && typeof saved === 'object') {
      if (typeof saved.listsH === 'number') layout.listsH = saved.listsH;
      if (typeof saved.asideW === 'number') layout.asideW = saved.asideW;
      if (saved.collapsed) {
        layout.collapsed.lists  = !!saved.collapsed.lists;
        layout.collapsed.diff   = !!saved.collapsed.diff;
        layout.collapsed.search = !!saved.collapsed.search;
      }
    }
  } catch(_) {}
  function saveLayout(){
    try { localStorage.setItem(LS_KEY, JSON.stringify(layout)); } catch(_) {}
  }
  // Clamp preferred pixel sizes to what currently fits — keeps the diff/main
  // pane from being pushed offscreen when the window shrinks. Returns the
  // applicable value without mutating the saved preference, so re-enlarging
  // the window restores the user's chosen size.
  function clampListsH(rawH){
    var main = document.getElementById('workspace-main');
    if (!main) return rawH;
    var workspaceH = main.getBoundingClientRect().height;
    if (workspaceH <= 0) return rawH;
    return Math.max(80, Math.min(workspaceH - 120, rawH));
  }
  function clampAsideW(rawW){
    var ws = document.getElementById('workspace');
    if (!ws) return rawW;
    var workspaceW = ws.getBoundingClientRect().width;
    if (workspaceW <= 0) return rawW;
    return Math.max(180, Math.min(workspaceW - 200, rawW));
  }
  function applyLayout(){
    var ws = document.getElementById('workspace');
    var main = document.getElementById('workspace-main');
    if (!ws || !main) return;
    ws.classList.toggle('aside-open', layout.asideOpen);
    ws.style.setProperty('--aside-w', clampAsideW(layout.asideW) + 'px');
    if (layout.listsH != null) main.style.setProperty('--lists-h', clampListsH(layout.listsH) + 'px');
    main.classList.toggle('lists-collapsed', layout.collapsed.lists);
    main.classList.toggle('diff-collapsed', layout.collapsed.diff);
    var pl = document.getElementById('panel-lists');
    var pd = document.getElementById('panel-diff');
    var ps = document.getElementById('panel-search');
    if (pl) pl.classList.toggle('collapsed', layout.collapsed.lists);
    if (pd) pd.classList.toggle('collapsed', layout.collapsed.diff);
    if (ps) ps.classList.toggle('collapsed', layout.collapsed.search);
  }

  // ---- Splitter drag ----
  function initSplitter(el, axis, onDelta){
    el.addEventListener('mousedown', function(ev){
      if (ev.button !== 0) return;
      ev.preventDefault();
      var start = axis === 'row' ? ev.clientY : ev.clientX;
      el.classList.add('dragging');
      document.body.classList.add('splitting', 'axis-' + axis);
      function move(e){ onDelta((axis === 'row' ? e.clientY : e.clientX) - start); }
      function up(){
        el.classList.remove('dragging');
        document.body.classList.remove('splitting','axis-row','axis-col');
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', up);
        saveLayout();
      }
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
    });
  }

  // ---- Wire up ----
  function wire(){
    // File pick & drop
    ['left','right'].forEach(function(sideKey){
      var dropEl = document.querySelector('.drop[data-side="'+sideKey+'"]');
      var btn = dropEl.querySelector('button[data-action="pick"]');
      var input = dropEl.querySelector('input[type="file"]');
      btn.addEventListener('click', function(){ input.click(); });
      input.addEventListener('change', function(ev){ var f = ev.target.files && ev.target.files[0]; if (f) loadFile(sideKey, f); });
      dropEl.addEventListener('dragover', function(ev){ ev.preventDefault(); dropEl.classList.add('active'); });
      dropEl.addEventListener('dragleave', function(){ dropEl.classList.remove('active'); });
      dropEl.addEventListener('drop', function(ev){ ev.preventDefault(); dropEl.classList.remove('active'); var f = ev.dataTransfer.files && ev.dataTransfer.files[0]; if (f) loadFile(sideKey, f); });

      // Filter input
      var col = document.querySelector('.list-col[data-side="'+sideKey+'"]');
      col.querySelector('.filter').addEventListener('input', function(ev){ state[sideKey].filter = ev.target.value; renderList(sideKey); });
      col.querySelector('button[data-action="automatch"]').addEventListener('click', autoMatch);

      // Entry click (delegated)
      col.querySelector('.list-body').addEventListener('click', function(ev){
        var row = ev.target.closest && ev.target.closest('.entry');
        if (!row) return;
        var idx = parseInt(row.getAttribute('data-idx'), 10);
        if (isNaN(idx)) return;
        selectEntry(sideKey, idx);
        renderDiff();
      });
    });

    // Tabs (incl. base64 toggle and copy buttons)
    document.querySelector('.tabs').addEventListener('click', function(ev){
      if (ev.target && ev.target.id === 'b64-toggle') {
        state.base64Decode = !state.base64Decode;
        renderTabs(); renderDiff();
        return;
      }
      var copyBtn = ev.target.closest && ev.target.closest('button[data-copy]');
      if (copyBtn) {
        copyPaneToClipboard(copyBtn.getAttribute('data-copy'), copyBtn);
        return;
      }
      var tab = ev.target.closest && ev.target.closest('.tab');
      if (!tab) return;
      state.activeTab = tab.getAttribute('data-tab');
      renderTabs(); renderDiff();
    });

    // Auto-sync segmented control
    document.getElementById('sync-seg').addEventListener('click', function(ev){
      var btn = ev.target.closest && ev.target.closest('button[data-sync]');
      if (!btn) return;
      state.autoSync = btn.getAttribute('data-sync');
      var btns = this.querySelectorAll('button');
      for (var i = 0; i < btns.length; i++) btns[i].classList.toggle('active', btns[i].getAttribute('data-sync') === state.autoSync);
    });

    // Auto-scroll checkbox
    document.getElementById('autoscroll-cb').addEventListener('change', function(ev){
      state.autoScroll = !!ev.target.checked;
    });

    // Match-Nth-duplicate checkbox
    document.getElementById('matchnth-cb').addEventListener('change', function(ev){
      state.matchNth = !!ev.target.checked;
    });

    // Search panel open/close
    var searchEl = document.getElementById('searchbar');
    var inputEl = document.getElementById('search-input');
    var resultsEl = document.getElementById('search-results');
    var countEl = document.getElementById('search-count');
    function openSearch(){
      state.search.open = true;
      layout.asideOpen = true;
      if (layout.collapsed.search) { layout.collapsed.search = false; }
      applyLayout();
      saveLayout();
      setTimeout(function(){ inputEl.focus(); inputEl.select(); }, 0);
    }
    function closeSearch(){
      state.search.open = false;
      state.search.query = '';
      state.search.results = [];
      layout.asideOpen = false;
      applyLayout();
      saveLayout();
      inputEl.value = '';
      countEl.textContent = '';
      resultsEl.innerHTML = '';
      renderDiff();
    }
    document.getElementById('open-search').addEventListener('click', openSearch);
    document.getElementById('search-close').addEventListener('click', closeSearch);
    document.addEventListener('keydown', function(ev){
      if ((ev.ctrlKey || ev.metaKey) && ev.key === 'f') {
        if (!state.search.open) { ev.preventDefault(); openSearch(); }
        return;
      }
      if (ev.key === 'Escape' && state.search.open) { ev.preventDefault(); closeSearch(); }
    });
    var searchTimer = null;
    inputEl.addEventListener('input', function(ev){
      var q = ev.target.value || '';
      if (searchTimer) clearTimeout(searchTimer);
      searchTimer = setTimeout(function(){
        state.search.query = q;
        runSearch();
        renderDiff();
      }, 200);
    });
    resultsEl.addEventListener('click', function(ev){
      var row = ev.target.closest && ev.target.closest('.sresult');
      if (!row) return;
      var side = row.getAttribute('data-side');
      var idx = parseInt(row.getAttribute('data-idx'), 10);
      var fk = row.getAttribute('data-kind');
      if (isNaN(idx)) return;
      selectEntry(side, idx);
      var tabMap = { url:'reqline', reqheader:'reqheaders', reqbody:'reqbody', resheader:'resheaders', resbody:'resbody' };
      if (tabMap[fk]) state.activeTab = tabMap[fk];
      renderTabs(); renderDiff();
    });

    // Scroll sync between diff panes (both vertical and horizontal)
    var lPane = document.querySelector('.pane[data-pane="left"]');
    var rPane = document.querySelector('.pane[data-pane="right"]');
    var syncing = false;
    function mirror(src, dst){
      if (syncing) return;
      syncing = true;
      dst.scrollTop = src.scrollTop;
      dst.scrollLeft = src.scrollLeft;
      requestAnimationFrame(function(){ syncing = false; });
    }
    lPane.addEventListener('scroll', function(){ mirror(lPane, rPane); }, { passive: true });
    rPane.addEventListener('scroll', function(){ mirror(rPane, lPane); }, { passive: true });

    // ---- Panel collapse via title bar clicks ----
    document.querySelectorAll('.panel-head[data-toggle]').forEach(function(head){
      head.addEventListener('click', function(ev){
        if (ev.target.closest && ev.target.closest('.panel-close')) return;
        var key = head.getAttribute('data-toggle');
        layout.collapsed[key] = !layout.collapsed[key];
        applyLayout();
        saveLayout();
      });
    });

    // ---- Lists/Diff horizontal splitter ----
    var splitH = document.getElementById('splitter-lists-diff');
    var listsStartH = null;
    splitH.addEventListener('mousedown', function(){
      listsStartH = document.getElementById('panel-lists').getBoundingClientRect().height;
    }, true);
    initSplitter(splitH, 'row', function(delta){
      if (layout.collapsed.lists || layout.collapsed.diff) return;
      if (listsStartH == null) return;
      var workspaceH = document.getElementById('workspace-main').getBoundingClientRect().height;
      var newH = Math.max(80, Math.min(workspaceH - 120, listsStartH + delta));
      layout.listsH = newH;
      document.getElementById('workspace-main').style.setProperty('--lists-h', newH + 'px');
    });

    // ---- Aside vertical splitter ----
    var splitV = document.getElementById('splitter-aside');
    var asideStartW = null;
    splitV.addEventListener('mousedown', function(){
      asideStartW = layout.asideW;
    }, true);
    initSplitter(splitV, 'col', function(delta){
      if (asideStartW == null) return;
      var workspaceW = document.getElementById('workspace').getBoundingClientRect().width;
      var newW = Math.max(180, Math.min(workspaceW - 200, asideStartW - delta));
      layout.asideW = newW;
      document.getElementById('workspace').style.setProperty('--aside-w', newW + 'px');
    });

    // Re-clamp panel sizes when the viewport shrinks so panes can't be pushed offscreen.
    var resizeRaf = 0;
    window.addEventListener('resize', function(){
      if (resizeRaf) return;
      resizeRaf = requestAnimationFrame(function(){ resizeRaf = 0; applyLayout(); });
    });

    applyLayout();
  }

  try {
    wire();
    renderAll();
  } catch (e) {
    showErr('Init error: ' + e.message + '\n' + e.stack);
  }
})();
