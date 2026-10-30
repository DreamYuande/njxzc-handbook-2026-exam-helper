const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, '南京晓庄2026学生手册正式考试助手.user.js'), 'utf8');
const published = JSON.parse(fs.readFileSync(path.join(root, 'question-bank.json'), 'utf8'));
const clone = value => JSON.parse(JSON.stringify(value));
function fresh() {
  const context = vm.createContext({URL, setTimeout, clearTimeout});
  vm.runInContext(source.split('// __TEST_EXPORT_POINT__')[0] + `
    globalThis.api = {DEFAULT_BANK, BANK_CACHE_KEY, BANK_URL, validateBank, compareBankVersions,
      readBankCache, installBankUpdate, downloadBank, planQuestion, resolvePlan, ensureBankCoverage,
      current:()=>bankState.bank};})();`, context);
  return context.api;
}
const bundled=clone(fresh().DEFAULT_BANK);
function newer() {
  const bank = clone(bundled);
  const parts=bank.version.split('.');
  parts[3]=String(Number(parts[3])+1);
  bank.version=parts.join('.');
  bank.questions[0].answer = bank.questions[0].answer === 'A' ? 'B' : 'A';
  return bank;
}

test('hosted JSON validates, preserves coverage, and includes the competition award correction', () => {
  const api = fresh();
  assert.deepEqual(clone(api.validateBank(published)),published);
  api.ensureBankCoverage(published,bundled);
  assert(api.compareBankVersions(published.version,bundled.version)>=0);
  const question = published.questions.find(item=>item.id===244);
  assert.match(question.question,/学科竞赛奖/);
  assert.equal(question.answer,'ABCD');
  assert.deepEqual(clone(api.planQuestion(question.question,'4',question.options).indices),[0,1,2,3]);
});

test('temporary hardship subsidy maximum maps to 4000 yuan even with shuffled options', () => {
  const api=fresh();
  const question=published.questions.find(item=>item.id===51);
  assert.match(question.question,/临时困难补助的最高金额/);
  assert.equal(question.options[question.answer.charCodeAt(0)-65],'4000元');
  for(const options of [question.options,['4000元','2000元','3000元'],[...question.options].reverse()]) {
    const plan=api.planQuestion(question.question,question.type,options);
    assert.equal(plan.status,'ready');
    assert.deepEqual(Array.from(plan.indices,i=>options[i]),['4000元']);
  }
});

test('reviewed scholarship, discipline and withdrawal answers remain correct with reversed options', () => {
  const api=fresh();
  const expected=new Map([
    [116,'A'], [205,'C'], [51,'C'], [267,'AB'],
    [226,'BD'], [284,'ABCDE'], [287,'ABD'], [298,'ABCD']
  ]);
  for(const [id,answer] of expected) {
    const question=published.questions.find(item=>item.id===id);
    assert.equal(question.answer,answer,`bank item ${id}`);
    const options=[...question.options].reverse();
    const plan=api.planQuestion(question.question,question.type,options);
    assert.equal(plan.status,'ready',`bank item ${id}`);
    const texts=[...answer].map(c=>question.options[c.charCodeAt(0)-65]).sort();
    assert.deepEqual(Array.from(plan.indices,i=>options[i]).sort(),texts,`bank item ${id}`);
  }
});

test('all answered records map correctly across three option orders; unknown answers stay skipped', () => {
  const api = fresh();
  let answered=0, skipped=0;
  for(const item of bundled.questions) {
    for(const options of [item.options,[...item.options].reverse(),[...item.options.slice(1),item.options[0]]]) {
      const plan=api.resolvePlan(item.question,item.type,options);
      if(item.answer===null) {assert.equal(plan.status,'skip');skipped++;continue;}
      const expected=[...item.answer].map(c=>item.options[c.charCodeAt(0)-65]).sort();
      assert.equal(plan.status,'ready',`item ${item.id}`);
      assert.deepEqual(Array.from(plan.indices,i=>options[i]).sort(),expected);
      answered++;
    }
  }
  assert.equal(answered,bundled.questions.filter(item=>item.answer!==null).length*3);
  assert.equal(skipped,bundled.questions.filter(item=>item.answer===null).length*3);
});

test('malformed remote data cannot replace the active bank', () => {
  const mutations=[
    bank=>{bank.questions=[];},bank=>{bank.questions.pop();},bank=>{bank.schemaVersion=2;},bank=>{bank.dataset='other';},
    bank=>{bank.version='not-a-version';},bank=>{bank.questions[0].type='9';},
    bank=>{bank.questions[0].answer='Z';},bank=>{bank.questions[0].answer='AB';},
    bank=>{bank.questions[0].answer='AA';},bank=>{bank.questions[0].answer='';},
    bank=>{delete bank.questions[0].answer;},bank=>{bank.questions[0].options=['duplicate','duplicate'];},
    bank=>{bank.questions[0].options=['','second'];},bank=>{bank.questions.push(clone(bank.questions[0]));}
  ];
  for(const mutate of mutations) {
    const api=fresh(), before=JSON.stringify(api.current()), bank=newer();
    mutate(bank);
    assert.throws(()=>api.installBankUpdate(bank,()=>assert.fail('invalid data persisted')));
    assert.equal(JSON.stringify(api.current()),before);
  }
});

