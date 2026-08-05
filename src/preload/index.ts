import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

const api = {
  getAppVersion: () => ipcRenderer.invoke('app:getVersion'),
  getPrinters: () => ipcRenderer.invoke('get-printers'),
  selectFiles: () => ipcRenderer.invoke('dialog:openFile'),
  printFile: (filePath, printerName) => ipcRenderer.invoke('print-file', filePath, printerName),
  processBatchPDF: (config) => ipcRenderer.invoke('pdf:process-batch', config),
  saveCompiledPdf: (sourcePath) => ipcRenderer.invoke('pdf:save', sourcePath),
  readPdfBuffer: (filePath) => ipcRenderer.invoke('pdf:read-buffer', filePath),
  previewPdf: (filePath) => ipcRenderer.invoke('pdf:preview', filePath),
  getVerifiedAd: () => ipcRenderer.invoke('ad:getVerifiedVideo'),
  createRazorpayOrder: (amount) => ipcRenderer.invoke('razorpay:createOrder', amount),
  verifyRazorpayPayment: (orderId, paymentId, signature) => ipcRenderer.invoke('razorpay:verifyPayment', orderId, paymentId, signature)
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}