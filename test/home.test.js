const path = require('path');
const os = require('os');
const fs = require('fs');
const vm = require('vm');

const LOGGED_IN_FLAG = process.argv[2] === 'logged-in' ? 'true' : 'false';
const w = fs.readFileSync(path.join(__dirname, '..', 'dist', 'worker.js'), 'utf8');
const seg = w.slice(w.indexOf('async function UsagePanel主页('));
const i = seg.indexOf('const html = `');
const j = seg.indexOf('`;\n    return new Response');
let html = seg.slice(i + 14, j);
html = html.replace(/\\([\\`$])/g, (m, c) => c);
html = html.replace('${已登录 ? "true" : "false"}', LOGGED_IN_FLAG);
fs.writeFileSync(path.join(os.tmpdir(), 'home.rendered.html'), html);

const code = html.match(/<script>([\s\S]*?)<\/script>/)[1];

// ---------- DOM stub ----------
const elements = {};
function classList(){
  const s = new Set();
  return {
    add: c => s.add(c), remove: c => s.delete(c), contains: c => s.has(c),
    toggle: (c, v) => { const on = v === undefined ? !s.has(c) : !!v; on ? s.add(c) : s.delete(c); return on; },
    _s: s
  };
}
function makeEl(id){
  return { id, innerHTML:'', textContent:'', value:'', className:'', style:{}, classList: classList(),
           addEventListener(){}, focus(){}, appendChild(){}, remove(){}, querySelector(){ return null; },
           querySelectorAll(){ return []; } };
}
const documentStub = {
  documentElement: { classList: classList(), _a:{}, setAttribute(k,v){ this._a[k]=v; }, getAttribute(k){ return this._a[k] ?? null; } },
  body: { appendChild(){} },
  hidden: false,
  getElementById(id){ return elements[id] || (elements[id] = makeEl(id)); },
  createElement(tag){ return makeEl('el:' + tag); },
  addEventListener(){},
  querySelector(){ return null; },
  querySelectorAll(){ return []; }
};
const now = Date.now();
// 按北京业务日窗口（08:00 → 次日 08:00）生成，与前端 trendWindow() 保持一致
const BJ = 8 * 3600000;
const _bd = new Date(now + BJ);
let winStart = Date.UTC(_bd.getUTCFullYear(), _bd.getUTCMonth(), _bd.getUTCDate(), 8) - BJ;
if (_bd.getUTCHours() < 8) winStart -= 86400000;
const TREND = [];
const maxIdx = Math.max(4, Math.min(Math.floor((now - winStart) / 3600000), 23));
for (let i = 0; i <= maxIdx; i++) TREND.push({ t: winStart + i * 3600000, v: Math.round(200 + 900 * Math.abs(Math.sin(i / 3))) });
const payload = {
  success: true, msg: '✅ 成功更新免费额度使用数据（本次刷新 2 个账号）', UpdateTime: now - 90000,
  totals: { workers: 12345, pages: 11111, total: 23456, max: 200000, trend: TREND,
    resources: { d1:{rowsRead:120000,rowsReadLimit:5000000,rowsWritten:800,rowsWrittenLimit:100000,storageBytes:18874368,storageLimitBytes:5368709120},
                 kv:{reads:10200,readsLimit:100000,writes:12,writesLimit:1000,deletes:0,deletesLimit:1000,lists:2,listsLimit:1000,storageBytes:3145728,storageLimitBytes:1073741824},
                 r2:{classA:1600,classALimit:1000000,classB:52000,classBLimit:10000000,storageBytes:167772160,storageLimitBytes:10737418240} } },
  accounts: [
    { id:0, name:'主账号', accountId:'6d7***************************90', updateTime: now - 120000, ok:true, msg:'',
      workers:12345, pages:11111, total:23456, max:100000, trend: TREND.slice(10),
      resources:{ d1:{rowsRead:120000,rowsReadLimit:5000000,rowsWritten:800,rowsWrittenLimit:100000,storageBytes:18874368,storageLimitBytes:5368709120},
                  kv:{reads:10200,readsLimit:100000,writes:12,writesLimit:1000,deletes:0,deletesLimit:1000,lists:2,listsLimit:1000,storageBytes:3145728,storageLimitBytes:1073741824},
                  r2:{classA:1600,classALimit:1000000,classB:52000,classBLimit:10000000,storageBytes:167772160,storageLimitBytes:10737418240} } },
    { id:1, name:'备用账号 <script>x</script>', accountId:'me@example.com', updateTime: now - 7200000, ok:false, msg:'Token 权限不足 <b>',
      workers:0, pages:0, total:0, max:100000, resources:{}, trend: [] }
  ]
};
const sandbox = {
  console, Date, Math, Number, String, Array, Object, JSON, RegExp, isNaN, parseInt, parseFloat,
  document: documentStub,
  localStorage: { _d:{}, getItem(k){ return this._d[k] ?? null; }, setItem(k,v){ this._d[k]=v; } },
  window: { matchMedia: () => ({ matches: false }) },
  requestAnimationFrame: fn => fn(),
  setTimeout: () => 0,
  setInterval: () => 0,
  location: { href: '' },
  fetch: async () => ({ json: async () => payload }),
  encodeURIComponent, decodeURIComponent
};
sandbox.globalThis = sandbox;

(async () => {
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: 'home-script.js' });
  await new Promise(r => setTimeout(r, 60));
  const overview = elements['overview'] ? elements['overview'].innerHTML : '';
  const accList = elements['accList'] ? elements['accList'].innerHTML : '';
  const meta = elements['accMeta'] ? elements['accMeta'].textContent : '';
  fs.writeFileSync(path.join(os.tmpdir(), 'render-overview.html'), overview);
  fs.writeFileSync(path.join(os.tmpdir(), 'render-accounts.html'), accList);
  console.log('overview len', overview.length, '| accounts len', accList.length, '| meta:', meta);
  console.log('statusText:', elements['statusText'] && elements['statusText'].textContent);
  const cnt = s => (accList.match(new RegExp(s, 'g')) || []).length;
  console.log('acc cards:', cnt('data-id="'), '| progress:', cnt('class="progress'), '| badge ok:', cnt('badge-success'), '| badge err:', cnt('badge-error'));
  vm.runInContext('LOGGED_IN = true; state.anon = false; renderAccounts(state.data, false);', sandbox);
  const realList = (elements['accList'] || {}).innerHTML || '';
  console.log('escaped xss (真实名模式):', realList.includes('&lt;script&gt;x&lt;/script&gt;'));
  console.log('访客默认匿名:', accList.includes('账户 A'), '| 访客看得到真名:', accList.includes('@example.com'));
  const tHtml = (elements['trendBox'] || {}).innerHTML || '';
  const rHtml = (elements['rankBox'] || {}).innerHTML || '';
  console.log('trend svg:', /<svg class="chart"/.test(tHtml), '| path count:', (tHtml.match(/<path/g) || []).length,
              '| grid lines:', (tHtml.match(/grid-line/g) || []).length, '| x labels:', (tHtml.match(/:00</g) || []).length);
  console.log('rank rows:', (rHtml.match(/rank-row/g) || []).length, '| first:', rHtml.slice(0, 120).replace(/\n/g, ' '));
  const tabsHtml = (elements['trendTabs'] || {}).innerHTML || '';
  console.log('trend tabs:', (tabsHtml.match(/>[^<>]+<\/button>/g) || []).map(s => s.slice(1, -9)).join(' | '));

  // 匿名模式
  vm.runInContext('toggleAnon()', sandbox);
  const anonList = (elements['accList'] || {}).innerHTML || '';
  const anonTabs = (elements['trendTabs'] || {}).innerHTML || '';
  const anonRank = (elements['rankBox'] || {}).innerHTML || '';
  console.log('anon -> cards:', anonList.includes('账户 A'), '| tabs:', anonTabs.includes('账户 A'),
              '| rank:', anonRank.includes('账户 A'), '| leaks email:', anonList.includes('@example.com'));
  vm.runInContext('toggleAnon()', sandbox);

  // 单账号趋势
  vm.runInContext('pickTrend(0)', sandbox);
  const t2 = (elements['trendBox'] || {}).innerHTML || '';
  console.log('pick acc0 -> svg:', /<svg class="chart"/.test(t2), '| paths:', (t2.match(/<path/g) || []).length,
              '| sub:', (elements['trendSub'] || {}).textContent);
  console.log('div open/close in accounts:', (accList.match(/<div/g)||[]).length, (accList.match(/<\/div>/g)||[]).length);
  console.log('div open/close in overview:', (overview.match(/<div/g)||[]).length, (overview.match(/<\/div>/g)||[]).length);
  console.log('--- overview snippet ---');
  console.log(overview.slice(0, 500));
})().catch(e => { console.error('FAIL', e); process.exit(1); });
