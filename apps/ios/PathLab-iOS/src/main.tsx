import { createRoot } from 'react-dom/client';
import App from './App';
import './styles/app.css';
import { useProject } from './store/projectStore';
import { useUi } from './store/uiStore';
import { useStyle } from './store/styleStore';
import * as actions from './lib/actions';
import { openProjectFromFile } from './lib/actions';
import { viewport, viewCommands } from './lib/viewport';
import { installNativeBridges } from './lib/native';

const container = document.getElementById('root');
if (!container) throw new Error('缺少 #root 挂载点');
installNativeBridges();
createRoot(container).render(<App />);

/* 仅开发环境：暴露调试桥，便于自动化验收 */
if (import.meta.env.DEV) {
  Object.assign(window as unknown as Record<string, unknown>, {
    __pathlab: {
      useProject,
      useUi,
      useStyle,
      viewport,
      viewCommands,
      openProjectFromFile,
      state: () => useProject.getState().project,
      importFiles: actions.importFiles,
      deleteSelection: actions.deleteSelection,
      duplicateSelection: actions.duplicateSelection,
      saveProjectToFile: actions.saveProjectToFile,
      arrangeImages: actions.arrangeImages,
      startNewProject: actions.startNewProject,
    },
  });
}
