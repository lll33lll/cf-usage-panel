const path = require('path');
const os = require('os');
const fs = require('fs');
const vm = require('vm');

const w = fs.readFileSync(path.join(__dirname, '..', 'dist', 'worker.js'), 'utf8');
const aStart = w.indexOf('async function UsagePanel管理面板(');
const hStart = w.indexOf('async function UsagePanel主页(');
const seg = w.slice(aStart, hStart);
const i = seg.indexOf('const html = `');
const j = seg.indexOf('`;\n    return new Response');
let html = seg.slice(i + 14, j);
html = html.replace(/\\([\\`$])/g, (m, c) => c);
fs.writeFileSync(path.join(os.tmpdir(), 'admin.rendered.html'), html);
const code = html.match(/<script>([\s\S]*?)<\/script>/)[1];

const elements = {};
function classList(){
  const s = new Set();
  return { add:c=>s.add(c), remove:c=>s.delete(c), contains:c=>s.has(c),
    toggle:(c,v)=>{ const on = v===undefined ? !s.has(c) : !!v; on?s.add(c):s.delete(c); return on; }, _s:s };
}
function makeEl(id){
  return { id, innerHTML:'', textContent:'', value:'', className:'', style:{}, classList: classList(),
           addEventListener(){}, focus(){}, appendChild(){}, remove(){}, querySelector(){ return null; } };
}
const now = Date.now();
const usage = { success:true, total:106298, max:400000, workers:2669, pages:103629, UpdateTime: now-60000,
  msg:'✅ 成功更新免费额度使用数据',
  resources:{ d1:{rowsRead:26966,rowsReadLimit:20000000}, kv:{reads:704,readsLimit:400000}, r2:{classA:3,classALimit:4000000} } };
const config = [
  { ID:1, Name:'zhua884177403070@163.com', AccountID:'017aaaaaaaaaaaaaaaaaaaaaaa4d', UpdateTime: now-120000, Usage:{success:true,workers:2057,pages:7400,total:9457,max:100000} },
  { ID:2, Name:'smmoeff@qq.com', AccountID:'756bbbbbbbbbbbbbbbbbbbbbbb2b', UpdateTime: now-300000, Usage:{success:true,workers:612,pages:0,total:612,max:100000} },
  { ID:3, Name:'bad@example.com', AccountID:'804ccccccccccccccccccccccc9b', UpdateTime: now-900000, LastCheckError:'Token 权限不足', Usage:{success:false,workers:0,pages:0,total:0,max:100000} }
];
const sandbox = {
  console, Date, Math, Number, String, Array, Object, JSON, RegExp, isNaN, parseInt, parseFloat,
  document: {
    documentElement: { classList: classList(), _a:{}, setAttribute(k,v){this._a[k]=v;}, getAttribute(k){return this._a[k] ?? null;} },
    body: { appendChild(){} }, hidden:false,
    getElementById(id){ return elements[id] || (elements[id] = makeEl(id)); },
    createElement(tag){ return makeEl('el:'+tag); },
    addEventListener(){}, querySelector(){ return null; }
  },
  localStorage: { _d:{}, getItem(k){ return this._d[k] ?? null; }, setItem(k,v){ this._d[k]=v; } },
  window: { matchMedia: () => ({ matches:false }) },
  requestAnimationFrame: fn => fn(),
  setTimeout: () => 0, setInterval: () => 0,
  location: { origin:'https://usage.abc1221.ccwu.cc', href:'', search:'' },
  fetch: async (url) => ({ json: async () => (String(url).includes('config.json') ? config : usage) }),
  navigator: { clipboard: null },
  encodeURIComponent, decodeURIComponent
};
sandbox.globalThis = sandbox;

(async () => {
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename:'admin-script.js' });
  await new Promise(r => setTimeout(r, 80));
  const ov = (elements['overview']||{}).innerHTML || '';
  const tb = (elements['accBody']||{}).innerHTML || '';
  fs.writeFileSync(path.join(os.tmpdir(), 'admin-overview.html'), ov);
  fs.writeFileSync(path.join(os.tmpdir(), 'admin-table.html'), tb);
  console.log('overview len', ov.length, '| table len', tb.length);
  console.log('rows:', (tb.match(/<tr>/g)||[]).length, '| badges ok:', (tb.match(/badge-success/g)||[]).length,
              '| badges err:', (tb.match(/badge-error/g)||[]).length);
  console.log('meta:', (elements['accMeta']||{}).textContent);
  console.log('div balance:', (tb.match(/<div/g)||[]).length, (tb.match(/<\/div>/g)||[]).length);
  console.log('overview div balance:', (ov.match(/<div/g)||[]).length, (ov.match(/<\/div>/g)||[]).length);
  console.log('table snippet:', tb.slice(0, 260).replace(/\n/g,' '));
  vm.runInContext('toggleAnon()', sandbox);
  const anonTb = (elements['accBody'] || {}).innerHTML || '';
  console.log('admin anon -> 账户 A:', anonTb.includes('账户 A'), '| leaks real name:', anonTb.includes('@example.com'));
  vm.runInContext('toggleAnon()', sandbox);
  // CSS 覆盖检查
  const style = html.match(/<style>([\s\S]*?)<\/style>/)[1];
  const defined = new Set();
  for (const m of style.matchAll(/\.([a-zA-Z][\w-]*)/g)) defined.add(m[1]);
  const src = ov + tb + html.match(/<body>[\s\S]*?<script>/)[0];
  const used = new Set();
  for (const m of src.matchAll(/class="([^"]+)"/g)) m[1].split(/\s+/).forEach(c=>c&&used.add(c));
  const missing = [...used].filter(c=>!defined.has(c));
  console.log('MISSING in CSS:', missing.length ? missing : 'none');
})().catch(e => { console.error('FAIL', e); process.exit(1); });
