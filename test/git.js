const { EOL } = require('os');
const test = require('tape');
const shell = require('shelljs');
const semver = require('semver');
const mockStdIo = require('mock-stdio');
const { config } = require('../lib/config');
const { readFile, readJSON } = require('./util/index');
const { run, copy } = require('../lib/shell');
const {
  isGitRepo,
  isInGitRootDir,
  hasUpstream,
  getBranchName,
  tagExists,
  getRemoteUrl,
  isWorkingDirClean,
  clone,
  stage,
  status,
  reset,
  commit,
  tag,
  getLatestTag,
  push,
  getChangelog,
  isSameRepo
} = require('../lib/git');

const tmp = 'test/resources/tmp';

test('isGitRepo', async t => {
  t.ok(await isGitRepo());
  const tmp = '..';
  shell.pushd('-q', tmp);
  t.notOk(await isGitRepo());
  t.notOk(await isGitRepo());
  shell.popd('-q');
  t.end();
});

test('isInGitRootDir', async t => {
  shell.mkdir(tmp);
  shell.pushd('-q', tmp);
  t.notOk(await isInGitRootDir());
  await run('git init');
  t.ok(await isInGitRootDir());
  shell.popd('-q');
  t.end();
});

test('hasUpstream', async t => {
  shell.mkdir(tmp);
  shell.pushd('-q', tmp);
  await run('git init');
  await run('!touch file1');
  await run('git add file1');
  await run('git commit -am "Add file1"');
  t.notOk(await hasUpstream());
  shell.popd('-q');
  shell.rm('-rf', tmp);
  t.end();
});

test('getBranchName', async t => {
  shell.mkdir(tmp);
  shell.pushd('-q', tmp);
  await run('git init');
  t.equal(await getBranchName(), null);
  await run('git checkout -b feat');
  await run('!touch file1');
  await run('git add file1');
  await run('git commit -am "Add file1"');
  t.equal(await getBranchName(), 'feat');
  shell.popd('-q');
  shell.rm('-rf', tmp);
  t.end();
});

test('tagExists + isWorkingDirClean', async t => {
  shell.mkdir(tmp);
  shell.pushd('-q', tmp);
  await run('git init');
  t.notOk(await tagExists('1.0.0'));
  await run('!touch file1');
  t.notOk(await isWorkingDirClean());
  await run('git add file1');
  await run('git commit -am "Add file1"');
  await run('git tag 1.0.0');
  t.ok(await tagExists('1.0.0'));
  t.ok(await isWorkingDirClean());
  shell.popd('-q');
  shell.rm('-rf', tmp);
  t.end();
});

test('getRemoteUrl', async t => {
  shell.mkdir(tmp);
  shell.pushd('-q', tmp);
  await run(`git init`);
  t.equal(await getRemoteUrl(), null);
  t.equal(await getRemoteUrl('git://github.com/webpro/release-it.git'), 'git://github.com/webpro/release-it.git');
  t.equal(await getRemoteUrl('git@github.com:webpro/release-it.git'), 'git@github.com:webpro/release-it.git');
  t.equal(await getRemoteUrl('https://github.com/webpro/release-it.git'), 'https://github.com/webpro/release-it.git');
  await run(`git remote add origin foo`);
  t.equal(await getRemoteUrl(), 'foo');
  t.equal(await getRemoteUrl('origin'), 'foo');
  await run(`git remote add another bar`);
  t.equal(await getRemoteUrl('another'), 'bar');
  shell.popd('-q');
  shell.rm('-rf', tmp);
  t.end();
});

test('clone + stage + commit + tag + push', async t => {
  const tmpOrigin = 'test/resources/bare.git';
  await run(`git init --bare ${tmpOrigin}`);
  await clone(tmpOrigin, tmp);
  await copy('package.json', {}, tmp);
  shell.pushd('-q', tmp);
  await stage('package.json');
  await commit({
    message: 'Add package.json'
  });
  const pkgBefore = await readJSON('package.json');
  const versionBefore = pkgBefore.version;
  await run(`git tag ${versionBefore}`);
  const actual_latestTagBefore = await getLatestTag();
  t.ok(await isGitRepo());
  t.equal(versionBefore, actual_latestTagBefore);
  await run('echo line >> file1');
  await stage('file1');
  await commit({
    message: 'Update file1'
  });
  await run('npm --no-git-tag-version version patch');
  await stage('package.json');
  const nextVersion = semver.inc(versionBefore, 'patch');
  await commit({
    message: `Release v${nextVersion}`
  });
  await tag({ name: `v${nextVersion}`, annotation: `Release v${nextVersion}` });
  const pkgAfter = await readJSON('package.json');
  const actual_latestTagAfter = await getLatestTag();
  t.equal(pkgAfter.version, actual_latestTagAfter);
  await push();
  const status = await run('git status -uno');
  t.ok(status.includes('nothing to commit'));
  shell.popd('-q');
  shell.rm('-rf', [tmpOrigin, tmp]);
  t.end();
});

