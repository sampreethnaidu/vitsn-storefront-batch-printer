import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import fs from 'fs'
import path from 'path'
import https from 'https'
import crypto from 'crypto'
import Razorpay from 'razorpay'
import { print } from 'pdf-to-printer'
import { PDFDocument } from 'pdf-lib'
import { initializeApp } from 'firebase/app'
import { getDatabase, ref, get, child } from 'firebase/database'
import { autoUpdater } from 'electron-updater'
import icon from '../../resources/icon.png?asset'
import http from 'http'
import { URL } from 'url'
import * as mammoth from 'mammoth'

const razorpay = new Razorpay({
  key_id: 'rzp_test_TJbDUA6rMkOjFE',
  key_secret: 'NQeE7aony8MC3gXnbyreLSph'
})

const firebaseConfig = {
  databaseURL: "https://vitsn-batch-printer-default-rtdb.firebaseio.com/"
}

const fbApp = initializeApp(firebaseConfig)
const db = getDatabase(fbApp)

const CACHE_DIR = app.getPath('userData')

function downloadFile(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest)
    https.get(url, (response) => {
      if (response.statusCode !== 200) {
        fs.unlink(dest, () => {})
        return reject(new Error(`HTTP Error ${response.statusCode}`))
      }
      response.pipe(file)
      file.on('finish', () => {
        file.close(() => resolve())
      })
    }).on('error', (err) => {
      fs.unlink(dest, () => {})
      reject(err)
    })
  })
}

function getFileHash(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(filePath)) return reject(new Error('File does not exist'))
    const hash = crypto.createHash('sha256')
    const stream = fs.createReadStream(filePath)
    stream.on('error', err => reject(err))
    stream.on('data', chunk => hash.update(chunk))
    stream.on('end', () => resolve(hash.digest('hex')))
  })
}

/**
 * Converts Word (.docx/.doc) files to PDF using mammoth and Electron Chromium renderer.
 * Bypasses OS-level MS Word dependencies entirely.
 */
