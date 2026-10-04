

export default {
    async fetch(request, env, ctx) {
        const 面板管理员账号 = env.USER || env.user || env.USERNAME || env.username || 'admin';
        const 面板管理员密码 = env.ADMIN || env.admin || env.PASSWORD || env.password || env.pswd;
        const 演示样板 = env.DEMO ? true : false;
        if (!面板管理员密码) {
            return new Response('请先在变量中设置 PASSWORD 变量', { status: 500 });
        }

        if (env.KV && typeof env.KV.get === 'function') {
            const url = new URL(request.url);
            const UA = request.headers.get('User-Agent') || 'null';
            const 访问路径 = url.pathname.slice(1).toLowerCase();
            const 区分大小写访问路径 = url.pathname.slice(1);

            const 管理员TOKEN = await MD5MD5(面板管理员密码 + 面板管理员账号);
            const 临时TOKEN = await MD5MD5(url.hostname + 管理员TOKEN + UA);
            const 管理员COOKIE = await MD5MD5(管理员TOKEN + UA);

            // 验证管理员Cookie的函数
            const 验证管理员Cookie = () => {
                const cookies = request.headers.get('Cookie') || '';
                const cookieMatch = cookies.match(/admin_token=([^;]+)/);
                return cookieMatch && cookieMatch[1] === 管理员COOKIE;
            };

            if (访问路径 == 'usage.json') {// 请求数使用数据接口 Usage.json
                let usage_json = 创建默认Usage(false);
                if (url.searchParams.get('token') === 临时TOKEN || url.searchParams.get('token') === 管理员TOKEN) {
                    const 当前时间 = Date.now();
                    const 已保存Usage = await env.KV.get('usage.json', { type: 'json' });
                    const 已保存更新时间 = Number(已保存Usage?.UpdateTime || 0) || 0;
                    usage_json = 补全Usage结构(已保存Usage || {});
                    usage_json.success = true;
                    usage_json.total = (usage_json.pages || 0) + (usage_json.workers || 0);
                    usage_json.msg = '✅ 成功加载免费额度使用数据';
                    if (!已保存更新时间 || (当前时间 - 已保存更新时间) > 获取单账号查询间隔毫秒(env)) usage_json = await 更新请求数(env);
                }
                return new Response(JSON.stringify(usage_json, null, 2), { headers: { 'Content-Type': 'application/json;charset=UTF-8', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Cache-Control': 'no-store' } });
            } else if (访问路径 == 'accounts.json') {// 账号级使用数据接口（供主页分账号展示）
                let 账号数据 = { success: false, msg: '❌ 无效TOKEN', UpdateTime: 0, totals: null, accounts: [] };
                if (url.searchParams.get('token') === 临时TOKEN || url.searchParams.get('token') === 管理员TOKEN) {
                    const 当前时间 = Date.now();
                    const 已保存Usage = await env.KV.get('usage.json', { type: 'json' });
                    const 已保存更新时间 = Number(已保存Usage?.UpdateTime || 0) || 0;
                    let 汇总 = 补全Usage结构(已保存Usage || {});
                    const 强制刷新 = url.searchParams.get('force') === '1';
                    if (强制刷新 || !已保存更新时间 || (当前时间 - 已保存更新时间) > 获取单账号查询间隔毫秒(env)) 汇总 = await 更新请求数(env, { force: 强制刷新 });

                    const 账号列表 = await env.KV.get('usage_config.json', { type: 'json' });
                    const 归一化账号 = (Array.isArray(账号列表) ? 账号列表 : []).map((item, index) => {
                        const usage = 补全账号Usage结构(item);
                        const workers = usage.workers || 0;
                        const pages = usage.pages || 0;
                        const 失败原因 = item.LastCheckError || '';
                        return {
                            id: item.ID === 0 || item.ID ? item.ID : index,
                            name: item.Name || ('账号 ' + (index + 1)),
                            accountId: item.AccountID ? 掩码敏感信息(item.AccountID) : (item.Email ? String(item.Email) : ''),
                            updateTime: 获取账号最后更新时间(item),
                            ok: !!usage.success,
                            msg: 失败原因 || usage.msg || '',
                            workers: workers,
                            pages: pages,
                            total: workers + pages,
                            max: usage.max || 免费额度.requestsDaily,
                            resources: usage.resources,
                            trend: Array.isArray(usage.trend) ? usage.trend : []
                            };
                    });

                    账号数据 = {
                        success: true,
                        msg: 汇总.msg || '✅ 成功加载免费额度使用数据',
                        UpdateTime: 汇总.UpdateTime || 0,
                        totals: {
                            workers: 汇总.workers || 0,
                            pages: 汇总.pages || 0,
                            total: 汇总.total || 0,
                            max: 汇总.max || 0,
                            resources: 汇总.resources || 创建汇总资源统计(),
                            trend: Array.isArray(汇总.trend) ? 汇总.trend : []
                        },
                        accounts: 归一化账号
                    };
                }
                return new Response(JSON.stringify(账号数据), { headers: { 'Content-Type': 'application/json;charset=UTF-8', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Cache-Control': 'no-store' } });
            } else if (访问路径 == 'admin' || 访问路径.startsWith('admin/')) {// 管理员面板
                // 管理面板 - 验证Cookie
                if (验证管理员Cookie()) {
                    if (区分大小写访问路径 === 'admin/config.json') {
                        const usage_config_json = await env.KV.get('usage_config.json', { type: 'json' }) || [];
                        const masked_config_json = usage_config_json.map(item => {
                            const updateTime = 获取账号最后更新时间(item);
                            return {
                                ...item,
                                UpdateTime: updateTime || item.UpdateTime,
                                Usage: 补全账号Usage结构(item),
                                GlobalAPIKey: item.GlobalAPIKey ? 掩码敏感信息(item.GlobalAPIKey) : null,
                                APIToken: item.APIToken ? 掩码敏感信息(item.APIToken) : null
                            };
                        });
                        return new Response(JSON.stringify(masked_config_json, null, 2), { status: 200, headers: { 'Content-Type': 'application/json;charset=UTF-8' } });
                    } else if (区分大小写访问路径 === 'admin/usage.json') {
                        const usage_json = await 更新请求数(env, { force: url.searchParams.get('force') === '1' });
                        return new Response(JSON.stringify(usage_json, null, 2), { headers: { 'Content-Type': 'application/json;charset=UTF-8' } });
                    }

                    return UsagePanel管理面板();
                }

                // 未登录：页面给登录界面，接口给 401
                if (区分大小写访问路径 === 'admin' || 区分大小写访问路径 === 'admin/') {
                    return UsagePanel登录页();
                }
                return new Response(JSON.stringify({ success: false, msg: '未登录或登录已过期' }), {
                    status: 401,
                    headers: { 'Content-Type': 'application/json;charset=UTF-8' }
                });

            } else if (区分大小写访问路径.startsWith('api/')) {// API接口
                if (区分大小写访问路径 === 'api/login') { // 管理员登录接口
                    if (request.method !== 'POST') {
                        return new Response(JSON.stringify({ success: false, msg: 'Method Not Allowed' }), { status: 405, headers: { 'Content-Type': 'application/json;charset=UTF-8' } });
                    }
                    try {
                        const body = await request.json();
                        const 输入账号 = body.username || '';
                        const 输入密码 = body.password || '';
                        if (输入账号 === 面板管理员账号 && 输入密码 === 面板管理员密码) {
                            // 账号密码正确，设置Cookie
                            return new Response(JSON.stringify({ success: true, msg: '登录成功' }), {
                                status: 200,
                                headers: {
                                    'Content-Type': 'application/json;charset=UTF-8',
                                    'Set-Cookie': `admin_token=${管理员COOKIE}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=86400`
                                }
                            });
                        } else {
                            return new Response(JSON.stringify({ success: false, msg: '账号或密码错误' }), {
                                status: 401,
                                headers: { 'Content-Type': 'application/json;charset=UTF-8' }
                            });
                        }
                    } catch (e) {
                        return new Response(JSON.stringify({ success: false, msg: '请求格式错误' }), {
                            status: 400,
                            headers: { 'Content-Type': 'application/json;charset=UTF-8' }
                        });
                    }
                }

                if (区分大小写访问路径 === 'api/me') {// 登录态探测（供页面校正缓存导致的过期状态）
                    return new Response(JSON.stringify({ success: true, logged: !!验证管理员Cookie() }), {
                        headers: { 'Content-Type': 'application/json;charset=UTF-8', 'Cache-Control': 'no-store' }
                    });
                }

                if (request.method !== 'POST') {
                    return new Response(JSON.stringify({ success: false, msg: 'Method Not Allowed' }), { status: 405, headers: { 'Content-Type': 'application/json;charset=UTF-8' } });
                }
                if (!验证管理员Cookie()) {
                    return new Response(JSON.stringify({ success: false, msg: '未登录或登录已过期，请重新登录' }), {
                        status: 401,
                        headers: { 'Content-Type': 'application/json;charset=UTF-8', 'Cache-Control': 'no-store' }
                    });
                }

                if (区分大小写访问路径 === 'api/logout') {// 登出接口
                    return new Response(JSON.stringify({ success: true, msg: '登出成功' }), {
                        status: 200,
                        headers: {
                            'Content-Type': 'application/json;charset=UTF-8',
                            'Set-Cookie': `admin_token=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`
                        }
                    });
                } else if (区分大小写访问路径 === 'api/add' && !演示样板) {// 增加CF账号
                    try {
                        const newConfig = await request.json();

                        // 验证配置完整性：需要 (Email + GlobalAPIKey) 或 (AccountID + APIToken)
                        const hasEmailAuth = newConfig.Email && newConfig.GlobalAPIKey;
                        const hasTokenAuth = newConfig.AccountID && newConfig.APIToken;

                        if (!hasEmailAuth && !hasTokenAuth) {
                            return new Response(JSON.stringify({ success: false, msg: '配置不完整，需要提供 Email+GlobalAPIKey 或 AccountID+APIToken' }), { status: 400, headers: { 'Content-Type': 'application/json;charset=utf-8' } });
                        }

                        const now = Date.now();
                        const CF_JSON = {
                            ID: 0,
                            Name: newConfig.Name || '未命名账号',
                            Email: hasEmailAuth ? newConfig.Email : null,
                            GlobalAPIKey: hasEmailAuth ? newConfig.GlobalAPIKey : null,
                            AccountID: newConfig.AccountID || null,
                            APIToken: hasTokenAuth ? newConfig.APIToken : null,
                            UpdateTime: now,
                            LastCheckTime: now,
                            Usage: 创建默认Usage(false)
                        };

                        // 验证 API 信息是否有效
                        const usage_result = await getCloudflareUsage(CF_JSON.Email, CF_JSON.GlobalAPIKey, CF_JSON.AccountID, CF_JSON.APIToken);
                        if (!usage_result.success) {
                            return new Response(JSON.stringify({ success: false, msg: '无法验证该CF账号的API信息' }), { status: 400, headers: { 'Content-Type': 'application/json;charset=utf-8' } });
                        }

                        CF_JSON.UpdateTime = Date.now();
                        CF_JSON.LastCheckTime = CF_JSON.UpdateTime;
                        CF_JSON.Usage = 补全账号Usage结构({ ...CF_JSON, Usage: usage_result });

                        // 读取现有配置
                        let usage_config_json = await env.KV.get('usage_config.json', { type: 'json' });
                        if (!Array.isArray(usage_config_json)) {
                            usage_config_json = [];
                        }

                        // 验证账号是否已存在 (通过 Email 或 AccountID 判断)
                        const existingIndex = usage_config_json.findIndex(item =>
                            (CF_JSON.Email && item.Email && item.Email.toLowerCase() === CF_JSON.Email.toLowerCase()) ||
                            (CF_JSON.AccountID && item.AccountID && item.AccountID === CF_JSON.AccountID)
                        );

                        if (existingIndex !== -1) {
                            // 账号已存在，更新现有账号信息
                            const existingAccount = usage_config_json[existingIndex];
                            CF_JSON.ID = existingAccount.ID; // 保留原有 ID
                            usage_config_json[existingIndex] = CF_JSON;
                            await env.KV.put('usage_config.json', 序列化账号配置(usage_config_json));

                            return new Response(JSON.stringify({ success: true, msg: '账号已存在，已更新账号信息', data: { ID: CF_JSON.ID, Name: CF_JSON.Name } }), { status: 200, headers: { 'Content-Type': 'application/json;charset=utf-8' } });
                        }

                        // 生成新 ID：现有最大 ID + 1，如果为空则从 1 开始
                        CF_JSON.ID = usage_config_json.length > 0
                            ? Math.max(...usage_config_json.map(item => item.ID || 0)) + 1
                            : 1;

                        // 添加到配置数组中并保存到 KV
                        usage_config_json.push(CF_JSON);
                        await env.KV.put('usage_config.json', 序列化账号配置(usage_config_json));

                        return new Response(JSON.stringify({ success: true, msg: '账号添加成功', data: { ID: CF_JSON.ID, Name: CF_JSON.Name } }), { status: 200, headers: { 'Content-Type': 'application/json;charset=utf-8' } });
                    } catch (error) {
                        console.error('保存配置失败:', error);
                        return new Response(JSON.stringify({ success: false, msg: '保存配置失败: ' + error.message }), { status: 500, headers: { 'Content-Type': 'application/json;charset=utf-8' } });
                    }

                } else if (区分大小写访问路径 === 'api/edit' && !演示样板) {// 修改CF账号
                    try {
                        const body = await request.json();
                        const targetId = body.ID;
                        if (targetId === undefined || targetId === null || targetId === '') {
                            return new Response(JSON.stringify({ success: false, msg: '缺少账号 ID' }), { status: 400, headers: { 'Content-Type': 'application/json;charset=utf-8' } });
                        }

                        let usage_config_json = await env.KV.get('usage_config.json', { type: 'json' });
                        if (!Array.isArray(usage_config_json) || !usage_config_json.length) {
                            return new Response(JSON.stringify({ success: false, msg: '账号配置为空' }), { status: 404, headers: { 'Content-Type': 'application/json;charset=utf-8' } });
                        }

                        const targetIndex = usage_config_json.findIndex(item => String(item.ID) === String(targetId));
                        if (targetIndex === -1) {
                            return new Response(JSON.stringify({ success: false, msg: '未找到该账号' }), { status: 404, headers: { 'Content-Type': 'application/json;charset=utf-8' } });
                        }

                        const account = usage_config_json[targetIndex];
                        const oldName = account.Name || '未命名账号';

                        // 1) 改名称
                        if (typeof body.Name === 'string') {
                            const name = body.Name.trim();
                            if (!name) {
                                return new Response(JSON.stringify({ success: false, msg: '账号名称不能为空' }), { status: 400, headers: { 'Content-Type': 'application/json;charset=utf-8' } });
                            }
                            if (name.length > 40) {
                                return new Response(JSON.stringify({ success: false, msg: '账号名称最多 40 个字符' }), { status: 400, headers: { 'Content-Type': 'application/json;charset=utf-8' } });
                            }
                            account.Name = name;
                        }

                        // 2) 可选：改认证信息（留空 = 保持原样）
                        const nextEmail = (typeof body.Email === 'string' && body.Email.trim()) ? body.Email.trim() : account.Email;
                        const nextKey = (typeof body.GlobalAPIKey === 'string' && body.GlobalAPIKey.trim()) ? body.GlobalAPIKey.trim() : account.GlobalAPIKey;
                        const nextAccountID = (typeof body.AccountID === 'string' && body.AccountID.trim()) ? body.AccountID.trim() : account.AccountID;
                        const nextToken = (typeof body.APIToken === 'string' && body.APIToken.trim()) ? body.APIToken.trim() : account.APIToken;

                        const authChanged = nextEmail !== account.Email || nextKey !== account.GlobalAPIKey
                            || nextAccountID !== account.AccountID || nextToken !== account.APIToken;

                        if (authChanged) {
                            const hasEmailAuth = !!(nextEmail && nextKey);
                            const hasTokenAuth = !!(nextAccountID && nextToken);
                            if (!hasEmailAuth && !hasTokenAuth) {
                                return new Response(JSON.stringify({ success: false, msg: '认证信息不完整：需要 AccountID + API Token 或 邮箱 + 全局密钥' }), { status: 400, headers: { 'Content-Type': 'application/json;charset=utf-8' } });
                            }
                            const usage_result = await getCloudflareUsage(nextEmail, nextKey, nextAccountID, nextToken);
                            if (!usage_result.success) {
                                return new Response(JSON.stringify({ success: false, msg: '新的 API 信息校验失败，本次未做任何修改' }), { status: 400, headers: { 'Content-Type': 'application/json;charset=utf-8' } });
                            }
                            account.Email = hasEmailAuth ? nextEmail : null;
                            account.GlobalAPIKey = hasEmailAuth ? nextKey : null;
                            account.AccountID = nextAccountID || null;
                            account.APIToken = hasTokenAuth ? nextToken : null;
                            account.Usage = 补全账号Usage结构({ ...account, Usage: usage_result });
                            account.UpdateTime = Date.now();
                            account.LastCheckTime = account.UpdateTime;
                        }

                        usage_config_json[targetIndex] = account;
                        await env.KV.put('usage_config.json', 序列化账号配置(usage_config_json));

                        return new Response(JSON.stringify({
                            success: true,
                            msg: authChanged ? '账号信息已更新' : ('名称已改为「' + account.Name + '」'),
                            data: { ID: account.ID, Name: account.Name, oldName }
                        }), { status: 200, headers: { 'Content-Type': 'application/json;charset=utf-8' } });
                    } catch (error) {
                        console.error('修改账号失败:', error);
                        return new Response(JSON.stringify({ success: false, msg: '修改失败: ' + error.message }), { status: 500, headers: { 'Content-Type': 'application/json;charset=utf-8' } });
                    }

                } else if (区分大小写访问路径 === 'api/del' && !演示样板) {// 删除CF账号
                    try {
                        const body = await request.json();
                        const deleteId = body.ID;

                        // 验证 ID 参数
                        if (deleteId === undefined || deleteId === null) {
                            return new Response(JSON.stringify({ success: false, msg: '请提供要删除的账号ID' }), { status: 400, headers: { 'Content-Type': 'application/json;charset=utf-8' } });
                        }

                        // 读取现有配置
                        let usage_config_json = await env.KV.get('usage_config.json', { type: 'json' });
                        if (!Array.isArray(usage_config_json) || usage_config_json.length === 0) {
                            return new Response(JSON.stringify({ success: false, msg: '配置列表为空，无法删除' }), { status: 404, headers: { 'Content-Type': 'application/json;charset=utf-8' } });
                        }

                        // 查找要删除的账号
                        const targetIndex = usage_config_json.findIndex(item => item.ID === deleteId);
                        if (targetIndex === -1) {
                            return new Response(JSON.stringify({ success: false, msg: `未找到ID为 ${deleteId} 的账号` }), { status: 404, headers: { 'Content-Type': 'application/json;charset=utf-8' } });
                        }

                        // 获取被删除账号的名称用于返回信息
                        const deletedName = usage_config_json[targetIndex].Name || '未命名账号';

                        // 删除该账号
                        usage_config_json.splice(targetIndex, 1);

                        // 保存回 KV
                        await env.KV.put('usage_config.json', 序列化账号配置(usage_config_json));

                        return new Response(JSON.stringify({ success: true, msg: `账号 "${deletedName}" 已删除`, data: { ID: deleteId, Name: deletedName } }), { status: 200, headers: { 'Content-Type': 'application/json;charset=utf-8' } });
                    } catch (error) {
                        console.error('删除账号失败:', error);
                        return new Response(JSON.stringify({ success: false, msg: '删除账号失败: ' + error.message }), { status: 500, headers: { 'Content-Type': 'application/json;charset=utf-8' } });
                    }

                } else if (区分大小写访问路径 === 'api/check' && !演示样板) {// 检查单个CF账号请求量接口
                    try {
                        const Usage_JSON = await getCloudflareUsage(url.searchParams.get('Email'), url.searchParams.get('GlobalAPIKey'), url.searchParams.get('AccountID'), url.searchParams.get('APIToken'));
                        return new Response(JSON.stringify(Usage_JSON, null, 2), { status: 200, headers: { 'Content-Type': 'application/json' } });
                    } catch (err) {
                        const errorResponse = { msg: '查询请求量失败，失败原因：' + err.message, error: err.message };
                        return new Response(JSON.stringify(errorResponse, null, 2), { status: 500, headers: { 'Content-Type': 'application/json;charset=utf-8' } });
                    }
                } else if (演示样板) {
                    return new Response(JSON.stringify({ success: false, msg: '预览模式下，无法进行此操作' }), { status: 403, headers: { 'Content-Type': 'application/json;charset=utf-8' } });
                }
            } else if (访问路径 === 'robots.txt') {
                return new Response('User-agent: *\nDisallow: /', { status: 200, headers: { 'Content-Type': 'text/plain; charset=UTF-8' } });
            } else if (url.pathname === '/') {
                return UsagePanel主页(临时TOKEN, 验证管理员Cookie());
            }

            return new Response('404 Not Found', { status: 404 });
        } else {
            return new Response('请先绑定一个KV命名空间到变量KV', { status: 500 });
        }
    },
    async scheduled(event, env, ctx) {
        // 定时执行请求数更新
        ctx.waitUntil((async () => {
            await 更新请求数(env);
        })());
    }
};

////////////////////////////////功能函数//////////////////////////////////
const 免费额度 = {
    requestsDaily: 100000,
    d1RowsReadDaily: 5000000,
    d1RowsWrittenDaily: 100000,
    d1StorageBytes: 5 * 1024 * 1024 * 1024,
    kvReadsDaily: 100000,
    kvWritesDaily: 1000,
    kvDeletesDaily: 1000,
    kvListsDaily: 1000,
    kvStorageBytes: 1 * 1024 * 1024 * 1024,
    r2ClassAMonthly: 1000000,
    r2ClassBMonthly: 10000000,
    r2StorageBytes: 10 * 1024 * 1024 * 1024
};

const 默认单账号查询间隔毫秒 = 20 * 60 * 1000;
const 默认每轮最多外部子请求数 = 50;

const R2_CLASS_A_ACTIONS = new Set([
    'listbuckets', 'putbucket', 'listobjects', 'listobjectsv2', 'putobject', 'copyobject',
    'completemultipartupload', 'createmultipartupload', 'lifecyclestoragetiertransition',
    'listmultipartuploads', 'uploadpart', 'uploadpartcopy', 'listparts',
    'putbucketencryption', 'putbucketcors', 'putbucketlifecycleconfiguration'
]);

const R2_CLASS_B_ACTIONS = new Set([
    'headbucket', 'headobject', 'getobject', 'usagesummary', 'getbucketencryption',
    'getbucketlocation', 'getbucketcors', 'getbucketlifecycleconfiguration'
]);

const R2_FREE_ACTIONS = new Set(['deleteobject', 'deleteobjects', 'deletebucket', 'abortmultipartupload']);

function 创建默认资源统计() {
    return {
        d1: {
            rowsRead: 0,
            rowsReadLimit: 免费额度.d1RowsReadDaily,
            rowsWritten: 0,
            rowsWrittenLimit: 免费额度.d1RowsWrittenDaily,
            readQueries: 0,
            writeQueries: 0,
            storageBytes: 0,
            storageLimitBytes: 免费额度.d1StorageBytes,
            databases: 0,
            period: 'day'
        },
        kv: {
            reads: 0,
            readsLimit: 免费额度.kvReadsDaily,
            writes: 0,
            writesLimit: 免费额度.kvWritesDaily,
            deletes: 0,
            deletesLimit: 免费额度.kvDeletesDaily,
            lists: 0,
            listsLimit: 免费额度.kvListsDaily,
            operations: 0,
            storageBytes: 0,
            storageLimitBytes: 免费额度.kvStorageBytes,
            keys: 0,
            namespaces: 0,
            period: 'day'
        },
        r2: {
            classA: 0,
            classALimit: 免费额度.r2ClassAMonthly,
            classB: 0,
            classBLimit: 免费额度.r2ClassBMonthly,
            free: 0,
            other: 0,
            operations: 0,
            storageBytes: 0,
            storageLimitBytes: 免费额度.r2StorageBytes,
            objects: 0,
            buckets: 0,
            period: 'month'
        }
    };
}

function 创建汇总资源统计() {
    const resources = 创建默认资源统计();
    resources.d1.rowsReadLimit = 0;
    resources.d1.rowsWrittenLimit = 0;
    resources.d1.storageLimitBytes = 0;
    resources.kv.readsLimit = 0;
    resources.kv.writesLimit = 0;
    resources.kv.deletesLimit = 0;
    resources.kv.listsLimit = 0;
    resources.kv.storageLimitBytes = 0;
    resources.r2.classALimit = 0;
    resources.r2.classBLimit = 0;
    resources.r2.storageLimitBytes = 0;
    return resources;
}

function 创建默认Usage(success = false, msg = '❌ 无效TOKEN') {
    return {
        success,
        pages: 0,
        workers: 0,
        total: 0,
        max: success ? 免费额度.requestsDaily : 0,
        resources: 创建默认资源统计(),
        UpdateTime: Date.now(),
        msg
    };
}

function 合并资源统计(base, extra = {}) {
    const merged = { ...base };
    for (const key of Object.keys(base)) {
        merged[key] = { ...base[key], ...(extra?.[key] || {}) };
    }
    return merged;
}

function 补全Usage结构(usage) {
    const source = usage || {};
    const base = 创建默认Usage(false);
    const normalized = { ...base, ...source };
    const updateTime = Number(source.UpdateTime || 0) || 0;
    const hasResourceData = !!source.resources;
    normalized.pages = Number(normalized.pages) || 0;
    normalized.workers = Number(normalized.workers) || 0;
    normalized.total = Number(normalized.total) || normalized.pages + normalized.workers;
    normalized.max = Number(normalized.max) || 免费额度.requestsDaily;
    normalized.UpdateTime = updateTime;
    normalized.resources = 合并资源统计(hasResourceData ? 创建默认资源统计() : 创建汇总资源统计(), normalized.resources || {});
    return normalized;
}

function 累加资源统计(target, source) {
    const data = 合并资源统计(创建默认资源统计(), source || {});

    target.d1.rowsRead += data.d1.rowsRead || 0;
    target.d1.rowsReadLimit += data.d1.rowsReadLimit || 免费额度.d1RowsReadDaily;
    target.d1.rowsWritten += data.d1.rowsWritten || 0;
    target.d1.rowsWrittenLimit += data.d1.rowsWrittenLimit || 免费额度.d1RowsWrittenDaily;
    target.d1.readQueries += data.d1.readQueries || 0;
    target.d1.writeQueries += data.d1.writeQueries || 0;
    target.d1.storageBytes += data.d1.storageBytes || 0;
    target.d1.storageLimitBytes += data.d1.storageLimitBytes || 免费额度.d1StorageBytes;
    target.d1.databases += data.d1.databases || 0;

    target.kv.reads += data.kv.reads || 0;
    target.kv.readsLimit += data.kv.readsLimit || 免费额度.kvReadsDaily;
    target.kv.writes += data.kv.writes || 0;
    target.kv.writesLimit += data.kv.writesLimit || 免费额度.kvWritesDaily;
    target.kv.deletes += data.kv.deletes || 0;
    target.kv.deletesLimit += data.kv.deletesLimit || 免费额度.kvDeletesDaily;
    target.kv.lists += data.kv.lists || 0;
    target.kv.listsLimit += data.kv.listsLimit || 免费额度.kvListsDaily;
    target.kv.operations += data.kv.operations || 0;
    target.kv.storageBytes += data.kv.storageBytes || 0;
    target.kv.storageLimitBytes += data.kv.storageLimitBytes || 免费额度.kvStorageBytes;
    target.kv.keys += data.kv.keys || 0;
    target.kv.namespaces += data.kv.namespaces || 0;

    target.r2.classA += data.r2.classA || 0;
    target.r2.classALimit += data.r2.classALimit || 免费额度.r2ClassAMonthly;
    target.r2.classB += data.r2.classB || 0;
    target.r2.classBLimit += data.r2.classBLimit || 免费额度.r2ClassBMonthly;
    target.r2.free += data.r2.free || 0;
    target.r2.other += data.r2.other || 0;
    target.r2.operations += data.r2.operations || 0;
    target.r2.storageBytes += data.r2.storageBytes || 0;
    target.r2.storageLimitBytes += data.r2.storageLimitBytes || 免费额度.r2StorageBytes;
    target.r2.objects += data.r2.objects || 0;
    target.r2.buckets += data.r2.buckets || 0;
}

// 趋势窗口起点：北京时区（UTC+8）当天 08:00，未到 08:00 则取前一天 08:00
function 获取趋势窗口起点() {
    const BJ = 8 * 60 * 60 * 1000;
    const nowMs = Date.now();
    const d = new Date(nowMs + BJ);
    let start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 8) - BJ;
    if (d.getUTCHours() < 8) start -= 24 * 60 * 60 * 1000;
    return new Date(start);
}

function 获取统计时间窗口() {
    const now = new Date();
    const dayStart = new Date(now);
    dayStart.setUTCHours(0, 0, 0, 0);
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const trendStart = 获取趋势窗口起点();

    return {
        nowIso: now.toISOString(),
        trendStartIso: trendStart.toISOString(),
        dayStartIso: dayStart.toISOString(),
        monthStartIso: monthStart.toISOString(),
        dayStartDate: dayStart.toISOString().slice(0, 10),
        monthStartDate: monthStart.toISOString().slice(0, 10),
        dateEnd: now.toISOString().slice(0, 10)
    };
}

function 获取单账号查询间隔毫秒(env = {}) {
    const ms = Number(env.ACCOUNT_CHECK_INTERVAL_MS || env.account_check_interval_ms);
    if (Number.isFinite(ms) && ms > 0) return ms;

    const minutes = Number(env.ACCOUNT_CHECK_INTERVAL_MINUTES || env.account_check_interval_minutes || env.CHECK_INTERVAL_MINUTES || env.check_interval_minutes);
    if (Number.isFinite(minutes) && minutes > 0) return minutes * 60 * 1000;

    return 默认单账号查询间隔毫秒;
}

function 获取每轮最多外部子请求数(env = {}) {
    const configured = Number(env.MAX_EXTERNAL_SUBREQUESTS_PER_RUN || env.max_external_subrequests_per_run);
    if (Number.isFinite(configured) && configured > 0) return Math.min(Math.max(1, Math.floor(configured)), 默认每轮最多外部子请求数);
    return 默认每轮最多外部子请求数;
}

function 估算账号查询外部子请求数(account = {}) {
    if (account.AccountID) return 5;
    if (account.Email && account.GlobalAPIKey) return 6;
    return 6;
}

function 获取账号最后更新时间(account) {
    return Number(account?.UpdateTime || account?.Usage?.UpdateTime || 0) || 0;
}

// 序列化账号配置：顺手剔除旧版本遗留的 Plan 字段（套餐功能已移除）
function 序列化账号配置(列表) {
    const 干净 = (列表 || []).map(a => {
        const 副本 = { ...a };
        delete 副本.Plan;
        return 副本;
    });
    return JSON.stringify(干净);
}

function 补全账号Usage结构(account) {
    const usage = 补全Usage结构(account?.Usage || {});
    delete usage.UpdateTime;
    return usage;
}

function 写入账号查询结果(account, usage, queryTime = Date.now()) {
    const normalized = 补全Usage结构(usage || {});
    normalized.UpdateTime = queryTime;
    account.Usage = 补全账号Usage结构({ ...account, Usage: normalized });
    account.UpdateTime = queryTime;
    account.LastCheckTime = queryTime;
    delete account.LastCheckError;
    delete account.LastCheckErrorTime;
    return normalized;
}

function 写入账号查询失败(account, error, queryTime = Date.now()) {
    const lastUpdateTime = 获取账号最后更新时间(account);
    if (lastUpdateTime && !account.UpdateTime) account.UpdateTime = lastUpdateTime;
    account.LastCheckTime = queryTime;
    account.LastCheckErrorTime = queryTime;
    account.LastCheckError = typeof error === 'string' ? error : (error?.msg || error?.message || '查询失败');
    account.Usage = 补全账号Usage结构(account);
    return account.Usage;
}

async function 更新请求数(env, options = {}) {
    let usage_config_json = await env.KV.get('usage_config.json', { type: 'json' });
    let usage_json = 创建默认Usage(false);

    if (!usage_config_json) {
        // 不存在则创建一个空的配置文件
        usage_config_json = [];
        await env.KV.put('usage_config.json', 序列化账号配置(usage_config_json));
        usage_json.success = true;
        usage_json.resources = 创建汇总资源统计();
        usage_json.msg = '⚠️ 尚未添加任何Cloudflare账号';
        await env.KV.put('usage.json', JSON.stringify(usage_json));
    } else if (Array.isArray(usage_config_json) && usage_config_json.length > 0) {
        const thresholdMs = Number(options.thresholdMs) || 获取单账号查询间隔毫秒(env);
        const externalSubrequestLimit = 获取每轮最多外部子请求数(env);
        const now = Date.now();

        const accountStates = usage_config_json.map((account, index) => {
            const lastUpdateTime = 获取账号最后更新时间(account);
            account.Usage = 补全账号Usage结构(account);
            if (lastUpdateTime && !account.UpdateTime) account.UpdateTime = lastUpdateTime;
            if (lastUpdateTime && !account.LastCheckTime) account.LastCheckTime = lastUpdateTime;
            return { account, index, lastUpdateTime };
        });

        const expiredAccounts = accountStates
            .filter(item => options.force || !item.lastUpdateTime || now - item.lastUpdateTime > thresholdMs)
            .sort((a, b) => (a.lastUpdateTime || 0) - (b.lastUpdateTime || 0));
        const accountsToRefresh = [];
        let estimatedExternalSubrequests = 0;
        for (const item of expiredAccounts) {
            const accountSubrequests = 估算账号查询外部子请求数(item.account);
            if (estimatedExternalSubrequests + accountSubrequests > externalSubrequestLimit) continue;
            accountsToRefresh.push({ ...item, estimatedExternalSubrequests: accountSubrequests });
            estimatedExternalSubrequests += accountSubrequests;
        }

        let refreshedCount = 0;
        let failedRefreshCount = 0;

        await Promise.all(accountsToRefresh.map(async ({ account }) => {
            try {
                const usage = await getCloudflareUsage(account.Email, account.GlobalAPIKey, account.AccountID, account.APIToken);
                if (!usage.success) {
                    写入账号查询失败(account, usage, Date.now());
                    failedRefreshCount += 1;
                    return;
                }
                写入账号查询结果(account, usage, Date.now());
                refreshedCount += 1;
            } catch (error) {
                failedRefreshCount += 1;
                console.error(`账号 ${account.ID} 查询失败:`, error.message);
                写入账号查询失败(account, error, Date.now());
            }
        }));

        // 累加所有账号的使用数据，未达到刷新阈值或超过本轮上限的账号使用历史数据。
        let total_pages = 0;
        let total_workers = 0;
        let total_max = 0;
        const total_resources = 创建汇总资源统计();
        const total_trend = new Map();

        for (const account of usage_config_json) {
            const usage = 补全账号Usage结构(account);
            account.Usage = usage;
            if (usage.success) {
                total_pages += usage.pages || 0;
                total_workers += usage.workers || 0;
                total_max += usage.max || 免费额度.requestsDaily;
                累加资源统计(total_resources, usage.resources);
                for (const point of usage.trend || []) {
                    const t = Number(point?.t) || 0;
                    if (!t) continue;
                    total_trend.set(t, (total_trend.get(t) || 0) + (Number(point?.v) || 0));
                }
            }
        }

        // 遍历完成后保存 usage_config_json 回 KV
        await env.KV.put('usage_config.json', 序列化账号配置(usage_config_json));

        // 将所有账号的数据累加到 usage_json 中并保存回 KV
        usage_json.success = true;
        usage_json.pages = total_pages;
        usage_json.workers = total_workers;
        usage_json.total = total_pages + total_workers;
        usage_json.max = total_max;
        usage_json.resources = total_resources;
        usage_json.trend = Array.from(total_trend.entries())
            .sort((a, b) => a[0] - b[0])
            .map(([t, v]) => ({ t, v }));
        usage_json.UpdateTime = Date.now();
        usage_json.RefreshStats = {
            refreshed: refreshedCount,
            failed: failedRefreshCount,
            cached: Math.max(usage_config_json.length - refreshedCount, 0),
            skippedByLimit: Math.max(expiredAccounts.length - accountsToRefresh.length, 0),
            maxRefresh: accountsToRefresh.length,
            externalSubrequestsEstimated: estimatedExternalSubrequests,
            externalSubrequestLimit,
            perAccountExternalSubrequests: { withAccountId: 4, withoutAccountId: 5 },
            thresholdMs
        };
        usage_json.msg = failedRefreshCount > 0
            ? `⚠️ 部分账号查询失败（本次刷新 ${refreshedCount} 个账号，失败 ${failedRefreshCount} 个，${usage_json.RefreshStats.cached} 个使用历史数据）`
            : `✅ 成功更新免费额度使用数据（本次刷新 ${refreshedCount} 个账号，${usage_json.RefreshStats.cached} 个使用历史数据）`;
        await env.KV.put('usage.json', JSON.stringify(usage_json));
    } else {
        // 配置文件存在但为空数组或无效格式
        usage_json.success = true;
        usage_json.resources = 创建汇总资源统计();
        usage_json.UpdateTime = Date.now();
        usage_json.msg = '⚠️ 尚未添加任何Cloudflare账号';
        await env.KV.put('usage.json', JSON.stringify(usage_json));
    }

    return usage_json;
}

async function MD5MD5(文本) {
    const 编码器 = new TextEncoder();

    const 第一次哈希 = await crypto.subtle.digest('MD5', 编码器.encode(文本));
    const 第一次哈希数组 = Array.from(new Uint8Array(第一次哈希));
    const 第一次十六进制 = 第一次哈希数组.map(字节 => 字节.toString(16).padStart(2, '0')).join('');

    const 第二次哈希 = await crypto.subtle.digest('MD5', 编码器.encode(第一次十六进制.slice(7, 27)));
    const 第二次哈希数组 = Array.from(new Uint8Array(第二次哈希));
    const 第二次十六进制 = 第二次哈希数组.map(字节 => 字节.toString(16).padStart(2, '0')).join('');

    return 第二次十六进制.toLowerCase();
}

function 数字(value) {
    return Number(value) || 0;
}

function 合计请求数(groups) {
    return groups?.reduce((total, item) => total + 数字(item?.sum?.requests), 0) || 0;
}

function 规范化动作名称(action) {
    return String(action || '').replace(/[^a-z0-9]/gi, '').toLowerCase();
}

function 选择最新分组(groups, idField, timeField) {
    const latest = new Map();
    for (const group of groups || []) {
        const dimensions = group?.dimensions || {};
        const id = dimensions[idField] || '__account';
        const time = String(dimensions[timeField] || '');
        const current = latest.get(id);
        if (!current || time >= current.time) latest.set(id, { time, group });
    }
    return Array.from(latest.values()).map(item => item.group);
}

async function 发送GraphQL请求(API, headers, query, variables) {
    const res = await fetch(`${API}/graphql`, {
        method: "POST",
        headers,
        body: JSON.stringify({ query, variables })
    });

    if (!res.ok) throw new Error(`查询失败: ${res.status}`);
    const result = await res.json();
    if (result.errors?.length) throw new Error(result.errors.map(error => error.message).join('; '));

    const account = result?.data?.viewer?.accounts?.[0];
    if (!account) throw new Error("未找到账户数据");
    return account;
}

async function 获取Cloudflare账户ID(API, headers, Email) {
    const r = await fetch(`${API}/accounts`, { method: "GET", headers });
    if (!r.ok) throw new Error(`账户获取失败: ${r.status}`);
    const d = await r.json();
    if (!d?.result?.length) throw new Error("未找到账户");
    const idx = d.result.findIndex(account => account.name?.toLowerCase().startsWith(Email.toLowerCase()));
    return d.result[idx >= 0 ? idx : 0]?.id;
}

async function 查询WorkersPages统计(API, headers, AccountID, 时间窗口) {
    const account = await 发送GraphQL请求(API, headers, `query getBillingMetrics($AccountID: String!, $filter: AccountWorkersInvocationsAdaptiveFilter_InputObject) {
        viewer { accounts(filter: {accountTag: $AccountID}) {
            pagesFunctionsInvocationsAdaptiveGroups(limit: 1000, filter: $filter) { sum { requests } }
            workersInvocationsAdaptive(limit: 10000, filter: $filter) { sum { requests } }
        } }
    }`, {
        AccountID,
        filter: { datetime_geq: 时间窗口.dayStartIso, datetime_leq: 时间窗口.nowIso }
    });

    return {
        pages: 合计请求数(account.pagesFunctionsInvocationsAdaptiveGroups),
        workers: 合计请求数(account.workersInvocationsAdaptive)
    };
}

// 近 24 小时按 UTC 小时分桶的请求量（Workers + Pages 合并），用于趋势图
async function 查询请求趋势(API, headers, AccountID, 时间窗口) {
    const account = await 发送GraphQL请求(API, headers, `query getRequestTrend($AccountID: String!, $filter: AccountWorkersInvocationsAdaptiveFilter_InputObject) {
        viewer { accounts(filter: {accountTag: $AccountID}) {
            workersInvocationsAdaptive(limit: 10000, filter: $filter) {
                dimensions { datetimeHour }
                sum { requests }
            }
            pagesFunctionsInvocationsAdaptiveGroups(limit: 10000, filter: $filter) {
                dimensions { datetimeHour }
                sum { requests }
            }
        } }
    }`, {
        AccountID,
        filter: { datetime_geq: 时间窗口.trendStartIso, datetime_leq: 时间窗口.nowIso }
    });

    const 桶 = new Map();
    const 累加 = (groups) => {
        for (const group of groups || []) {
            const hour = group?.dimensions?.datetimeHour;
            if (!hour) continue;
            const t = Date.parse(hour);
            if (!Number.isFinite(t)) continue;
            桶.set(t, (桶.get(t) || 0) + 数字(group?.sum?.requests));
        }
    };
    累加(account.workersInvocationsAdaptive);
    累加(account.pagesFunctionsInvocationsAdaptiveGroups);

    return Array.from(桶.entries())
        .sort((a, b) => a[0] - b[0])
        .map(([t, v]) => ({ t, v }));
}

async function 查询D1统计(API, headers, AccountID, 时间窗口) {
    const d1 = 创建默认资源统计().d1;
    const account = await 发送GraphQL请求(API, headers, `query D1Usage($accountTag: String!, $dayStart: Date!, $dateEnd: Date!, $storageStart: Date!) {
        viewer { accounts(filter: {accountTag: $accountTag}) {
            d1AnalyticsAdaptiveGroups(limit: 10000, filter: {date_geq: $dayStart, date_leq: $dateEnd}) {
                sum { rowsRead rowsWritten readQueries writeQueries }
                dimensions { date databaseId }
            }
            d1StorageAdaptiveGroups(limit: 10000, filter: {date_geq: $storageStart, date_leq: $dateEnd}, orderBy: [date_DESC]) {
                max { databaseSizeBytes }
                dimensions { date databaseId }
            }
        } }
    }`, {
        accountTag: AccountID,
        dayStart: 时间窗口.dayStartDate,
        dateEnd: 时间窗口.dateEnd,
        storageStart: 时间窗口.monthStartDate
    });

    for (const group of account.d1AnalyticsAdaptiveGroups || []) {
        d1.rowsRead += 数字(group?.sum?.rowsRead);
        d1.rowsWritten += 数字(group?.sum?.rowsWritten);
        d1.readQueries += 数字(group?.sum?.readQueries);
        d1.writeQueries += 数字(group?.sum?.writeQueries);
    }

    const storageGroups = 选择最新分组(account.d1StorageAdaptiveGroups, 'databaseId', 'date');
    d1.databases = storageGroups.length;
    d1.storageBytes = storageGroups.reduce((total, group) => total + 数字(group?.max?.databaseSizeBytes), 0);
    return d1;
}

async function 查询KV统计(API, headers, AccountID, 时间窗口) {
    const kv = 创建默认资源统计().kv;
    const account = await 发送GraphQL请求(API, headers, `query KvUsage($accountTag: String!, $dayStart: Date!, $dateEnd: Date!, $storageStart: Date!) {
        viewer { accounts(filter: {accountTag: $accountTag}) {
            kvOperationsAdaptiveGroups(limit: 10000, filter: {date_geq: $dayStart, date_leq: $dateEnd}) {
                sum { requests }
                dimensions { actionType }
            }
            kvStorageAdaptiveGroups(limit: 10000, filter: {date_geq: $storageStart, date_leq: $dateEnd}, orderBy: [date_DESC]) {
                max { keyCount byteCount }
                dimensions { date namespaceId }
            }
        } }
    }`, {
        accountTag: AccountID,
        dayStart: 时间窗口.dayStartDate,
        dateEnd: 时间窗口.dateEnd,
        storageStart: 时间窗口.monthStartDate
    });

    for (const group of account.kvOperationsAdaptiveGroups || []) {
        const requests = 数字(group?.sum?.requests);
        const actionType = String(group?.dimensions?.actionType || '').toLowerCase();
        kv.operations += requests;

        if (actionType.includes('read')) kv.reads += requests;
        else if (actionType.includes('write')) kv.writes += requests;
        else if (actionType.includes('delete')) kv.deletes += requests;
        else if (actionType.includes('list')) kv.lists += requests;
    }

    const storageGroups = 选择最新分组(account.kvStorageAdaptiveGroups, 'namespaceId', 'date');
    kv.namespaces = storageGroups.length;
    kv.keys = storageGroups.reduce((total, group) => total + 数字(group?.max?.keyCount), 0);
    kv.storageBytes = storageGroups.reduce((total, group) => total + 数字(group?.max?.byteCount), 0);
    return kv;
}

async function 查询R2统计(API, headers, AccountID, 时间窗口) {
    const r2 = 创建默认资源统计().r2;
    const account = await 发送GraphQL请求(API, headers, `query R2Usage($accountTag: String!, $monthStart: Time!, $now: Time!) {
        viewer { accounts(filter: {accountTag: $accountTag}) {
            r2OperationsAdaptiveGroups(limit: 10000, filter: {datetime_geq: $monthStart, datetime_leq: $now}) {
                sum { requests }
                dimensions { actionType actionStatus }
            }
            r2StorageAdaptiveGroups(limit: 10000, filter: {datetime_geq: $monthStart, datetime_leq: $now}, orderBy: [datetime_DESC]) {
                max { objectCount uploadCount payloadSize metadataSize }
                dimensions { datetime bucketName }
            }
        } }
    }`, {
        accountTag: AccountID,
        monthStart: 时间窗口.monthStartIso,
        now: 时间窗口.nowIso
    });

    for (const group of account.r2OperationsAdaptiveGroups || []) {
        const status = String(group?.dimensions?.actionStatus || 'success').toLowerCase();
        if (status && status !== 'success') continue;

        const requests = 数字(group?.sum?.requests);
        const action = 规范化动作名称(group?.dimensions?.actionType);
        r2.operations += requests;

        if (R2_CLASS_A_ACTIONS.has(action)) r2.classA += requests;
        else if (R2_CLASS_B_ACTIONS.has(action)) r2.classB += requests;
        else if (R2_FREE_ACTIONS.has(action)) r2.free += requests;
        else r2.other += requests;
    }

    const storageGroups = 选择最新分组(account.r2StorageAdaptiveGroups, 'bucketName', 'datetime');
    r2.buckets = storageGroups.length;
    r2.objects = storageGroups.reduce((total, group) => total + 数字(group?.max?.objectCount), 0);
    r2.storageBytes = storageGroups.reduce((total, group) => total + 数字(group?.max?.payloadSize) + 数字(group?.max?.metadataSize), 0);
    return r2;
}

async function getCloudflareUsage(Email, GlobalAPIKey, AccountID, APIToken) {
    const API = "https://api.cloudflare.com/client/v4";
    const cfg = { "Content-Type": "application/json" };
    const fallback = 创建默认Usage(false);

    try {
        if (!AccountID && (!Email || !GlobalAPIKey)) return fallback;

        const hdr = APIToken ? { ...cfg, "Authorization": `Bearer ${APIToken}` } : { ...cfg, "X-AUTH-EMAIL": Email, "X-AUTH-KEY": GlobalAPIKey };
        if (!AccountID) AccountID = await 获取Cloudflare账户ID(API, hdr, Email);

        const 时间窗口 = 获取统计时间窗口();
        const usage = 创建默认Usage(true, '✅ 成功更新免费额度使用数据');
        const core = await 查询WorkersPages统计(API, hdr, AccountID, 时间窗口);

        usage.pages = core.pages;
        usage.workers = core.workers;
        usage.total = core.pages + core.workers;
        usage.max = 免费额度.requestsDaily;

        const errors = [];
        const safeQuery = async (label, query, defaultValue) => {
            try {
                return await query();
            } catch (error) {
                console.warn(`${label} 统计失败:`, error.message);
                errors.push(`${label}: ${error.message}`);
                return defaultValue;
            }
        };

        const [d1, kv, r2, trend] = await Promise.all([
            safeQuery('D1', () => 查询D1统计(API, hdr, AccountID, 时间窗口), 创建默认资源统计().d1),
            safeQuery('KV', () => 查询KV统计(API, hdr, AccountID, 时间窗口), 创建默认资源统计().kv),
            safeQuery('R2', () => 查询R2统计(API, hdr, AccountID, 时间窗口), 创建默认资源统计().r2),
            safeQuery('趋势', () => 查询请求趋势(API, hdr, AccountID, 时间窗口), [])
        ]);

        usage.resources.d1 = d1;
        usage.resources.kv = kv;
        usage.resources.r2 = r2;
        usage.trend = trend;
        if (errors.length) usage.errors = errors;

        console.log(`统计结果 - Pages: ${usage.pages}, Workers: ${usage.workers}, D1读: ${d1.rowsRead}, KV读: ${kv.reads}, R2 A/B: ${r2.classA}/${r2.classB}`);
        return usage;

    } catch (error) {
        console.error('获取使用量错误:', error.message);
        fallback.msg = '❌ 获取使用量失败: ' + error.message;
        return fallback;
    }
}

function 掩码敏感信息(文本, 前缀长度 = 3, 后缀长度 = 2) {
    if (!文本 || typeof 文本 !== 'string') return 文本;
    if (文本.length <= 前缀长度 + 后缀长度) return 文本; // 如果长度太短，直接返回

    const 前缀 = 文本.slice(0, 前缀长度);
    const 后缀 = 文本.slice(-后缀长度);
    const 星号数量 = 文本.length - 前缀长度 - 后缀长度;

    return `${前缀}${'*'.repeat(星号数量)}${后缀}`;
}

////////////////////////////////HTML页面//////////////////////////////////

async function UsagePanel登录页() {
    return new Response('未构建：请先运行 node build.js', { status: 500, headers: { 'Content-Type': 'text/plain; charset=UTF-8' } })
}

async function UsagePanel管理面板() {
    return new Response('未构建：请先运行 node build.js', { status: 500, headers: { 'Content-Type': 'text/plain; charset=UTF-8' } })
}

async function UsagePanel主页() {
    return new Response('未构建：请先运行 node build.js', { status: 500, headers: { 'Content-Type': 'text/plain; charset=UTF-8' } })
}
