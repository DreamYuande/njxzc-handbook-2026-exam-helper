const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname,'..','南京晓庄2026学生手册正式考试助手.user.js'),'utf8');
const context = vm.createContext({URL,setTimeout,clearTimeout});
vm.runInContext(source.split('// __TEST_EXPORT_POINT__')[0]+'globalThis.applyPlan=applyPlan;globalThis.fallback={loadFallbackMode,fallbackKeyForMode,FALLBACK_KEY};})();',context);

test('standard defaults to skip and race defaults to guess, with independent remembered choices', () => {
  const {loadFallbackMode,fallbackKeyForMode,FALLBACK_KEY}=context.fallback;
  const values=new Map([[FALLBACK_KEY,'guess']]);
  const storage={getItem:key => values.get(key) ?? null};
  assert.equal(loadFallbackMode('standard',storage),'skip');
  assert.equal(loadFallbackMode('race',storage),'guess');
  values.set(fallbackKeyForMode('standard'),'guess');
  values.set(fallbackKeyForMode('race'),'skip');
  assert.equal(loadFallbackMode('standard',storage),'guess');
  assert.equal(loadFallbackMode('race',storage),'skip');
  assert.equal(loadFallbackMode('standard',{getItem(){throw Error('denied');}}),'skip');
  assert.equal(loadFallbackMode('race',{getItem(){throw Error('denied');}}),'guess');
});

test('race can fill independent questions concurrently while standard calls remain sequential', async () => {
  async function simulate(parallel) {
    let inFlight=0,peak=0;
    const questions=Array.from({length:8},() => {
      const input={type:'radio',checked:false,disabled:false};
      const option={input,control:{classList:{contains:() => false},click(){
        inFlight++;peak=Math.max(peak,inFlight);
        setTimeout(() => { input.checked=true;inFlight--; },5);
      }}};
      return {type:'3',options:[option]};
    });
    const fill=data => context.applyPlan(data,{indices:[0]},() => true,parallel);
    if (parallel) await Promise.all(questions.map(fill));
    else for (const question of questions) await fill(question);
    assert(questions.every(question => question.options[0].input.checked));
    return peak;
  }
  assert.equal(await simulate(false),1);
  assert.equal(await simulate(true),8);
});

test('fast multi-select clears wrong choices before adding correct choices, without double toggles', async () => {
  const clicked=[];
  const options=Array.from({length:4},(_,index) => {
    const input={type:'checkbox',checked:index===1,disabled:false};
    return {input,control:{classList:{contains:() => false},click(){clicked.push(index);input.checked=!input.checked;}}};
  });
  assert.equal(await context.applyPlan({type:'4',options},{indices:[0,2]},() => true,true),true);
  assert.deepEqual(clicked,[1,0,2]);
  assert.deepEqual(options.map(option => option.input.checked),[true,false,true,false]);
});

test('cancelling a race prevents pending questions from being clicked', async () => {
  let clicks=0;
  const input={type:'radio',checked:false,disabled:false};
  const data={type:'3',options:[{input,control:{classList:{contains:() => false},click(){clicks++;}}}]};
  assert.equal(await context.applyPlan(data,{indices:[0]},() => false,true),false);
  assert.equal(clicks,0);
});

test('initialization waits for the native option row to become usable before proceeding', async () => {
  let ready=false,clicks=0;
  const input={type:'checkbox',checked:false,disabled:false};
  const option={input,row:{click(){clicks++;if(ready)input.checked=!input.checked;}},
    control:{classList:{contains:() => false},click(){assert.fail('inner icon must not be clicked');}}};
  setTimeout(() => {ready=true;},60);
  assert.equal(await context.applyPlan({type:'4',options:[option]},{indices:[0]},() => true,true,true),true);
  assert.equal(input.checked,true);
  assert.equal(clicks,2);
});

test('a delayed checkbox state change is observed before any initialization retry can reverse it', async () => {
  let clicks=0;
  const input={type:'checkbox',checked:false,disabled:false};
  const option={input,row:{click(){clicks++;setTimeout(() => {input.checked=!input.checked;},30);}},
    control:{classList:{contains:() => false}}};
  assert.equal(await context.applyPlan({type:'4',options:[option]},{indices:[0]},() => true,true,true),true);
  assert.equal(input.checked,true);
  assert.equal(clicks,1);
});

test('cancelling during initialization stops further clicks without producing another timeout error', async () => {
  let running=true,clicks=0;
  const input={type:'radio',checked:false,disabled:false};
  const option={input,row:{click(){clicks++;}},control:{classList:{contains:() => false}}};
  setTimeout(() => {running=false;},20);
  assert.equal(await context.applyPlan({type:'3',options:[option]},{indices:[0]},() => running,true,true),false);
  assert.equal(clicks,1);
});