async function convertWordToPdf(inputPath: string): Promise<string> {
  try {
    const result = await mammoth.convertToHtml({ path: inputPath })
    const htmlContent = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8">
          <style>
            body { font-family: Arial, sans-serif; padding: 20px; line-height: 1.6; color: #000; background: #fff; }
            img { max-width: 100%; height: auto; }
            table { border-collapse: collapse; width: 100%; }
            th, td { border: 1px solid #000; padding: 8px; }
          </style>
        </head>
        <body>${result.value}</body>
      </html>
    `

    const win = new BrowserWindow({
      show: false,
      webPreferences: { nodeIntegration: false, contextIsolation: true }
    })

    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(htmlContent)}`)

    const pdfBuffer = await win.webContents.printToPDF({
      printBackground: true,
      pageSize: 'A4',
      margins: { marginType: 'default' }
    })

    win.close()

    const outputPath = path.join(
      app.getPath('temp'),
      `vitsn_word_conv_${Date.now()}_${path.basename(inputPath, path.extname(inputPath))}.pdf`
    )
    fs.writeFileSync(outputPath, pdfBuffer)
    return outputPath
  } catch (error: any) {
    throw new Error(`Failed to convert Word file '${path.basename(inputPath)}': ${error.message}`)
  }
}

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 950,
    height: 700,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      webSecurity: true
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow.show())

  mainWindow.webContents.setWindowOpenHandler((details) => {
    const url = details.url.toLowerCase()
    if (url.startsWith('about:')) return { action: 'allow' }
    if (url.includes('razorpay.com') || url.includes('api.razorpay.com')) return { action: 'allow' }
    if (url.includes('google.com') || url.includes('googleapis.com') || url.includes('firebaseapp.com') || url.includes('gstatic.com')) return { action: 'allow' }
    
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    const server = http.createServer((req, res) => {
      try {
        const parsedUrl = new URL(req.url || '', `http://${req.headers.host}`)
        let pathname = parsedUrl.pathname
        if (pathname === '/' || pathname === '') pathname = '/index.html'
        
        const rendererRoot = path.join(app.getAppPath(), 'out/renderer')
        const filePath = path.join(rendererRoot, pathname)
        const extname = String(path.extname(filePath)).toLowerCase()
        
        const mimeTypes: Record<string, string> = {
          '.html': 'text/html', 
          '.js': 'text/javascript', 
          '.mjs': 'text/javascript',
          '.css': 'text/css',
          '.json': 'application/json', 
          '.png': 'image/png', 
          '.jpg': 'image/jpg',
          '.jpeg': 'image/jpeg',
          '.gif': 'image/gif', 
          '.svg': 'image/svg+xml', 
          '.ico': 'image/x-icon',
          '.woff': 'application/font-woff',
          '.woff2': 'font/woff2', 
          '.ttf': 'application/font-ttf', 
          '.wasm': 'application/wasm'
        }
        
        fs.readFile(filePath, (err, content) => {
          if (err) {
            res.writeHead(404, { 'Content-Type': 'text/plain' })
            res.end('404 Not Found')
          } else {
            res.writeHead(200, { 'Content-Type': mimeTypes[extname] || 'application/octet-stream' })
            res.end(content)
          }
        })
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'text/plain' })
        res.end('500 Server Error')
      }
    })
    
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'string' ? 0 : address?.port
      mainWindow.loadURL(`http://localhost:${port}`)
    })
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.electron')
  app.on('browser-window-created', (_, window) => optimizer.watchWindowShortcuts(window))

  // --- OTA AUTO-UPDATER CONFIGURATION ---
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('update-downloaded', () => {
    dialog.showMessageBox({
      type: 'info',
      title: 'Update Ready',
      message: 'A new version of VITSN Batch Printer has been downloaded in the background. Restart the application to apply the updates.',
      buttons: ['Restart Now', 'Later']
    }).then((result) => {
      if (result.response === 0) autoUpdater.quitAndInstall()
    })
  })

  autoUpdater.checkForUpdatesAndNotify().catch(() => { /* Silent failure */ })
  // ---------------------------------------

  ipcMain.handle('app:getVersion', () => app.getVersion())

  ipcMain.handle('get-printers', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return []
    return await win.webContents.getPrintersAsync()
  })

  ipcMain.handle('dialog:openFile', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Supported Documents (*.pdf, *.doc, *.docx)', extensions: ['pdf', 'doc', 'docx'] }]
    })
    if (canceled) return []
    return filePaths.map((filePath) => {
      const stats = fs.statSync(filePath)
      return { name: path.basename(filePath), path: filePath, size: (stats.size / 1024 / 1024).toFixed(2) }
    })
  })

  ipcMain.handle('print-file', async (_, filePath: string, printerName: string) => {
    let workingPdfPath = filePath
    let isTempFile = false
    try {
      const ext = path.extname(filePath).toLowerCase()
      if (ext === '.doc' || ext === '.docx') {
        workingPdfPath = await convertWordToPdf(filePath)
        isTempFile = true
      }

      await print(workingPdfPath, { printer: printerName })
      return { success: true }
    } catch (error: any) { 
      return { success: false, error: error.message } 
    } finally {
      if (isTempFile && fs.existsSync(workingPdfPath)) {
        try { fs.unlinkSync(workingPdfPath) } catch (_) {}
      }
    }
  })

  ipcMain.handle('pdf:read-buffer', async (_, filePath: string) => {
    if (!fs.existsSync(filePath)) throw new Error('Preview file expired or missing.')
    return fs.readFileSync(filePath) 
  })

  ipcMain.handle('pdf:process-batch', async (_, config) => {
    const tempConvertedPdfs: string[] = []
    try {
      const mergedPdf = await PDFDocument.create()
      let runList: string[] = []

      if (config.collate) {
        const maxCopies = Math.max(...config.files.map((f: any) => f.copies))
        for (let i = 0; i < maxCopies; i++) {
          for (const file of config.files) {
            if (file.copies > i) runList.push(file.path)
          }
        }
      } else {
        for (const file of config.files) {
          for (let i = 0; i < file.copies; i++) runList.push(file.path)
        }
      }

      for (const rawFilePath of runList) {
        let workingPdfPath = rawFilePath
        const ext = path.extname(rawFilePath).toLowerCase()
        if (ext === '.doc' || ext === '.docx') {
          workingPdfPath = await convertWordToPdf(rawFilePath)
          tempConvertedPdfs.push(workingPdfPath)
        }

        const fileBytes = fs.readFileSync(workingPdfPath)
        const srcDoc = await PDFDocument.load(fileBytes)
        const copiedPages = await mergedPdf.copyPages(srcDoc, srcDoc.getPageIndices())
        copiedPages.forEach((p) => mergedPdf.addPage(p))

        if (config.autoFix || config.smartDuplex) {
          if (mergedPdf.getPageCount() % 2 !== 0) {
            const { width, height } = copiedPages[copiedPages.length - 1].getSize()
            mergedPdf.addPage([width, height])
          }
        }
      }

      let finalPdfBytes;
      if (config.smartDuplex) {
        if (mergedPdf.getPageCount() % 2 !== 0) {
          const lastPage = mergedPdf.getPage(mergedPdf.getPageCount() - 1)
          const { width, height } = lastPage.getSize()
          mergedPdf.addPage([width, height])
        }
        const totalPages = mergedPdf.getPageCount()
        const reorderedPdf = await PDFDocument.create()
        for (let i = 0; i < totalPages; i += 2) {
          const [page] = await reorderedPdf.copyPages(mergedPdf, [i])
          reorderedPdf.addPage(page)
        }
        for (let i = totalPages - 1; i >= 1; i -= 2) {
          const [page] = await reorderedPdf.copyPages(mergedPdf, [i])
          reorderedPdf.addPage(page)
        }
        finalPdfBytes = await reorderedPdf.save()
      } else {
        finalPdfBytes = await mergedPdf.save()
      }

      const tempOutputPath = path.join(app.getPath('temp'), `VITSN_Batch_${Date.now()}.pdf`)
      fs.writeFileSync(tempOutputPath, finalPdfBytes)
      return { success: true, outputPath: tempOutputPath }
    } catch (error: any) {
      console.error('PDF Engine Error:', error)
      return { success: false, error: error.message }
    } finally {
      // Clean up temporary PDFs generated from Word documents
      for (const tempPath of tempConvertedPdfs) {
        if (fs.existsSync(tempPath)) {
          try { fs.unlinkSync(tempPath) } catch (_) {}
        }
      }
    }
  })

  ipcMain.handle('pdf:save', async (_, sourcePath: string) => {
    try {
      const { canceled, filePath } = await dialog.showSaveDialog({
        title: 'Save Merged PDF',
        defaultPath: 'VITSN_Merged_Document.pdf',
        filters: [{ name: 'PDF Files', extensions: ['pdf'] }]
      })
      if (canceled || !filePath) return { success: false, canceled: true }
      fs.copyFileSync(sourcePath, filePath)
      return { success: true, savedPath: filePath }
    } catch (error: any) { return { success: false, error: error.message } }
  })

  ipcMain.handle('pdf:preview', async (_, sourcePath: string) => {
    try { await shell.openPath(sourcePath); return { success: true } } 
    catch (error: any) { return { success: false, error: error.message } }
  })

  ipcMain.handle('ad:getVerifiedVideo', async () => {
    try {
      let adsPool: any[] = []
      
      try {
        const snapshot = await get(child(ref(db), 'active_ads'))
        if (snapshot.exists()) {
          const data = snapshot.val()
          adsPool = Object.keys(data).map(key => ({ id: key, ...data[key] }))
        }
      } catch (dbErr) { console.warn('Firebase offline.') }

      let selectedAd;
      if (adsPool.length > 0) {
        selectedAd = adsPool[Math.floor(Math.random() * adsPool.length)]
      } else {
        selectedAd = {
          id: 'default',
          videoUrl: 'https://www.w3schools.com/html/mov_bbb.mp4',
          sha256: 'pending', targetUrl: '', topBannerStr: '', bottomBannerStr: ''
        }
      }

      const adFilePath = path.join(CACHE_DIR, `ad_video_${selectedAd.id}.mp4`)
      let fileMatches = fs.existsSync(adFilePath)

      if (fileMatches && selectedAd.sha256 !== 'pending') {
        const currentHash = await getFileHash(adFilePath)
        if (currentHash !== selectedAd.sha256) {
          fileMatches = false; fs.unlinkSync(adFilePath)
        }
      }

      if (!fileMatches) {
        if (selectedAd.videoUrl && selectedAd.videoUrl.startsWith('data:video')) {
          const base64Data = selectedAd.videoUrl.split(',')[1]
          fs.writeFileSync(adFilePath, Buffer.from(base64Data, 'base64'))
        } else {
          await downloadFile(selectedAd.videoUrl, adFilePath)
        }
      }

      const videoBuffer = fs.readFileSync(adFilePath)

      return { 
        success: true, 
        videoBuffer, 
        targetUrl: selectedAd.targetUrl || '',
        topBannerStr: selectedAd.topBannerStr || '',
        bottomBannerStr: selectedAd.bottomBannerStr || ''
      }
    } catch (error: any) {
      console.error('Ad Sync Security Error:', error)
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('razorpay:createOrder', async (_, amountInRupees: number) => {
    try {
      const options = { amount: amountInRupees * 100, currency: 'INR', receipt: `receipt_${Date.now()}` }
      const order = await razorpay.orders.create(options)
      return { success: true, order, keyId: 'rzp_test_TJbDUA6rMkOjFE' }
    } catch (error: any) { return { success: false, error: error.message } }
  })

  ipcMain.handle('razorpay:verifyPayment', async (_, orderId: string, paymentId: string, signature: string) => {
    try {
      const expectedSignature = crypto.createHmac('sha256', 'NQeE7aony8MC3gXnbyreLSph').update(`${orderId}|${paymentId}`).digest('hex')
      if (expectedSignature === signature) return { success: true }
      else return { success: false, error: 'Signature verification mismatch.' }
    } catch (error: any) { return { success: false, error: error.message } }
  })

  createWindow()
  app.on('activate', function () { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
