const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '..', '南京晓庄2026学生手册正式考试助手.user.js'), 'utf8');
const context = vm.createContext({URL, setTimeout, clearTimeout});
vm.runInContext(source.split('// __TEST_EXPORT_POINT__')[0] +
  'globalThis.api={clearSiteData,BANK_CACHE_KEY};})();', context);
const {clearSiteData, BANK_CACHE_KEY} = context.api;

function fixture() {
  const calls = [];
  const cookies = new Map([['page-cookie','value'],['root-cookie','value']]);
  const local = new Map([['profile','value'],['website-data','value']]);
  const session = new Map([['start-request','value']]);
  const caches = new Map([['offline','value']]);
  const databases = new Map([['old-database',{}]]);
  const script = new Map([[BANK_CACHE_KEY,{}],['unrelated-key','preserved']]);
  const env = {
    location:new URL('https://ks.wjx.com/vm/YDD4gnE.aspx'),
    document:{
      get cookie() { return [...cookies].map(([name,value]) => `${name}=${value}`).join('; '); },
      set cookie(value) { calls.push(value); cookies.delete(value.split('=')[0]); }
    },
    localStorage:{clear() { local.clear(); }},
    sessionStorage:{clear() { session.clear(); }},
    navigator:{serviceWorker:{async getRegistrations() {
      return [{async unregister() { calls.push('unregister'); return true; }}];
    }}},
    caches:{async keys() { return [...caches.keys()]; }, async delete(key) { return caches.delete(key); }},
    indexedDB:{
      async databases() { return [...databases.keys()].map(name => ({name})); },
      deleteDatabase(name) {
        const request = {};
        setTimeout(() => { databases.delete(name); request.onsuccess(); },0);
        return request;
      }
    }
  };
  return {env,calls,cookies,local,session,caches,databases,script,deleteBank:key => script.delete(key)};
}

test('clear removes accessible site data and only the script bank key, with matching cookie paths and domains', async () => {
  const data = fixture();
  const report = await clearSiteData(data.env,data.deleteBank);
  assert.equal(report.failed.length,0);
  assert.equal(report.unavailable.length,0);
  assert.equal(report.cleared.length,7);
  for (const map of [data.cookies,data.local,data.session,data.caches,data.databases]) assert.equal(map.size,0);
  assert.equal(data.script.has(BANK_CACHE_KEY),false);
  assert.equal(data.script.get('unrelated-key'),'preserved');
  assert(data.calls.includes('unregister'));
  assert(data.calls.some(value => value.includes('Path=/vm;') && value.includes('Domain=wjx.com')));
  assert(data.calls.some(value => value.includes('Path=/;') && !value.includes('Domain=')));
  assert(data.calls.some(value => value.includes('; Partitioned')));
});

test('blocked databases, denied storage and cache errors do not prevent the other cleanup steps', async () => {
  const data = fixture();
  data.env.indexedDB.deleteDatabase = () => {
    const request = {};
    setTimeout(() => request.onblocked(),0);
    return request;
  };
  data.env.caches.keys = async () => { throw Error('denied'); };
  data.env.localStorage.clear = () => { throw Error('denied'); };
  const report = await clearSiteData(data.env,data.deleteBank);
  assert.deepEqual([...report.failed],['离线缓存','站点数据库','网站本地信息']);
  assert.equal(data.cookies.size,0);
  assert.equal(data.session.size,0);
  assert.equal(data.script.has(BANK_CACHE_KEY),false);
});

test('unsupported APIs and script cache permission errors are reported instead of claiming complete removal', async () => {
  const data = fixture();
  data.env.navigator = {};
  delete data.env.caches;
  delete data.env.indexedDB;
  const report = await clearSiteData(data.env,() => { throw Error('missing grant'); });
  assert.deepEqual([...report.failed],['脚本题库缓存']);
  assert.deepEqual([...report.unavailable],['离线服务','离线缓存','站点数据库']);
  assert.equal(data.local.size,0);
  assert.equal(data.session.size,0);
});

test('cookies that could not be removed are reported while remaining site storage is still cleared', async () => {
  const data = fixture();
  Object.defineProperty(data.env.document,'cookie',{get:() => 'persistent=value',set() {}});
  const report = await clearSiteData(data.env,data.deleteBank);
  assert.deepEqual([...report.failed],['网站 Cookie']);
  assert.equal(data.local.size,0);
  assert.equal(data.session.size,0);
});

test('a cleanup API that never responds times out and allows the remaining cleanup steps to finish', async () => {
  const timedContext = vm.createContext({URL, clearTimeout, setTimeout:(callback,ms) => setTimeout(callback,Math.min(ms,20))});
  vm.runInContext(source.split('// __TEST_EXPORT_POINT__')[0] +
    'globalThis.clearSiteData=clearSiteData;})();', timedContext);
  const data = fixture();
  const report = await timedContext.clearSiteData(data.env,() => new Promise(() => {}));
  assert.deepEqual([...report.failed],['脚本题库缓存']);
  assert.equal(data.local.size,0);
  assert.equal(data.session.size,0);
  assert.equal(data.cookies.size,0);
});
