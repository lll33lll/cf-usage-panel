// 套餐（免费/付费）自适应测试：额度、周期、增删改
const fs = require('fs');
const os = require('os');
const path = require('path');
const nodeCrypto = require('crypto');

if (!globalThis.crypto) globalThis.crypto = nodeCrypto.webcrypto;
const origDigest = globalThis.crypto.subtle.digest.bind(globalThis.crypto.subtle);
globalThis.crypto.subtle.digest = async function(alg, data){
  const name = (typeof alg === 'string' ? alg : alg.name || '').toUpperCase();
  if (name === 'MD5'){
    const h = nodeCrypto.createHash('md5').update(Buffer.from(data)).digest();
    return h.buffer.slice(h.byteOffset, h.byteOffset + h.byteLength);
  }
  return origDigest(alg, data);
};

let pass = 0, fail = 0;
function ok(cond, label){
  if (cond){ pass++; console.log('  ✓', label); }
  else { fail++; console.log('  ✗', label); }
}

// 记录 GraphQL 请求里的 filter，用来验证周期
const graphqlFilters = [];

globalThis.fetch = async (url, opts) => {
  const u = String(url);
  if (u.includes('/graphql')){
    let vars = {};
    try { vars = JSON.parse(opts.body).variables || {}; } catch(e){}
    if (vars.filter) graphqlFilters.push(vars.filter);
    if (vars.dayStart) graphqlFilters.push({ date_geq: vars.dayStart });
    if (vars.monthStart) graphqlFilters.push({ monthStart: vars.monthStart });
    return {
      ok: true,
      json: async () => ({ data: { viewer: { accounts: [{
        pagesFunctionsInvocationsAdaptiveGroups: [{ sum: { requests: 5 } }],
        workersInvocationsAdaptive: [{ sum: { requests: 7 } }],
        d1AnalyticsAdaptiveGroups: [], d1StorageAdaptiveGroups: [],
        kvOperationsAdaptiveGroups: [], kvStorageAdaptiveGroups: [],
        r2OperationsAdaptiveGroups: [], r2StorageAdaptiveGroups: []
      }] } } })
    };
  }
  return { ok: false, status: 404, json: async () => ({}) };
};

(async () => {
  const tmpWorker = path.join(os.tmpdir(), 'cf-usage-panel-plan-test.mjs');
  fs.copyFileSync(path.join(__dirname, '..', 'dist', 'worker.js'), tmpWorker);
  const worker = (await import(tmpWorker)).default;

  const store = {};
  const env = {
    KV: {
      async get(k, opt){
        const v = store[k];
        if (v === undefined) return null;
        return (opt && opt.type === 'json') ? JSON.parse(v) : v;
      },
      async put(k, v){ store[k] = v; }
    },
    USERNAME: 'admin',
    PASSWORD: 'pw'
  };
  const cfg = () => JSON.parse(store['usage_config.json'] || '[]');

  const post = (p, body, cookie) => worker.fetch(
    new Request('https://x.test' + p, {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, cookie ? { Cookie: cookie } : {}),
      body: JSON.stringify(body)
    }), env, {});

  const lr = await post('/api/login', { username: 'admin', password: 'pw' });
  const cookie = (lr.headers.get('Set-Cookie') || '').split(';')[0];

  console.log('\n[添加免费账号]');
  graphqlFilters.length = 0;
  let r = await post('/api/add', { Name: '免费号', AccountID: 'a1', APIToken: 't1', Plan: 'free' }, cookie);
  let d = await r.json();
  ok(r.status === 200 && d.success, '添加成功');
  ok(cfg()[0].Plan === 'free', 'Plan 存为 free');
  ok(cfg()[0].Usage.max === 100000, '额度 100,000（免费档）');
  ok(cfg()[0].Usage.cycle === 'day', '周期 = day');
  ok(graphqlFilters.some(f => f.datetime_geq && f.datetime_geq.endsWith('T00:00:00.000Z')), '查询窗口起点是当天 UTC 00:00');

  console.log('\n[添加付费账号]');
  graphqlFilters.length = 0;
  r = await post('/api/add', { Name: '付费号', AccountID: 'a2', APIToken: 't2', Plan: 'paid' }, cookie);
  d = await r.json();
  ok(r.status === 200 && d.success, '添加成功');
  ok(cfg()[1].Plan === 'paid', 'Plan 存为 paid');
  ok(cfg()[1].Usage.max === 10000000, '额度 10,000,000（付费档）');
  ok(cfg()[1].Usage.cycle === 'month', '周期 = month');
  ok(graphqlFilters.some(f => f.datetime_geq && f.datetime_geq.endsWith('-01T00:00:00.000Z')), '查询窗口起点是当月 1 号');

  console.log('\n[不传 Plan 默认免费]');
  r = await post('/api/add', { Name: '没写套餐', AccountID: 'a3', APIToken: 't3' }, cookie);
  ok(cfg()[2].Plan === 'free', '默认 free');

  console.log('\n[编辑切换套餐]');
  graphqlFilters.length = 0;
  r = await post('/api/edit', { ID: 1, Name: '免费号', Plan: 'paid' }, cookie);
  d = await r.json();
  ok(r.status === 200 && d.success, '切换成功');
  ok(d.msg.indexOf('付费版') >= 0, '提示里带上了新套餐名');
  ok(cfg()[0].Plan === 'paid', 'KV 里 Plan 已改为 paid');
  ok(cfg()[0].Usage.max === 10000000, '额度跟着变成 10,000,000');
  ok(graphqlFilters.some(f => f.datetime_geq && f.datetime_geq.endsWith('-01T00:00:00.000Z')), '重新查询用了「月」窗口');

  console.log('\n[只改名字不动套餐]');
  r = await post('/api/edit', { ID: 2, Name: '改个名', Plan: 'paid' }, cookie);
  ok(cfg()[1].Plan === 'paid', '套餐保持 paid');
  ok(cfg()[1].Usage.max === 10000000, '额度仍是 10,000,000');
  ok(cfg()[1].Name === '改个名', '名字已更新');

  console.log('\n[管理接口输出]');
  const cr = await worker.fetch(new Request('https://x.test/admin/config.json', { headers: { Cookie: cookie } }), env, {});
  const cj = await cr.json();
  ok(Array.isArray(cj), 'config.json 返回数组');
  ok(cj[0] && cj[0].Plan === 'paid', '账号 1 的 Plan = paid');
  ok(cj[2] && cj[2].Plan === 'free', '账号 3 的 Plan = free');
  ok(cj[0].Usage && cj[0].Usage.max === 10000000, '账号 1 的额度是付费档');
  ok(cj[2].Usage && cj[2].Usage.max === 100000, '账号 3 的额度是免费档');

  console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败');
  if (fail) process.exit(1);
})();
