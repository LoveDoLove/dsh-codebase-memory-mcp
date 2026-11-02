import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  cbmProjectName,
  projectNameFromPath,
  resolveSafeRepoPath,
  isSensitiveOrSecret,
  isBinaryFile,
  parseGitignoreContent,
  matchesGitignore,
  discoverRepository,
  sanitizeCodeContent,
} from '../src/discovery.mjs'

test('cbmProjectName produces correct slug for POSIX and Windows', () => {
  assert.equal(cbmProjectName('/home/user/project'), 'home-user-project')
  assert.equal(cbmProjectName('C:\\Users\\user\\project'), 'C-Users-user-project')
  assert.equal(projectNameFromPath('/home/user/project'), 'home-user-project')
})

test('resolveSafeRepoPath guards against path traversal', (t) => {
  const tmp = mkdtempSync(join(tmpdir(), 'cbm-disc-test-'))
  t.after(() => rmSync(tmp, { recursive: true, force: true }))

  const sub = join(tmp, 'src')
  mkdirSync(sub)
  writeFileSync(join(sub, 'index.js'), 'console.log("hi")')

  assert.equal(resolveSafeRepoPath(tmp, 'src/index.js'), 'src/index.js')
  assert.equal(resolveSafeRepoPath(tmp, join(tmp, 'src/index.js')), 'src/index.js')

  assert.equal(resolveSafeRepoPath(tmp, '../etc/passwd'), null)
  assert.equal(resolveSafeRepoPath(tmp, join(tmp, '../../foo')), null)
  assert.equal(resolveSafeRepoPath(tmp, '/etc/shadow'), null)
})

test('resolveSafeRepoPath rejects symlink pointing outside repo', (t) => {
  const tmp = mkdtempSync(join(tmpdir(), 'cbm-sym-test-'))
  const outside = mkdtempSync(join(tmpdir(), 'cbm-outside-test-'))
  t.after(() => {
    rmSync(tmp, { recursive: true, force: true })
    rmSync(outside, { recursive: true, force: true })
  })

  const target = join(outside, 'secret.txt')
  writeFileSync(target, 'secret')

  const link = join(tmp, 'link.txt')
  try {
    symlinkSync(target, link)
    assert.equal(resolveSafeRepoPath(tmp, 'link.txt'), null)
  } catch (err) {
    if (err.code !== 'EPERM') throw err
  }
})

test('isSensitiveOrSecret detects private keys and credential files', () => {
  assert.equal(isSensitiveOrSecret('.env'), true)
  assert.equal(isSensitiveOrSecret('.env.local'), true)
  assert.equal(isSensitiveOrSecret('id_rsa'), true)
  assert.equal(isSensitiveOrSecret('cert.pem'), true)
  assert.equal(isSensitiveOrSecret('src/index.ts'), false)
})

test('isBinaryFile detects known binary extensions', () => {
  assert.equal(isBinaryFile('image.png'), true)
  assert.equal(isBinaryFile('binary.wasm'), true)
  assert.equal(isBinaryFile('bundle.tar.gz'), true)
  assert.equal(isBinaryFile('main.rs'), false)
})

test('gitignore parser matches negation and directory globs', () => {
  const gitignore = `
# Comment
node_modules/
*.log
!important.log
dist/
`
  const rules = parseGitignoreContent(gitignore)
  assert.equal(matchesGitignore('node_modules', rules, true), true)
  assert.equal(matchesGitignore('test.log', rules, false), true)
  assert.equal(matchesGitignore('important.log', rules, false), false)
  assert.equal(matchesGitignore('src/index.js', rules, false), false)
})

test('discoverRepository discovers source files while ignoring excluded dirs and secrets', (t) => {
  const tmp = mkdtempSync(join(tmpdir(), 'cbm-walk-test-'))
  t.after(() => rmSync(tmp, { recursive: true, force: true }))

  mkdirSync(join(tmp, 'src'))
  mkdirSync(join(tmp, 'node_modules'))
  mkdirSync(join(tmp, '.git'))

  writeFileSync(join(tmp, 'src', 'app.ts'), 'export const a = 1;')
  writeFileSync(join(tmp, 'src', 'util.js'), 'export function b() {}')
  writeFileSync(join(tmp, 'src', '.env'), 'SECRET=12345678')
  writeFileSync(join(tmp, 'node_modules', 'dep.js'), 'module.exports = {};')
  writeFileSync(join(tmp, '.git', 'HEAD'), 'ref: refs/heads/main')

  const files = discoverRepository(tmp)
  const relPaths = files.map((f) => f.relPath).sort()

  assert.deepEqual(relPaths, ['src/app.ts', 'src/util.js'])
  assert.equal(files.find((f) => f.relPath === 'src/app.ts').language, 'typescript')
  assert.equal(files.find((f) => f.relPath === 'src/util.js').language, 'javascript')
})

test('sanitizeCodeContent scrubs sensitive tokens', () => {
  const code = 'const apiKey = "sk-ant-api03-1234567890abcdefghijklmnopqrstuvwxyz"'
  const sanitized = sanitizeCodeContent(code)
  assert.ok(!sanitized.includes('sk-ant-api03-1234567890abcdefghijklmnopqrstuvwxyz'))
  assert.ok(sanitized.includes('[REDACTED'))
})
