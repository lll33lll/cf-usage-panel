const fs = require('fs');
const os = require('os');
const path = require('path');
const nodeCrypto = require('crypto');

// Node 18 没有全局 crypto，补上
if (!globalThis.crypto) globalThis.crypto = nodeCrypto.webcrypto;

// node 的 crypto.subtle 不支持 MD5，这里补上（Worker 运行时支持 MD5）
const origDigest = globalThis.crypto.subtle.digest.bind(globalThis.crypto.subtle);
globalThis.crypto.subtle.digest = async function(alg, data){
  const name = (typeof alg === 'string' ? alg : alg.name || '').toUpperCase();
  if (name === 'MD5'){
    const buf = nodeCrypto.createHash('md5').update(Buffer.from(data)).digest();
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  }
  return origDigest(alg, data);
};

const store = {};
const KV = {
  async get(k, opts){ const v = store[k]; if (v === undefined || v === null) return null; return (opts && opts.type === 'json') ? JSON.parse(v) : v; },
  async put(k, v){ store[k] = v; }
};
const env = { PASSWORD: 'UsPn9xK2mQ7zT4bV6', USERNAME: 'admin', KV };
const UA = 'Mozilla/5.0 (TestRunner)';
const BASE = 'https://usage.abc1221.ccwu.cc';

function req(p){ return new Request(BASE + p, { headers: { 'User-Agent': UA } }); }

(async () => {
  // dist/worker.js 是 ESM，但本仓库是 CJS —— 复制成 .mjs 再动态导入
  const tmpWorker = path.join(os.tmpdir(), 'cf-usage-panel-worker.mjs');
  fs.copyFileSync(path.join(__dirname, '..', 'dist', 'worker.js'), tmpWorker);
  const worker = (await import(tmpWorker)).default;

  const res = await worker.fetch(req('/'), env, {});
  const html = await res.text();
  console.log('[home] status', res.status, 'len', html.length);
  for (const m of ['Cloudflare 用量面板', '账号明细', 'accounts.json', 'toggleAcc', 'renderAccount']) {
    console.log('  contains', JSON.stringify(m), html.includes(m));
  }
  const mt = html.match(/var TOKEN = '([^']+)'/);
  console.log('[home] token', mt && mt[1]);
  const token = mt[1];

  const r2 = await worker.fetch(req('/accounts.json?token=' + token), env, {});
  const j = await r2.json();
  console.log('[accounts.json empty]', JSON.stringify(j).slice(0, 260));

  // 注入两个账号的模拟数据
  const now = Date.now();
  store['usage_config.json'] = JSON.stringify([
    { ID: 0, Name: '主账号', AccountID: '6d7a1b2c3d4e5f6a7b8c9d0e1f2a3b90', APIToken: 'tok1', UpdateTime: now - 120000,
      Usage: { success: true, pages: 11111, workers: 12345, total: 23456, max: 100000, msg: '',
        resources: { d1:{rowsRead:120000,rowsReadLimit:5000000,rowsWritten:800,rowsWrittenLimit:100000,storageBytes:18874368,storageLimitBytes:5368709120,databases:2},
                     kv:{reads:10200,readsLimit:100000,writes:12,writesLimit:1000,deletes:0,deletesLimit:1000,lists:2,listsLimit:1000,storageBytes:3145728,storageLimitBytes:1073741824,keys:140,namespaces:2},
                     r2:{classA:1600,classALimit:1000000,classB:52000,classBLimit:10000000,storageBytes:167772160,storageLimitBytes:10737418240,objects:1100,buckets:1} } } },
    { ID: 1, Name: '备用账号', Email: 'me@example.com', GlobalAPIKey: 'gk', UpdateTime: now - 7200000, LastCheckError: 'Token 权限不足',
      Usage: { success: false, pages: 0, workers: 0, total: 0, max: 100000, msg: '', resources: {} } }
  ]);
  store['usage.json'] = JSON.stringify({ success: true, pages: 11111, workers: 12345, total: 23456, max: 200000, UpdateTime: now - 60000, msg: '✅ 成功更新',
    resources: { d1:{rowsRead:120000,rowsReadLimit:5000000,rowsWritten:800,rowsWrittenLimit:100000,storageBytes:18874368,storageLimitBytes:5368709120,databases:2},
                 kv:{reads:10200,readsLimit:100000,writes:12,writesLimit:1000,storageBytes:3145728,storageLimitBytes:1073741824},
                 r2:{classA:1600,classALimit:1000000,classB:52000,classBLimit:10000000,storageBytes:167772160,storageLimitBytes:10737418240} } });

  const r3 = await worker.fetch(req('/accounts.json?token=' + token), env, {});
  const j3 = await r3.json();
  console.log('[accounts.json data] success=', j3.success, 'n=', j3.accounts.length, 'totals=', JSON.stringify(j3.totals && {total:j3.totals.total,max:j3.totals.max}));
  console.log('  acc0=', JSON.stringify(j3.accounts[0]).slice(0, 200));
  console.log('  acc1=', JSON.stringify(j3.accounts[1]).slice(0, 200));

  // 用真实数据在 node 里模拟前端渲染（把 home.html 的 script 抽出来跑核心函数）
  console.log('[done]');
})().catch(e => { console.error('FAIL', e); process.exit(1); });
