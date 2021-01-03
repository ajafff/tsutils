// @ts-check
const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const token = fs.readFileSync(
    path.join(os.homedir(), 'github_token.txt'),
    'utf8',
);
cp.execSync('github-release-from-changelog', { env: {...process.env, GITHUB_TOKEN: token}, stdio: 'inherit' });
