import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Capacitor } from '@capacitor/core';
import { Share } from '@capacitor/share';
import { isIOSApp, PathLabNative, type NativeProjectFile } from './native';

const WRITE_CHUNK_SIZE = 768 * 1024; // divisible by 3, so concatenated Base64 chunks stay valid

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const sliceSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += sliceSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + sliceSize, bytes.length)));
  }
  return btoa(binary);
}

/** Write in small pieces so very large PNG exports do not require one huge bridge payload. */
export async function shareBlobFromNative(blob: Blob, fileName: string): Promise<void> {
  const safeName = (fileName || 'PathLab-export').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 120);
  const keepInLibrary = isIOSApp();
  const directory = keepInLibrary ? Directory.Documents : Directory.Cache;
  const exportFolder = keepInLibrary ? 'Exports' : 'PathLabExports';
  const path = `${exportFolder}/${new Date().toISOString().replace(/[:.]/g, '-')}-${safeName}`;
  let complete = false;

  try {
    await Filesystem.writeFile({
      path,
      data: '',
      directory,
      encoding: Encoding.UTF8,
      recursive: true,
    });

    for (let offset = 0; offset < blob.size; offset += WRITE_CHUNK_SIZE) {
      const bytes = new Uint8Array(await blob.slice(offset, offset + WRITE_CHUNK_SIZE).arrayBuffer());
      await Filesystem.appendFile({
        path,
        data: bytesToBase64(bytes),
        directory,
      });
    }
    const { uri } = await Filesystem.getUri({ path, directory });
    complete = true;
    await Share.share({
      title: fileName,
      url: uri,
      dialogTitle: '导出 PathLab 文件',
    });
  } finally {
    // iOS exports remain in the app's Documents folder for Files-app access.
    // Temporary non-iOS share files, and incomplete writes, are cleaned up.
    if (!keepInLibrary || !complete) {
      await Filesystem.deleteFile({ path, directory }).catch(() => undefined);
    }
  }
}

/** Use the platform document picker, then read its app-cache copy through Capacitor's local file bridge. */
export async function pickPathLabProjectFromNative(): Promise<File | null> {
  const picked = await PathLabNative.pickProject();
  return readNativeProjectFile(picked);
}

async function readNativeProjectFile(picked: NativeProjectFile): Promise<File | null> {
  if (picked.failed) throw new Error(picked.message || '无法打开 PathLab 工程文件。');
  if (picked.cancelled) return null;
  if (!picked.relativePath || !picked.fileName) throw new Error('没有取得所选工程文件。');

  const path = picked.relativePath;
  try {
    const { uri } = await Filesystem.getUri({ path, directory: Directory.Cache });
    const response = await fetch(Capacitor.convertFileSrc(uri));
    if (!response.ok) throw new Error('无法读取所选工程文件，请确认文件仍可访问。');
    const blob = await response.blob();
    return new File([blob], picked.fileName, { type: 'application/zip' });
  } finally {
    await Filesystem.deleteFile({ path, directory: Directory.Cache }).catch(() => undefined);
  }
}

export async function watchForOpenedPathLabProject(
  onProject: (file: File) => void | Promise<void>,
  onError: (message: string) => void,
): Promise<() => void> {
  let active = true;
  let consuming = false;
  let consumeAgain = false;
  const consumeOpenedProject = () => {
    if (consuming) {
      consumeAgain = true;
      return;
    }
    consuming = true;
    void PathLabNative.consumeOpenedProject()
      .then(readNativeProjectFile)
      .then(async (file) => {
        if (active && file) await onProject(file);
      })
      .catch((error: unknown) => {
        if (active) onError(error instanceof Error ? error.message : '无法读取打开的 PathLab 工程。');
      })
      .finally(() => {
        consuming = false;
        if (active && consumeAgain) {
          consumeAgain = false;
          consumeOpenedProject();
        }
      });
  };
  const openedListener = await PathLabNative.addListener('projectOpened', consumeOpenedProject);
  const failedListener = await PathLabNative.addListener('projectOpenFailed', consumeOpenedProject);

  // Recover an open-file URL even if its native notification arrived before
  // this JavaScript listener was registered.
  consumeOpenedProject();

  return () => {
    active = false;
    void openedListener.remove();
    void failedListener.remove();
  };
}