test('updates persist before activation; storage failure retains old answers and version', () => {
  const api=fresh(), old=JSON.stringify(api.current());
  assert.throws(()=>api.installBankUpdate(newer(),()=>{throw Error('storage unavailable');}),/storage/);
  assert.equal(JSON.stringify(api.current()),old);
  let saved;
  assert.equal(api.installBankUpdate(newer(),(key,value)=>{
    assert.equal(key,api.BANK_CACHE_KEY);
    assert.equal(JSON.stringify(api.current()),old);
    saved=clone(value);
  }),true);
  assert.deepEqual(saved,newer());
  const first=bundled.questions[0];
  assert.deepEqual(clone(api.planQuestion(first.question,first.type,first.options).indices),[newer().questions[0].answer.charCodeAt(0)-65]);
});

test('same-version changes and downgrades are rejected; identical versions do not write', () => {
  const api=fresh();
  assert.equal(api.installBankUpdate(bundled,()=>assert.fail('unexpected write')),false);
  const changed=clone(bundled);changed.questions[0].answer=newer().questions[0].answer;
  assert.throws(()=>api.installBankUpdate(changed,()=>{}),/版本号未更新/);
  assert.equal(api.compareBankVersions('2026.10.30.10','2026.10.30.2'),1);
  const old=clone(bundled);old.version='2000.01.01.0';
  assert.throws(()=>api.installBankUpdate(old,()=>{}),/较旧/);
});

test('startup uses validated newer cache and safely ignores missing, corrupt or older caches', () => {
  const api=fresh();
  assert.equal(api.readBankCache(()=>newer()).source,'本地缓存');
  assert.equal(api.readBankCache(()=>newer()).bank.version,newer().version);
  const old=clone(bundled);old.version='2000.01.01.0';
  const incomplete=newer();incomplete.questions.pop();
  for(const value of [null,{},'invalid',old,bundled,incomplete]) {
    assert.equal(api.readBankCache(()=>value).source,'内置');
    assert.deepEqual(clone(api.readBankCache(()=>value).bank),bundled);
  }
  assert.equal(api.readBankCache(()=>{throw Error('no storage');}).source,'内置');
});

test('download only requests the fixed jsDelivr JSON, without cookies or answer/profile payload', async () => {
  const api=fresh();let options;
  const result=await api.downloadBank(details=>{
    options=details;
    details.onload({status:200,finalUrl:api.BANK_URL,responseText:JSON.stringify(newer())});
    return {abort(){}};
  });
  assert.equal(api.BANK_URL,'https://cdn.jsdelivr.net/gh/DreamYuande/njxzc-handbook-2026-exam-helper@main/question-bank.json');
  assert.deepEqual([...source.matchAll(/^\/\/ @connect\s+(\S+)/gm)].map(match=>match[1]),['cdn.jsdelivr.net']);
  assert.equal(options.method,'GET');assert.equal(options.anonymous,true);
  assert.equal(options.data,undefined);
  const url=new URL(options.url);
  assert.equal(url.origin+url.pathname,api.BANK_URL);
  assert.deepEqual([...url.searchParams.keys()],['t']);
  assert.deepEqual(clone(result),newer());
});

test('network/HTTP/JSON/source errors and permission denial leave the active bank unchanged', async () => {
  const api=fresh(), before=JSON.stringify(api.current());
  const cases=[
    details=>details.onerror(), details=>details.ontimeout(), details=>details.onabort(),
    details=>details.onload({status:404,responseText:'{}'}),
    details=>details.onload({status:503,responseText:'{}'}),
    details=>details.onload({status:200,responseText:'<html>blocked</html>'}),
    details=>details.onload({status:200,responseText:'x'.repeat(4000001)}),
    details=>details.onload({status:200,finalUrl:'https://evil.example/bank',responseText:'{}'}),
    ()=>{throw Error('permission denied');}
  ];
  for(const run of cases) {
    await assert.rejects(api.downloadBank(details=>{run(details);return {abort(){}};}));
    assert.equal(JSON.stringify(api.current()),before);
  }
  await assert.rejects(api.downloadBank(null));
});

test('independent timeout aborts hung fetch and ignores late success callbacks', async () => {
  const api=fresh();let aborted=false, options;
  await assert.rejects(api.downloadBank(details=>{
    options=details;
    return {abort(){aborted=true;details.onabort();}};
  },10),/超时/);
  assert(aborted);
  options.onload({status:200,responseText:JSON.stringify(newer())});
  assert.equal(api.current().version,bundled.version);
});
