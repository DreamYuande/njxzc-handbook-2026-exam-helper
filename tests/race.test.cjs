const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname,'..','南京晓庄2026学生手册正式考试助手.user.js'),'utf8');
const context = vm.createContext({URL,setTimeout,clearTimeout});
vm.runInContext(source.split('// __TEST_EXPORT_POINT__')[0]+'globalThis.applyPlan=applyPlan;})();',context);

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
