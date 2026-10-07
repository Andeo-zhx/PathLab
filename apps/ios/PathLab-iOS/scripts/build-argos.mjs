import { existsSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envDir = path.join(root, '.argos-build-env');
const python = path.join(envDir, 'Scripts', 'python.exe');
const dist = path.join(root, 'translator', 'dist');
const work = path.join(root, 'translator', 'build');
const spec = path.join(root, 'translator', 'spec');

function run(executable, args) {
  const result = spawnSync(executable, args, { cwd: root, stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${path.basename(executable)} exited with ${result.status}`);
}

if (!existsSync(python)) {
  const basePython = process.env.PATHLAB_PYTHON || 'python.exe';
  run(basePython, ['-m', 'venv', envDir]);
}

mkdirSync(dist, { recursive: true });
mkdirSync(work, { recursive: true });
mkdirSync(spec, { recursive: true });
run(python, [
  '-m', 'pip', 'install', '--disable-pip-version-check',
  '--cache-dir', path.join(root, '.pip-cache-v110'),
  '-r', path.join(root, 'translator', 'requirements.txt'),
]);
run(python, [
  '-m', 'PyInstaller',
  '--clean', '--noconfirm', '--onefile', '--console',
  '--name', 'pathlab-argos-worker',
  '--distpath', dist,
  '--workpath', work,
  '--specpath', spec,
  '--paths', path.join(root, 'translator', 'stubs'),
  '--exclude-module', 'spacy',
  '--exclude-module', 'torch',
  path.join(root, 'translator', 'worker.py'),
]);

console.log(`Argos worker ready: ${path.join(dist, 'pathlab-argos-worker.exe')}`);