test('push', async t => {
  const tmpOrigin = 'test/resources/bare.git';
  await run(`git init --bare ${tmpOrigin}`);
  await clone(tmpOrigin, tmp);
  await copy('package.json', {}, tmp);
  shell.pushd('-q', tmp);
  await stage('package.json');
  await commit({ message: 'Add package.json' });
  const { verbose } = config.options;
  config.options.verbose = true;

  {
    mockStdIo.start();
    await push();
    const { stdout } = mockStdIo.end();
    t.equal(stdout.trim(), `$ git push --follow-tags`);
  }

  {
    mockStdIo.start();
    await push({ pushRepo: 'origin', hasUpstreamBranch: true });
    const { stdout } = mockStdIo.end();
    t.equal(stdout.trim(), `$ git push --follow-tags  origin`);
  }

  {
    mockStdIo.start();
    try {
      await push({ pushRepo: 'https://host/repo.git', hasUpstreamBranch: true });
    } catch (err) {
      console.log(err); // eslint-disable-line no-console
    }
    const { stdout } = mockStdIo.end();
    t.ok(stdout.includes('$ git push --follow-tags  https://host/repo.git'));
  }

  {
    mockStdIo.start();
    await push({ pushRepo: 'origin', hasUpstreamBranch: false });
    const { stdout } = mockStdIo.end();
    t.ok(stdout.includes('$ git push --follow-tags   -u origin master'));
    t.ok(stdout.includes("Branch 'master' set up to track remote branch 'master' from 'origin'"));
  }

  shell.popd('-q');
  shell.rm('-rf', [tmpOrigin, tmp]);
  config.options.verbose = verbose;
  t.end();
});

test('status', async t => {
  shell.mkdir(tmp);
  shell.pushd('-q', tmp);
  await run('git init');
  await run('echo line >> file1');
  await run('git add file1');
  await run('git commit -am "Add file1"');
  await run('echo line >> file1');
  await run('echo line >> file2');
  await run('git add file2');
  t.equal(await status(), 'M file1\nA  file2');
  shell.popd('-q');
  shell.rm('-rf', tmp);
  t.end();
});

test('reset', async t => {
  shell.mkdir(tmp);
  shell.pushd('-q', tmp);
  await run('git init');
  await run('echo line >> file1');
  await run('git add file1');
  await run('git commit -am "Add file1"');
  await run('echo line >> file1');
  t.ok(/^line\s*line\s*$/.test(await readFile('file1')));
  await reset('file1');
  t.ok(/^line\s*$/.test(await readFile('file1')));
  mockStdIo.start();
  await reset(['file2, file3']);
  const { stdout } = mockStdIo.end();
  t.ok(/Could not reset file2, file3/.test(stdout));
  shell.popd('-q');
  shell.rm('-rf', tmp);
  t.end();
});

test('getChangelog', async t => {
  shell.mkdir(tmp);
  shell.pushd('-q', tmp);
  await run('git init');
  await run('echo line >> file && git add file && git commit -m "First commit"');
  await run('echo line >> file && git add file && git commit -m "Second commit"');
  await t.shouldReject(
    getChangelog({
      command: 'git log --invalid',
      tagName: '${version}',
      latestVersion: '1.0.0'
    }),
    /Could not create changelog/
  );

  const changelog = await getChangelog({
    command: config.options.scripts.changelog,
    tagName: '${version}',
    latestVersion: '1.0.0'
  });
  const pattern = /^\* Second commit \(\w{7}\)\n\* First commit \(\w{7}\)$/;
  t.ok(pattern.test(changelog));

  await run('git tag 1.0.0');
  await run('echo line C >> file && git add file && git commit -m "Third commit"');
  await run('echo line D >> file && git add file && git commit -m "Fourth commit"');

  const changelogSinceTag = await getChangelog({
    command: config.options.scripts.changelog,
    tagName: '${version}',
    latestVersion: '1.0.0'
  });
  const pattern1 = /^\* Fourth commit \(\w{7}\)\n\* Third commit \(\w{7}\)$/;
  t.ok(pattern1.test(changelogSinceTag));

  shell.popd('-q');
  shell.rm('-rf', tmp);
  t.end();
});

test('getChangelog (custom)', async t => {
  const changelog = await getChangelog({
    command: 'echo ${name}'
  });
  t.equal(changelog, 'release-it');
  t.end();
});

test('isSameRepo', t => {
  const repoA = {
    remote: 'https://github.com/webpro/release-it.git',
    protocol: 'https',
    host: 'github.com',
    repository: 'webpro/release-it',
    owner: 'webpro',
    project: 'release-it-test'
  };
  const repoB = Object.assign({}, repoA, {
    remote: 'https://github.com/webpro/release-it.git#dist'
  });
  t.ok(isSameRepo(repoA, repoB));
  t.end();
});
