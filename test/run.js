// 依次运行三个测试（后端接口 / 主页渲染 / 管理面板渲染）
const path = require('path');
const { execFileSync } = require('child_process');

const files = ['backend.test.js', 'home.test.js', 'admin.test.js', 'edit.test.js', 'plan.test.js'];
let failed = 0;
for (const f of files){
  console.log('\n=== ' + f + ' ===');
  try {
    execFileSync(process.execPath, [path.join(__dirname, f)], { stdio: 'inherit' });
  } catch (e) {
    failed++;
  }
}
if (failed){
  console.error('\n' + failed + ' 个测试文件失败');
  process.exit(1);
}
console.log('\n全部测试通过');
