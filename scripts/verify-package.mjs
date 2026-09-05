import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
const approvedRoots=['src/','dist/','tests/','examples/','scripts/','.github/workflows/'];
const approvedFiles=['.gitignore','LICENSE','THIRD_PARTY_NOTICES','dependency-licenses.json','package.json','package-lock.json','tsconfig.json'];
const tracked=execFileSync('git',['ls-files'],{encoding:'utf8'}).trim().split('\n');
for(const file of tracked){
  assert.ok(approvedFiles.includes(file)||approvedRoots.some(root=>file.startsWith(root)),`Unexpected public file: ${file}`);
  assert.ok(!/\.(?:rs|key|pem|p12|p8)$|(?:^|\/)(?:AGENTS|CLAUDE|CODEX|GEMINI|GROK)\.md$/iu.test(file),`Excluded file: ${file}`);
}
const inventory=JSON.parse(fs.readFileSync('dependency-licenses.json'));
const lock=JSON.parse(fs.readFileSync('package-lock.json'));
const installed=[];
for(const [directory,value]of Object.entries(lock.packages)){
  if(!directory.startsWith('node_modules/'))continue;
  const pkg=JSON.parse(fs.readFileSync(`${directory}/package.json`));
  assert.ok(['MIT','Apache-2.0'].includes(pkg.license),`Unreviewed license: ${pkg.name}`);
  installed.push({name:pkg.name,version:pkg.version,license:pkg.license,developmentOnly:!!value.dev});
}
assert.deepEqual(installed,inventory,'Dependency inventory drift');
assert.ok(fs.readFileSync('LICENSE','utf8').startsWith('MIT License'));
process.stdout.write(`Public boundary and ${installed.length} dependency licenses verified.\n`);
