// Refresh the offline default snapshot before publishing a new userscript version.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const scriptPath = path.join(root, '南京晓庄2026学生手册正式考试助手.user.js');
const bank = JSON.parse(fs.readFileSync(path.join(root, 'question-bank.json'), 'utf8'));
const source = fs.readFileSync(scriptPath, 'utf8');
const block = /  \/\/ __DEFAULT_BANK_START__[\s\S]*?  \/\/ __DEFAULT_BANK_END__/;
if (!block.test(source)) throw new Error('Default bank markers not found');
if (process.argv.includes('--check')) {
  const bundled = JSON.parse(source.match(/const DEFAULT_BANK = (.*);/)[1]);
  if (JSON.stringify(bundled) !== JSON.stringify(bank)) throw new Error('Default snapshot differs from question-bank.json');
  console.log('Default snapshot matches question-bank.json.');
  process.exit(0);
}
const updated = source.replace(block, () =>
  '  // __DEFAULT_BANK_START__\n  const DEFAULT_BANK = ' + JSON.stringify(bank) + ';\n  // __DEFAULT_BANK_END__');
fs.writeFileSync(scriptPath, updated, 'utf8');
console.log(`Bundled default bank ${bank.version}: ${bank.questions.length} questions.`);
