const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '..', '南京晓庄2026学生手册正式考试助手.user.js'), 'utf8');
const context = vm.createContext({URL, setTimeout, clearTimeout});
vm.runInContext(source.split('// __TEST_EXPORT_POINT__')[0] + `
  globalThis.api = {PROFILE_KEY, PROFILE_DRAFT_KEY, saveProfile, loadProfile,
    saveProfileDraft, loadProfileDraft, fillBasicInformation, START_REQUEST_KEY, consumeStartRequest};})();`, context);
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

test('only an explicit matching start request allows one automatic run after refresh', () => {
  const store = storage();
  const profile = {name:'姓名', studentId:'26000001', college:'学院'};
  assert.equal(api.consumeStartRequest(profile,store),false);
  store.setItem(api.START_REQUEST_KEY,JSON.stringify(profile));
  assert.equal(api.consumeStartRequest(profile,store),true);
  assert.equal(api.consumeStartRequest(profile,store),false);
  store.setItem(api.START_REQUEST_KEY,JSON.stringify(profile));
  assert.equal(api.consumeStartRequest({...profile,studentId:'26000002'},store),false);
  assert.equal(store.getItem(api.START_REQUEST_KEY),null);
  store.setItem(api.START_REQUEST_KEY,JSON.stringify({...profile,studentId:'bad'}));
  assert.equal(api.consumeStartRequest({...profile,studentId:'bad'},store),false);
  assert.equal(api.consumeStartRequest(profile,{getItem(){throw Error('blocked');}}),false);
});
