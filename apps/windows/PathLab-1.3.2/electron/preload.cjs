const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pathlabTranslation', {
  invoke: (request) => ipcRenderer.invoke('pathlab:translation', request),
});
