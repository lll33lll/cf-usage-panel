// api/edit 接口测试：改名 / 校验 / 权限 / 边界
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

(async () => {
  const tmpWorker = path.join(os.tmpdir(), 'cf-usage-panel-edit-test.mjs');
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
    PASSWORD: 'test-pw-123'
  };

  const seed = () => {
    store['usage_config.json'] = JSON.stringify([
      { ID: 1, Name: '旧名字', AccountID: 'acct-aaa', APIToken: 'tok-1', Usage: {} },
      { ID: 2, Name: '第二个', AccountID: 'acct-bbb', APIToken: 'tok-2', Usage: {} }
    ]);
  };
  const cfg = () => JSON.parse(store['usage_config.json']);

  const post = (p, body, cookie) => worker.fetch(
    new Request('https://x.test' + p, {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, cookie ? { Cookie: cookie } : {}),
      body: JSON.stringify(body)
    }), env, {});

  // 登录拿 cookie
  seed();
  const lr = await post('/api/login', { username: 'admin', password: 'test-pw-123' });
  const setCookie = lr.headers.get('Set-Cookie') || '';
  const cookie = setCookie.split(';')[0];
  ok(lr.status === 200 && cookie.startsWith('admin_token='), '登录成功并拿到 cookie');

  console.log('\n[未登录]');
  seed();
  let r = await post('/api/edit', { ID: 1, Name: '不该生效' });
  ok(r.status === 401, '未登录改名为 401');
  ok(cfg()[0].Name === '旧名字', '未登录时数据未被改动');

  console.log('\n[改名称]');
  r = await post('/api/edit', { ID: 1, Name: '主账号' }, cookie);
  let d = await r.json();
  ok(r.status === 200 && d.success, '改名成功');
  ok(cfg()[0].Name === '主账号', 'KV 里的名称已更新');
  ok(cfg()[0].AccountID === 'acct-aaa' && cfg()[0].APIToken === 'tok-1', '认证信息未被误改');
  ok(cfg()[1].Name === '第二个', '另一个账号未受影响');
  ok(d.data && d.data.oldName === '旧名字', '返回里带上了原名称');

  console.log('\n[边界]');
  r = await post('/api/edit', { ID: 1, Name: '   ' }, cookie);
  ok(r.status === 400, '空白名称被拒');
  r = await post('/api/edit', { ID: 1, Name: 'x'.repeat(41) }, cookie);
  ok(r.status === 400, '超长名称被拒');
  r = await post('/api/edit', { ID: 999, Name: '不存在' }, cookie);
  ok(r.status === 404, '不存在的 ID 返回 404');
  r = await post('/api/edit', { Name: '没有ID' }, cookie);
  ok(r.status === 400, '缺少 ID 返回 400');
  ok(cfg()[0].Name === '主账号', '以上失败都没弄脏数据');

  console.log('\n[改认证信息]');
  r = await post('/api/edit', { ID: 2, Name: '第二个', APIToken: 'tok-2' }, cookie);
  d = await r.json();
  ok(r.status === 200 && d.success, '认证信息填了相同值（视为未变）也能保存');

  console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败');
  if (fail) process.exit(1);
})();
