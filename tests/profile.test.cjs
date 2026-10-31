const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '..', '南京晓庄2026学生手册正式考试助手.user.js'), 'utf8');
const context = vm.createContext({URL, setTimeout, clearTimeout});
vm.runInContext(source.split('// __TEST_EXPORT_POINT__')[0] + `
  globalThis.api = {PROFILE_KEY, PROFILE_DRAFT_KEY, saveProfile, loadProfile,
    saveProfileDraft, loadProfileDraft, isProfileReady, fillBasicInformation, START_REQUEST_KEY, consumeStartRequest,
    RUN_SETTINGS_KEY, parseSubmitSeconds, loadRunSettings, saveRunSettings};})();`, context);
const api = context.api;
const plain = value => JSON.parse(JSON.stringify(value));
function storage() {
  const values = new Map();
  return {getItem:key => values.get(key) ?? null, setItem:(key,value) => values.set(key,value), removeItem:key => values.delete(key)};
}

test('temporary drafts accept empty or incomplete values and survive reopening without replacing the active profile', () => {
  const store = storage();
  api.saveProfile('已保存姓名', '26000001', '测试学院', store);
  for (const draft of [
    {name:'',studentId:'',college:''},
    {name:'临时姓名',studentId:'12x',college:''},
    {name:'',studentId:'26000002',college:'测试学院'}
  ]) {
    api.saveProfileDraft(draft.name,draft.studentId,draft.college,store);
    assert.deepEqual(plain(api.loadProfileDraft(store)),draft);
    assert.equal(api.loadProfile(store).studentId,'26000001');
  }
});

test('starting accepts only eight ASCII digits, including leading zeroes, before writing a profile', () => {
  const store = storage();
  api.saveProfile('姓名','01234567','学院',store);
  const saved = store.getItem(api.PROFILE_KEY);
  for (const id of ['1234567','123456789','1234abcd','１２３４５６７８','1234 678','1234567\n8']) {
    assert.throws(()=>api.saveProfile('姓名',id,'学院',store),/学号必须为8位数字/);
    assert.equal(store.getItem(api.PROFILE_KEY),saved);
  }
  assert.equal(api.saveProfile(' 姓名 ',' 26000001 ',' 学院 ',store).studentId,'26000001');
  assert.throws(()=>api.saveProfile('','26000001','学院',store),/姓名和学号/);
  assert.throws(()=>api.saveProfile('姓名','26000001','',store),/选择学院/);
});

test('combined save-and-start requires complete valid current fields and an available college', () => {
  const profile = {name:'姓名', studentId:'01234567', college:'学院'};
  const colleges = ['学院'];
  assert.equal(api.isProfileReady(profile,colleges),true);
  assert.equal(api.isProfileReady(null,colleges),false);
  for (const current of [
    {name:'',studentId:'',college:''}, {...profile,name:' '}, {...profile,college:''},
    {...profile,studentId:'1234567'}, {...profile,studentId:'123456789'},
    {...profile,studentId:'１２３４５６７８'}, {...profile,studentId:'1234x678'}
  ]) assert.equal(api.isProfileReady(current,colleges),false);
  assert.equal(api.isProfileReady(profile,[]),false);
  assert.equal(api.isProfileReady(profile,['其他学院']),false);
});

test('invalid student IDs cannot reach page controls, including from old saved profiles', () => {
  const root = {querySelectorAll(){throw Error('page controls should not be accessed');}};
  for (const id of ['1234567','12345678x','ABCDEFGH']) {
    assert.throws(()=>api.fillBasicInformation({name:'姓名',studentId:id,college:'学院'},root),/学号必须为8位数字/);
  }
});

test('unreadable or malformed drafts are ignored and draft storage failure is reported', () => {
  assert.equal(api.loadProfileDraft({getItem(){throw Error('blocked');}}),null);
  assert.equal(api.loadProfileDraft({getItem(){return '{invalid';}}),null);
  assert.equal(api.loadProfileDraft({getItem(){return '{"name":"only name"}';}}),null);
  assert.throws(()=>api.saveProfileDraft('','','',{setItem(){throw Error('blocked');}}),/blocked/);
});

test('race seconds must be safe whole seconds of at least two; corrupted settings default to standard', () => {
  const store = storage();
  assert.deepEqual(plain(api.loadRunSettings(store)),{mode:'standard',submitSeconds:2});
  for (const seconds of [2,3,10,' 5 ']) assert.equal(api.parseSubmitSeconds(seconds),Number(seconds));
  for (const seconds of ['',1,0,-2,1.9,'abc',NaN,Infinity,Number.MAX_SAFE_INTEGER]) {
    assert.throws(()=>api.parseSubmitSeconds(seconds),/不低于2/);
  }
  api.saveRunSettings('race',5,store);
  assert.deepEqual(plain(api.loadRunSettings(store)),{mode:'race',submitSeconds:5});
  const previous=store.getItem(api.RUN_SETTINGS_KEY);
  assert.throws(()=>api.saveRunSettings('race',1,store));
  assert.equal(store.getItem(api.RUN_SETTINGS_KEY),previous);
  store.setItem(api.RUN_SETTINGS_KEY,'{invalid');
  assert.deepEqual(plain(api.loadRunSettings(store)),{mode:'standard',submitSeconds:2});
  store.setItem(api.RUN_SETTINGS_KEY,JSON.stringify({mode:'race',submitSeconds:1}));
  assert.equal(api.loadRunSettings(store).mode,'standard');
});

test('only a matching, recent, explicit race start allows one automatic run after refresh', () => {
  const store = storage();
  const profile = {name:'姓名', studentId:'26000001', college:'学院'};
  const settings = {mode:'race',submitSeconds:2};
  const now = Date.now();
  const request = {mode:'race',profile,submitSeconds:2,createdAt:now};
  const consume = (value,expectedProfile=profile,expectedSettings=settings) => {
    store.setItem(api.START_REQUEST_KEY,JSON.stringify(value));
    const result=api.consumeStartRequest(expectedProfile,expectedSettings,store,now);
    assert.equal(store.getItem(api.START_REQUEST_KEY),null);
    return result;
  };
  assert.equal(api.consumeStartRequest(profile,settings,store,now),false);
  assert.equal(consume(request),true);
  assert.equal(api.consumeStartRequest(profile,settings,store,now),false);
  assert.equal(consume({...request,createdAt:now-60001}),false);
  assert.equal(consume({...request,createdAt:now+1}),false);
  assert.equal(consume(request,{...profile,studentId:'26000002'}),false);
  assert.equal(consume(request,profile,{...settings,submitSeconds:3}),false);
  assert.equal(consume(request,profile,{...settings,mode:'standard'}),false);
  assert.equal(consume({...request,profile:{...profile,studentId:'bad'}}),false);
  assert.equal(consume(profile),false); // Legacy reload markers must never arm automatic submission.
  store.setItem(api.START_REQUEST_KEY,'{invalid');
  assert.equal(api.consumeStartRequest(profile,settings,store,now),false);
  assert.equal(store.getItem(api.START_REQUEST_KEY),null);
  assert.equal(api.consumeStartRequest(profile,settings,{getItem(){throw Error('blocked');}},now),false);
});
