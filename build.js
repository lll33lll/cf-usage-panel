// 构建脚本：把 src/*.html 注入 src/worker.js 的页面函数，输出 dist/worker.js
// 用法：node build.js
const fs = require('fs');
const path = require('path');

const root = __dirname;
const srcWorker = path.join(root, 'src', 'worker.js');
const outFile = path.join(root, 'dist', 'worker.js');

// 顺序必须与 src/worker.js 中函数出现的顺序一致
const PAGES = [
  { fn: 'UsagePanel登录页', file: 'src/login.html', args: '' },
  { fn: 'UsagePanel管理面板', file: 'src/admin.html', args: '' },
  { fn: 'UsagePanel主页', file: 'src/home.html', args: 'TOKEN, 已登录' }
];

function buildFn(fnName, file, args){
  let html = fs.readFileSync(path.join(root, file), 'utf8');
  // 页面里不使用反引号和 ${，这里做一层保险的转义
  html = html.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
  html = html.replace(/__TOKEN__/g, '${TOKEN}');
  html = html.replace(/__LOGGED_IN__/g, '${已登录 ? "true" : "false"}');
  return [
    'async function ' + fnName + '(' + args + ') {',
    '    const html = `' + html + '`;',
    "    return new Response(html, { status: 200, headers: { 'Content-Type': 'text/html; charset=UTF-8', 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0' } })",
    '}',
    ''
  ].join('\n');
}

const src = fs.readFileSync(srcWorker, 'utf8');
const marks = PAGES.map(p => 'async function ' + p.fn + '(');
const idxs = marks.map(m => src.indexOf(m));
for (let i = 0; i < idxs.length; i++){
  if (idxs[i] < 0) throw new Error('找不到页面函数占位: ' + PAGES[i].fn);
  if (i > 0 && idxs[i] < idxs[i - 1]) throw new Error('页面函数顺序不对: ' + PAGES[i].fn);
}

let out = src.slice(0, idxs[0]);
const parts = [];
for (const p of PAGES){
  const fn = buildFn(p.fn, p.file, p.args);
  parts.push(p.fn.replace('UsagePanel', '') + ' ' + fn.length);
  out += fn;
}

fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, out);
console.log('dist/worker.js  ' + out.length + ' bytes  (' + parts.join(', ') + ')');
