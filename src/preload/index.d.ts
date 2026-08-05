import { ElectronAPI } from '@electron-toolkit/preload'

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      getAppVersion: () => Promise<string>
      getPrinters: () => Promise<any[]>
      selectFiles: () => Promise<{ name: string; path: string; size: string; }[]>
      printFile: (filePath: string, printerName: string) => Promise<{ success: boolean; error?: string }>
      processBatchPDF: (config: any) => Promise<{ success: boolean; outputPath?: string; error?: string }>
      saveCompiledPdf: (sourcePath: string) => Promise<{ success: boolean; savedPath?: string; canceled?: boolean; error?: string }>
      readPdfBuffer: (filePath: string) => Promise<ArrayBuffer>
      previewPdf: (filePath: string) => Promise<{ success: boolean; error?: string }>
      getVerifiedAd: () => Promise<{ success: boolean; videoBuffer?: Uint8Array; targetUrl?: string; topBannerStr?: string; bottomBannerStr?: string; error?: string }>
      createRazorpayOrder: (amount: number) => Promise<{ success: boolean; order?: any; keyId?: string; error?: string }>
      verifyRazorpayPayment: (orderId: string, paymentId: string, signature: string) => Promise<{ success: boolean; error?: string }>
    }
  }
}