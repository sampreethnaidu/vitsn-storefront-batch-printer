import { useState, useEffect } from 'react'
import { auth, googleProvider, db } from './firebase'
import { signInWithPopup, signOut, onAuthStateChanged, User } from 'firebase/auth'
import { ref as dbRef, get, set, update, push, increment, onValue } from 'firebase/database'

interface PrintFile {
  id: string; name: string; path: string; size: string; selected: boolean; copies: number
  status: 'Pending' | 'Processing...' | 'Printing...' | 'Completed' | 'Failed' | 'Blocked'
}

type OutputAction = 'print' | 'download' | 'preview' | null
interface UpdateInfo { required: boolean; available: boolean; url: string; version: string }

interface AdCampaign {
  id?: string; uid?: string; status: 'Pending' | 'Aired' | 'Rejected' | 'Terminated'
  date: string; expiryEpoch?: number; topBannerStr: string; bottomBannerStr: string
  videoUrl?: string; targetUrl: string; paymentId: string; remark?: string
}

function App() {
  const [currentUser, setCurrentUser] = useState<User | null>(null)
  const [isPremiumUser, setIsPremiumUser] = useState<boolean>(false)
  const [isAdmin, setIsAdmin] = useState<boolean>(false)
  const [couponInput, setCouponInput] = useState<string>('')
  const [isApplying, setIsApplying] = useState<boolean>(false)
  const [isLoggingIn, setIsLoggingIn] = useState<boolean>(false)
  
  const [showAccountMenu, setShowAccountMenu] = useState<boolean>(false)
  const [showNagModal, setShowNagModal] = useState<boolean>(false)
  const [showHistoryModal, setShowHistoryModal] = useState<boolean>(false)
  const [paymentHistory, setPaymentHistory] = useState<any[]>([])

  const [showAdminDashboard, setShowAdminDashboard] = useState<boolean>(false)
  const [adminStats, setAdminStats] = useState({ free: 0, paid: 0, downloads: 0 })
  const [adminAdQueue, setAdminAdQueue] = useState<AdCampaign[]>([])
  const [simulateTier, setSimulateTier] = useState<'admin' | 'premium' | 'free'>('admin')
  
  const [adminRemarks, setAdminRemarks] = useState<Record<string, string>>({})
  const [previewAdMedia, setPreviewAdMedia] = useState<AdCampaign | null>(null)

  const [showAdStudio, setShowAdStudio] = useState<boolean>(false)
  const [clientAds, setClientAds] = useState<AdCampaign[]>([])
  const [isSubmittingAd, setIsSubmittingAd] = useState<boolean>(false)
  
  const [adTargetUrl, setAdTargetUrl] = useState<string>('') 
  const [topBannerStr, setTopBannerStr] = useState<string>('')
  const [bottomBannerStr, setBottomBannerStr] = useState<string>('')
  const [videoStr, setVideoStr] = useState<string>('') 
  const [adminDurationDays, setAdminDurationDays] = useState<number>(30)

  const [globalAdLink, setGlobalAdLink] = useState<string>('') 
  const [renderedTopBanner, setRenderedTopBanner] = useState<string>('')
  const [renderedBottomBanner, setRenderedBottomBanner] = useState<string>('')

  const [showPdfModal, setShowPdfModal] = useState<boolean>(false)
  const [previewPdfSrc, setPdfPreviewSrc] = useState<string>('')
  const [updateData, setUpdateData] = useState<UpdateInfo>({ required: false, available: false, url: '', version: '' })

  const [printers, setPrinters] = useState<any[]>([])
  const [selectedPrinter, setSelectedPrinter] = useState<string>('')
  const [fileQueue, setFileQueue] = useState<PrintFile[]>([])
  const [isProcessing, setIsProcessing] = useState<boolean>(false)
  const [forceExecute, setForceExecute] = useState<boolean>(false)
  const [autoFixDuplex, setAutoFixDuplex] = useState<boolean>(true)

  const [collateSets, setCollateSets] = useState<boolean>(true)
  const [smartManualDuplex, setSmartManualDuplex] = useState<boolean>(false)

  const [showVideoAd, setShowVideoAd] = useState<boolean>(false)
  const [showPremiumLoading, setShowPremiumLoading] = useState<boolean>(false)
  const [adTimer, setAdTimer] = useState<number>(30)
  const [compiledPdfPath, setCompiledPdfPath] = useState<string | null>(null)
  const [pendingAction, setPendingAction] = useState<OutputAction>(null)
  const [adVideoSrc, setAdVideoSrc] = useState<string>('')

  const activeAdmin = isAdmin && simulateTier === 'admin'
  const activePremium = isAdmin && simulateTier !== 'admin' ? simulateTier === 'premium' : isPremiumUser

  useEffect(() => {
    const checkVersion = async () => {
      try {
        const currentVersion = await window.api.getAppVersion()
        const versionRef = dbRef(db, 'version_control')
        const snapshot = await get(versionRef)
        if (snapshot.exists()) {
          const data = snapshot.val()
          const isRequired = currentVersion.localeCompare(data.min_required_version, undefined, { numeric: true, sensitivity: 'base' }) < 0
          const isAvailable = currentVersion.localeCompare(data.latest_version, undefined, { numeric: true, sensitivity: 'base' }) < 0
          setUpdateData({ required: isRequired, available: isAvailable, url: data.download_url, version: data.latest_version })
        }
      } catch (error) { console.error('OTA Update Check Failed:', error) }
    }
    checkVersion()
  }, [])

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setCurrentUser(user)
      if (user) {
        const adminFlag = user.email === 'y.sam.naidu@gmail.com'
        setIsAdmin(adminFlag)
        try {
          const userRef = dbRef(db, `users/${user.uid}`)
          const snapshot = await get(userRef)
          if (snapshot.exists()) {
            const data = snapshot.val()
            const isPrem = data.isPremium || false
            setIsPremiumUser(isPrem)
            if (!isPrem && !adminFlag) setShowNagModal(true)
          } else {
            await set(userRef, { isPremium: false, email: user.email })
            setIsPremiumUser(false)
            if (!adminFlag) setShowNagModal(true)
          }
        } catch (error) { console.error('[RTDB] Critical Fetch Error:', error) }
      } else {
        setIsPremiumUser(false); setIsAdmin(false); setSimulateTier('admin')
        setShowNagModal(false); setClientAds([])
      }
    })
    return () => unsubscribe()
  }, [])

  useEffect(() => {
    let unsubscribe: any;
    if (currentUser && !isAdmin) {
      const adsRef = dbRef(db, `ads/${currentUser.uid}`)
      unsubscribe = onValue(adsRef, (snapshot) => {
        if (snapshot.exists()) {
          const data = snapshot.val()
          const formattedAds = Object.keys(data).map(key => ({ id: key, ...data[key] })) as AdCampaign[]
          setClientAds(formattedAds.reverse())
        } else { setClientAds([]) }
      })
    }
    return () => { if (unsubscribe) unsubscribe() }
  }, [currentUser, isAdmin])

  useEffect(() => {
    let nagInterval: NodeJS.Timeout
    if (currentUser && !activePremium && !activeAdmin) {
      nagInterval = setInterval(() => {
        if (!isProcessing && !showVideoAd && !showPdfModal && !showAdStudio && !updateData.required) {
          setShowNagModal(true)
        }
      }, 5 * 60 * 1000)
    }
    return () => clearInterval(nagInterval)
  }, [currentUser, activePremium, activeAdmin, isProcessing, showVideoAd, showPdfModal, showAdStudio, updateData.required])

  useEffect(() => {
    let interval: NodeJS.Timeout
    if (showVideoAd && adTimer > 0) interval = setInterval(() => setAdTimer((prev) => prev - 1), 1000)
    return () => clearInterval(interval)
  }, [showVideoAd, adTimer])

  useEffect(() => {
    let isMounted = true;
    let rotationTimer: NodeJS.Timeout;

    if (!showVideoAd) {
      const syncAds = async () => {
        try {
          const result = await window.api.getVerifiedAd()
          if (result.success && result.videoBuffer && isMounted) {
            const blob = new Blob([result.videoBuffer as any], { type: 'video/mp4' })
            const blobUrl = URL.createObjectURL(blob)
            
            setAdVideoSrc(prev => { 
              if (prev && prev.startsWith('blob:')) URL.revokeObjectURL(prev)
              return blobUrl 
            })
            setGlobalAdLink(result.targetUrl || '')
            setRenderedTopBanner(result.topBannerStr || '')
            setRenderedBottomBanner(result.bottomBannerStr || '')
          }
        } catch (e) { 
          console.error("Ad Engine Precache Error:", e) 
        }
      }

      syncAds()
      rotationTimer = setInterval(() => { syncAds() }, 30000)
    }

    return () => {
      isMounted = false;
      if (rotationTimer) clearInterval(rotationTimer);
    }
  }, [showVideoAd])

  const fetchPaymentHistory = async () => {
    if (!currentUser) return alert('CRITICAL: Login required.')
    try {
      const historyRef = dbRef(db, `users/${currentUser.uid}/history`)
      const snapshot = await get(historyRef)
      if (snapshot.exists()) {
        const data = snapshot.val()
        const formatted = Object.keys(data).map((k) => ({ id: k, ...data[k] })).reverse()
        setPaymentHistory(formatted)
      } else {
        setPaymentHistory([])
      }
      setShowHistoryModal(true)
      setShowAccountMenu(false)
    } catch (e) {
      console.error('History Fetch Error:', e)
      alert('Failed to retrieve payment history from database.')
    }
  }

  const loadAdminData = async () => {
    if (!isAdmin) return;
    try {
      const usersSnap = await get(dbRef(db, 'users'))
      const telemetrySnap = await get(dbRef(db, 'telemetry'))
      const adsSnap = await get(dbRef(db, 'ads'))
      
      let freeCount = 0; let paidCount = 0
      if (usersSnap.exists()) {
        Object.values(usersSnap.val()).forEach((u: any) => { if (u.isPremium) paidCount++; else freeCount++ })
      }
      
      let flatAds: AdCampaign[] = []
      const now = Date.now()

      if (adsSnap.exists()) {
        const adsObj = adsSnap.val()
        for (const uid in adsObj) {
          for (const adId in adsObj[uid]) {
            let ad = { uid, id: adId, ...adsObj[uid][adId] }
            if (ad.status === 'Aired' && ad.expiryEpoch && ad.expiryEpoch < now) {
              await update(dbRef(db, `ads/${uid}/${adId}`), { status: 'Terminated', remark: 'Auto-Expired after 30 Days.' })
              await set(dbRef(db, `active_ads/${adId}`), null)
              ad.status = 'Terminated'
            }
            flatAds.push(ad)
          }
        }
      }

      flatAds.sort((a, b) => {
        if (a.status === 'Pending' && b.status !== 'Pending') return -1;
        if (a.status !== 'Pending' && b.status === 'Pending') return 1;
        return new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime();
      })

      const downloads = telemetrySnap.exists() ? telemetrySnap.val().total_downloads || 0 : 0
      setAdminStats({ free: freeCount, paid: paidCount, downloads })
      setAdminAdQueue(flatAds)
      setShowAdminDashboard(true)
      setShowAccountMenu(false)
    } catch (error) {
      console.error("Admin fetch error:", error)
      alert("Security Error: Firebase Rules blocked access.")
    }
  }

  const getBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.readAsDataURL(file)
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = error => reject(error)
    })
  }

  const validateMedia = (file: File, type: 'banner' | 'video'): Promise<boolean> => {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(file)
      if (type === 'banner') {
        const img = new Image()
        img.onload = () => { URL.revokeObjectURL(url); if (img.naturalWidth === 728 && img.naturalHeight === 90) resolve(true); else resolve(false) }
        img.onerror = () => resolve(false); img.src = url
      } else {
        const vid = document.createElement('video')
        vid.onloadedmetadata = () => { URL.revokeObjectURL(url); const ratio = vid.videoWidth / vid.videoHeight; if (ratio >= 1.77 && ratio <= 1.78) resolve(true); else resolve(false) }
        vid.onerror = () => resolve(false); vid.src = url
      }
    })
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>, type: 'top' | 'bottom' | 'video') => {
    const file = e.target.files?.[0]
    if (!file) {
      if (type === 'top') setTopBannerStr(''); if (type === 'bottom') setBottomBannerStr(''); if (type === 'video') setVideoStr('');
      return;
    }
    
    if (type === 'video' && file.size > 5 * 1024 * 1024) {
      alert("Validation Failed: MP4 size exceeds the 5MB Free-Tier limit."); e.target.value = ''; return
    }
    
    const isValid = await validateMedia(file, type === 'video' ? 'video' : 'banner')
    if (!isValid) {
      alert(`Validation Failed:\n\n${type === 'video' ? 'Video MUST strictly be a 16:9 widescreen ratio (e.g. 1920x1080).' : 'Banners MUST be EXACTLY 728 pixels wide and 90 pixels tall.'}`)
      e.target.value = ''; if (type === 'top') setTopBannerStr(''); if (type === 'bottom') setBottomBannerStr(''); if (type === 'video') setVideoStr('');
    } else {
      const b64 = await getBase64(file)
      if (type === 'top') setTopBannerStr(b64)
      if (type === 'bottom') setBottomBannerStr(b64)
      if (type === 'video') setVideoStr(b64)
    }
  }

  const submitNewAdCampaign = async () => {
    if (!currentUser) return alert('CRITICAL: Login required.')
    if (!adTargetUrl.trim() || !adTargetUrl.toLowerCase().startsWith('http')) return alert('Validation Error: Provide valid target URL.')
    if (!topBannerStr || !bottomBannerStr || !videoStr) return alert('Validation Error: You must attach and correctly validate all three media files.')

    setIsSubmittingAd(true)
    
    if (isAdmin) {
      try {
        const expiryMs = Date.now() + (adminDurationDays * 86400000)
        const adsRef = dbRef(db, `ads/${currentUser.uid}`)
        const newAd = {
          status: 'Aired', date: new Date().toISOString(), expiryEpoch: expiryMs,
          topBannerStr, bottomBannerStr, videoUrl: videoStr, targetUrl: adTargetUrl, paymentId: 'ADMIN_OVERRIDE_FREE', remark: 'Admin Fast-Track Deploy'
        }
        const adPush = await push(adsRef, newAd)
        await set(dbRef(db, `active_ads/${adPush.key}`), { targetUrl: adTargetUrl, topBannerStr, bottomBannerStr, videoUrl: videoStr, sha256: 'pending' })
        
        alert('Admin Override Deployed. Live globally in rotation.')
        setAdTargetUrl(''); setTopBannerStr(''); setBottomBannerStr(''); setVideoStr(''); setShowAdStudio(false)
      } catch (e) { console.error(e); alert('Admin Deployment Failed.') }
      setIsSubmittingAd(false); return
    }

    try {
      const orderResponse = await window.api.createRazorpayOrder(49)
      if (!orderResponse.success) throw new Error(orderResponse.error)

      const options = {
        key: orderResponse.keyId, amount: orderResponse.order.amount, currency: orderResponse.order.currency,
        name: 'VITSN Ad Network', description: '30-Day Campaign Verification', order_id: orderResponse.order.id, prefill: { email: currentUser.email },
        handler: async (response: any) => {
          const verify = await window.api.verifyRazorpayPayment(response.razorpay_order_id, response.razorpay_payment_id, response.razorpay_signature)
          if (verify.success) {
            const adsRef = dbRef(db, `ads/${currentUser.uid}`)
            await push(adsRef, {
              status: 'Pending', date: new Date().toISOString(),
              topBannerStr, bottomBannerStr, videoUrl: videoStr, targetUrl: adTargetUrl, paymentId: response.razorpay_payment_id, remark: 'Awaiting Admin Review'
            })
            await push(dbRef(db, `users/${currentUser.uid}/history`), { date: new Date().toISOString(), type: '30-Day Ad Submission Fee', orderId: response.razorpay_order_id, paymentId: response.razorpay_payment_id, amount: '₹49' })
            
            setAdTargetUrl(''); setTopBannerStr(''); setBottomBannerStr(''); setVideoStr('')
            alert('Ad Submitted Successfully. Awaiting Admin Approval.')
          } else { alert('Security Error: Payment verification failed.') }
          setIsSubmittingAd(false)
        }, theme: { color: '#0ea5e9' }
      }
      const rzp = new (window as any).Razorpay(options)
      rzp.on('payment.failed', function () { alert(`Payment Failed`); setIsSubmittingAd(false) })
      rzp.open()
    } catch (error: any) { alert('System Error: Could not initialize payment gateway.'); setIsSubmittingAd(false) }
  }

  const handleAdRenewal = async (ad: AdCampaign) => {
    if (!currentUser) return alert('CRITICAL: Login required.')
    if (ad.status !== 'Terminated' && ad.status !== 'Rejected') return alert('Campaign is still active or pending.')
    
    try {
      const orderResponse = await window.api.createRazorpayOrder(49)
      if (!orderResponse.success) throw new Error(orderResponse.error)

      const options = {
        key: orderResponse.keyId, amount: orderResponse.order.amount, currency: orderResponse.order.currency,
        name: 'VITSN Ad Network', description: 'Campaign Renewal (30 Days)', order_id: orderResponse.order.id, prefill: { email: currentUser.email },
        handler: async (response: any) => {
          const verify = await window.api.verifyRazorpayPayment(response.razorpay_order_id, response.razorpay_payment_id, response.razorpay_signature)
          if (verify.success) {
            await update(dbRef(db, `ads/${currentUser.uid}/${ad.id}`), {
              status: 'Pending', date: new Date().toISOString(), paymentId: response.razorpay_payment_id, remark: 'Renewal Paid - Awaiting Review'
            })
            await push(dbRef(db, `users/${currentUser.uid}/history`), { date: new Date().toISOString(), type: 'Ad Campaign Renewal', orderId: response.razorpay_order_id, paymentId: response.razorpay_payment_id, amount: '₹49' })
            alert('Renewal Submitted Successfully. Awaiting Admin Approval.')
          } else { alert('Security Error: Payment verification failed.') }
        }, theme: { color: '#0ea5e9' }
      }
      const rzp = new (window as any).Razorpay(options)
      rzp.on('payment.failed', function () { alert(`Payment Failed`) })
      rzp.open()
    } catch (error: any) { alert('System Error: Could not initialize payment gateway.') }
  }

  const handleLogin = async () => {
    if (isLoggingIn) return; setIsLoggingIn(true)
    try {
      googleProvider.setCustomParameters({ prompt: 'select_account' })
      await signInWithPopup(auth, googleProvider)
    } catch (error: any) { if (error.code !== 'auth/cancelled-popup-request' && error.code !== 'auth/popup-closed-by-user') alert('Authentication Failed: ' + error.message) } 
    finally { setIsLoggingIn(false) }
  }

  const handleLogout = () => { signOut(auth); setShowAccountMenu(false) }

  const handleApplyCoupon = async () => {
    if (!currentUser) return alert('CRITICAL: Login required.')
    if (!couponInput.trim()) return alert('Error: Enter valid coupon.')
    setIsApplying(true)
    try {
      const couponRef = dbRef(db, `coupons/${couponInput.trim()}`)
      const snapshot = await get(couponRef)
      if (snapshot.exists() && snapshot.val().active) {
        await update(dbRef(db, `users/${currentUser.uid}`), { isPremium: true })
        await push(dbRef(db, `users/${currentUser.uid}/history`), { date: new Date().toISOString(), type: 'Coupon Redemption', code: couponInput.trim(), amount: '₹0' })
        setIsPremiumUser(true); if (isAdmin && simulateTier === 'free') setSimulateTier('premium'); alert('Coupon Applied.'); setCouponInput(''); setShowNagModal(false)
      } else { alert('Verification Failed.') }
    } catch (error: any) { alert(`System error`) } finally { setIsApplying(false) }
  }

  const handlePremiumUpgrade = async () => {
    if (!currentUser) return alert('CRITICAL: Login required.')
    try {
      const orderResponse = await window.api.createRazorpayOrder(19)
      if (!orderResponse.success) throw new Error(orderResponse.error)
      const options = {
        key: orderResponse.keyId, amount: orderResponse.order.amount, currency: orderResponse.order.currency,
        name: 'VITSN Batch Printer', description: 'Premium Lifetime Upgrade', order_id: orderResponse.order.id, prefill: { email: currentUser.email },
        handler: async (response: any) => {
          const verify = await window.api.verifyRazorpayPayment(response.razorpay_order_id, response.razorpay_payment_id, response.razorpay_signature)
          if (verify.success) {
            await update(dbRef(db, `users/${currentUser.uid}`), { isPremium: true })
            await push(dbRef(db, `users/${currentUser.uid}/history`), { date: new Date().toISOString(), type: 'Razorpay Order', orderId: response.razorpay_order_id, paymentId: response.razorpay_payment_id, amount: '₹19' })
            setIsPremiumUser(true); if (isAdmin && simulateTier === 'free') setSimulateTier('premium'); setShowNagModal(false); alert('Payment Verified.')
          } else { alert('Security Error.') }
        }, theme: { color: '#2563EB' }
      }
      const rzp = new (window as any).Razorpay(options)
      rzp.on('payment.failed', function () { alert(`Payment Failed`) })
      rzp.open()
    } catch (error: any) { alert('System Error.') }
  }

  const fetchPrinters = async (): Promise<void> => { try { const list = await window.api.getPrinters(); setPrinters(list) } catch (error) { console.error(error) } }

  const handleFileSelect = async (): Promise<void> => {
    try {
      const newFiles = await window.api.selectFiles()
      if (newFiles && newFiles.length > 0) {
        const filesWithState = newFiles.map((file) => ({ ...file, id: crypto.randomUUID(), selected: true, copies: 1, status: 'Pending' as const }))
        setFileQueue((prev) => [...prev, ...filesWithState])
      }
    } catch (error) { console.error(error) }
  }

  const removeFile = (id: string): void => setFileQueue((prev) => prev.filter((f) => f.id !== id))
  const toggleSelection = (id: string): void => setFileQueue((prev) => prev.map(f => f.id === id ? { ...f, selected: !f.selected } : f))
  const moveFile = (index: number, direction: 'up' | 'down'): void => {
    const updated = [...fileQueue]; const targetIndex = direction === 'up' ? index - 1 : index + 1
    if (targetIndex < 0 || targetIndex >= updated.length) return
    const temp = updated[index]; updated[index] = updated[targetIndex]; updated[targetIndex] = temp; setFileQueue(updated)
  }
  const updateCopies = (id: string, copies: number): void => {
    if (copies < 1) copies = 1; setFileQueue((prev) => prev.map(f => f.id === id ? { ...f, copies } : f))
  }

  const executeFinalOutput = async (targetPath: string, actionType: OutputAction): Promise<void> => {
    try {
      if (actionType === 'print') {
        setFileQueue((prev) => prev.map((f) => f.selected ? { ...f, status: 'Printing...' } : f))
        const result = await window.api.printFile(targetPath, selectedPrinter)
        if (result.success) setFileQueue((prev) => prev.map((f) => f.selected ? { ...f, status: 'Completed' } : f))
        else throw new Error(result.error)
      } else if (actionType === 'download') {
        const result = await window.api.saveCompiledPdf(targetPath)
        if (result.success) {
          setFileQueue((prev) => prev.map((f) => f.selected ? { ...f, status: 'Completed' } : f))
          const downloadedFilesCount = fileQueue.filter(f => f.selected).length
          await update(dbRef(db, 'telemetry'), { total_downloads: increment(downloadedFilesCount) }).catch(e => console.error(e))
        } else if (!result.canceled) { throw new Error(result.error) }
      } else if (actionType === 'preview') {
        const bufferArray = await window.api.readPdfBuffer(targetPath)
        const blob = new Blob([bufferArray], { type: 'application/pdf' })
        if (previewPdfSrc) URL.revokeObjectURL(previewPdfSrc) 
        const blobUrl = URL.createObjectURL(blob)
        setPdfPreviewSrc(blobUrl); setShowPdfModal(true); setFileQueue((prev) => prev.map((f) => f.selected ? { ...f, status: 'Completed' } : f))
      }
    } catch (error) { setFileQueue((prev) => prev.map((f) => f.selected ? { ...f, status: 'Failed' } : f)) }
    setIsProcessing(false); setPendingAction(null)
  }

  const initiateActionFlow = async (action: 'print' | 'download' | 'preview'): Promise<void> => {
    const selectedFiles = (fileQueue || []).filter(f => f.selected)
    if (selectedFiles.length === 0) return alert('Select at least one file to process.')

    if (action === 'print') {
      if (!selectedPrinter) return alert('CRITICAL: Select a target printer.')
      const targetHardware = (printers || []).find((p) => p.name === selectedPrinter)
      if (targetHardware && targetHardware.status !== 0 && !forceExecute) return alert(`CRITICAL: Hardware offline. Check "Bypass Printer Warnings".`)
    }

    setIsProcessing(true); setPendingAction(action); setFileQueue((prev) => prev.map((f) => f.selected ? { ...f, status: 'Processing...' } : f))
    const payload = { files: selectedFiles.map(f => ({ path: f.path, copies: f.copies })), collate: collateSets, autoFix: autoFixDuplex, smartDuplex: smartManualDuplex }

    if (activePremium || activeAdmin) {
      setShowPremiumLoading(true); const result = await window.api.processBatchPDF(payload); setShowPremiumLoading(false)
      if (!result.success || !result.outputPath) { alert(`Failed: ${result.error}`); setIsProcessing(false); setFileQueue((prev) => prev.map((f) => f.selected ? { ...f, status: 'Failed' } : f)); return }
      await executeFinalOutput(result.outputPath, action)
    } else {
      if (!adVideoSrc) { alert('Assets syncing. Please wait.'); setIsProcessing(false); setFileQueue((prev) => prev.map((f) => f.selected ? { ...f, status: 'Failed' } : f)); return }
      setAdTimer(30); setShowVideoAd(true)
      const result = await window.api.processBatchPDF(payload)
      if (!result.success || !result.outputPath) { alert(`Failed: ${result.error}`); setShowVideoAd(false); setIsProcessing(false); setFileQueue((prev) => prev.map((f) => f.selected ? { ...f, status: 'Failed' } : f)); return }
      setCompiledPdfPath(result.outputPath)
    }
  }

  const handleAdClose = async (): Promise<void> => {
    setShowVideoAd(false); if (globalAdLink) window.open(globalAdLink, '_blank'); if (compiledPdfPath && pendingAction) await executeFinalOutput(compiledPdfPath, pendingAction)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', fontFamily: 'sans-serif', color: '#e2e8f0', backgroundColor: '#121212' }}>
      <style>{`
        /* INJECTED: Global Reset to kill the white border */
        html, body, #root { 
          margin: 0; padding: 0; width: 100vw; height: 100vh; overflow: hidden; background-color: #121212; 
        }
        * { box-sizing: border-box; }

        @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
        ::-webkit-scrollbar { width: 8px; }
        ::-webkit-scrollbar-track { background: #1e1e2f; }
        ::-webkit-scrollbar-thumb { background: #475569; border-radius: 4px; }
        ::-webkit-scrollbar-thumb:hover { background: #64748b; }
        
        .tooltip-icon { 
          display: inline-flex; justify-content: center; align-items: center; 
          width: 16px; height: 16px; background: #38bdf8; color: #0f172a; 
          border-radius: 50%; font-size: 11px; font-weight: bold; cursor: help; 
          margin-left: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.5); 
        }
        
        .clickable-banner:hover { opacity: 0.9; }
      `}</style>

      {updateData.required && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', backgroundColor: 'rgba(0,0,0,0.95)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 999999 }}>
          <div style={{ backgroundColor: '#1e293b', width: '500px', borderRadius: '12px', padding: '30px', border: '2px solid #ef4444', textAlign: 'center', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.7)' }}>
            <h2 style={{ margin: '0 0 15px 0', color: '#ef4444' }}>⚠️ Mandatory System Update</h2>
            <p style={{ color: '#cbd5e1', marginBottom: '25px', lineHeight: '1.5' }}>Your version is outdated. Install version <strong>{updateData.version}</strong> securely.</p>
            <button onClick={() => window.location.href = updateData.url} style={{ padding: '12px 24px', backgroundColor: '#ef4444', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}>Download Update</button>
          </div>
        </div>
      )}

      <div style={{ backgroundColor: '#0f172a', padding: '12px 24px', borderBottom: '1px solid #334155', display: 'flex', justifyContent: 'space-between', alignItems: 'center', position: 'relative', zIndex: 50 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
          <h1 style={{ margin: 0, fontSize: '18px', color: '#f8fafc', fontWeight: '500', letterSpacing: '0.5px' }}>VITSN Batch Printer</h1>
          {activeAdmin && <span style={{ backgroundColor: '#ef4444', color: '#fff', padding: '2px 8px', borderRadius: '4px', fontSize: '12px', fontWeight: 'bold' }}>ADMIN</span>}
          {isAdmin && simulateTier !== 'admin' && <span style={{ backgroundColor: '#8b5cf6', color: '#fff', padding: '2px 8px', borderRadius: '4px', fontSize: '12px', fontWeight: 'bold' }}>TEST: {simulateTier.toUpperCase()}</span>}
        </div>

        <div style={{ position: 'relative' }}>
          <button onClick={() => currentUser ? setShowAccountMenu(!showAccountMenu) : handleLogin()} disabled={isLoggingIn} style={{ padding: '8px 16px', backgroundColor: currentUser ? '#1e293b' : isLoggingIn ? '#94a3b8' : '#ea4335', color: '#fff', border: '1px solid #334155', borderRadius: '6px', cursor: isLoggingIn ? 'wait' : 'pointer', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '8px', boxShadow: '0 2px 4px rgba(0,0,0,0.2)', transition: '0.2s' }}>
            {currentUser ? `👤 ${currentUser.email?.split('@')[0]} ▼` : isLoggingIn ? 'Connecting...' : 'Login with Google'}
          </button>

          {showAccountMenu && currentUser && (
            <div style={{ position: 'absolute', top: '100%', right: 0, marginTop: '12px', backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px', padding: '20px', width: '320px', boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.7)', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ borderBottom: '1px solid #334155', paddingBottom: '12px' }}>
                <span style={{ fontSize: '12px', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Account</span>
                <div style={{ fontSize: '15px', color: '#fff', fontWeight: 'bold', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: '4px' }}>{currentUser.email}</div>
              </div>

              {isAdmin && <button onClick={loadAdminData} style={{ padding: '10px', borderRadius: '6px', fontWeight: 'bold', border: 'none', cursor: 'pointer', backgroundColor: '#8b5cf6', color: '#fff' }}>Open Admin Dashboard</button>}

              {activePremium ? (
                <div style={{ backgroundColor: '#064e3b', color: '#10b981', padding: '12px', borderRadius: '6px', textAlign: 'center', fontWeight: 'bold', fontSize: '14px', border: '1px solid #047857' }}>✓ Premium Active</div>
              ) : activeAdmin ? (
                <div style={{ backgroundColor: '#4c1d95', color: '#c4b5fd', padding: '12px', borderRadius: '6px', textAlign: 'center', fontWeight: 'bold', fontSize: '14px', border: '1px solid #6d28d9' }}>Admin Master Clearance</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <input type="text" placeholder="Enter Coupon Code" value={couponInput} disabled={isApplying} onChange={(e) => setCouponInput(e.target.value)} style={{ padding: '10px 12px', borderRadius: '6px', border: '1px solid #475569', color: '#fff', backgroundColor: '#0f172a', fontSize: '14px', outline: 'none' }} />
                  <button onClick={handleApplyCoupon} disabled={isApplying || !couponInput.trim()} style={{ padding: '10px', borderRadius: '6px', fontWeight: 'bold', border: 'none', cursor: (isApplying || !couponInput.trim()) ? 'not-allowed' : 'pointer', backgroundColor: '#0ea5e9', color: '#fff', opacity: (isApplying || !couponInput.trim()) ? 0.6 : 1 }}>{isApplying ? 'Verifying...' : 'Apply Coupon'}</button>
                  <div style={{ textAlign: 'center', color: '#64748b', fontSize: '12px', margin: '4px 0' }}>— OR —</div>
                  <button onClick={handlePremiumUpgrade} disabled={isApplying} style={{ padding: '10px', border: 'none', borderRadius: '6px', fontWeight: 'bold', cursor: isApplying ? 'not-allowed' : 'pointer', backgroundColor: '#2563EB', color: 'white', opacity: isApplying ? 0.6 : 1 }}>Upgrade to Premium (₹19)</button>
                </div>
              )}

              <div style={{ borderTop: '1px solid #334155', paddingTop: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <button onClick={fetchPaymentHistory} style={{ background: 'none', border: 'none', color: '#38bdf8', cursor: 'pointer', textAlign: 'left', fontSize: '14px', padding: 0, fontWeight: '500' }}>Subscription History & Details</button>
                <button onClick={handleLogout} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', textAlign: 'left', fontSize: '14px', padding: 0, fontWeight: '500' }}>Logout / Switch Account</button>
              </div>
            </div>
          )}
        </div>
      </div>

      <div 
        className={globalAdLink ? 'clickable-banner' : ''}
        onClick={() => globalAdLink ? window.open(globalAdLink, '_blank') : null}
        style={{ width: '100%', height: '90px', backgroundColor: '#1e293b', display: 'flex', justifyContent: 'center', alignItems: 'center', borderBottom: '1px solid #334155', cursor: globalAdLink ? 'pointer' : 'default', overflow: 'hidden' }}
      >
        {renderedTopBanner && renderedTopBanner.startsWith('data:image') ? (
           <img src={renderedTopBanner} style={{ width: '728px', height: '90px', objectFit: 'contain' }} alt="Sponsor Banner" />
        ) : (
           <span style={{ color: '#64748b', fontWeight: 'bold', letterSpacing: '1px' }}>[ TOP BANNER AD SPACE ]</span>
        )}
      </div>

      <div style={{ padding: '2rem', maxWidth: '1000px', margin: '0 auto', flexGrow: 1, width: '100%', overflowY: 'auto' }}>
        <section style={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px', padding: '1.5rem', marginBottom: '2rem', boxShadow: '0 4px 6px rgba(0,0,0,0.3)' }}>
          <h3 style={{ marginTop: 0, color: '#e2e8f0', fontSize: '16px' }}>1. Select Printer & Settings</h3>
          <div style={{ display: 'flex', gap: '12px', marginBottom: '20px' }}>
            <button onClick={fetchPrinters} style={{ padding: '10px 20px', backgroundColor: '#334155', color: '#fff', border: '1px solid #475569', borderRadius: '6px', cursor: 'pointer' }} disabled={isProcessing}>Refresh Printers</button>
            <select style={{ flexGrow: 1, padding: '10px', backgroundColor: '#0f172a', color: '#f8fafc', border: '1px solid #475569', borderRadius: '6px', outline: 'none' }} value={selectedPrinter} onChange={(e) => setSelectedPrinter(e.target.value)} disabled={isProcessing}>
              <option value="" disabled>-- Select Hardware Target --</option>
              {(printers || []).map((p, i) => <option key={i} value={p.name}>{p.name} {p.status !== 0 ? '[Offline/Warning]' : ''}</option>)}
            </select>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px', borderTop: '1px solid #334155', paddingTop: '20px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <span style={{ color: '#94a3b8', fontSize: '13px', fontWeight: 'bold', textTransform: 'uppercase', display: 'flex', alignItems: 'center' }}>
                Printing Order
                <span className="tooltip-icon" title="Sets: [Doc1, Doc2], [Doc1, Doc2]. Files: [Doc1, Doc1], [Doc2, Doc2].">?</span>
              </span>
              <label style={{ fontSize: '14px', cursor: 'pointer', display: 'flex', alignItems: 'center' }}><input type="radio" name="collate" checked={collateSets} onChange={() => setCollateSets(true)} disabled={isProcessing} style={{ marginRight: '8px', accentColor: '#0ea5e9' }}/>Group by Sets</label>
              <label style={{ fontSize: '14px', cursor: 'pointer', display: 'flex', alignItems: 'center' }}><input type="radio" name="collate" checked={!collateSets} onChange={() => setCollateSets(false)} disabled={isProcessing} style={{ marginRight: '8px', accentColor: '#0ea5e9' }}/>Group by File</label>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <span style={{ color: '#94a3b8', fontSize: '13px', fontWeight: 'bold', textTransform: 'uppercase', display: 'flex', alignItems: 'center' }}>
                Special Features
              </span>
              <label style={{ fontSize: '14px', cursor: 'pointer', display: 'flex', alignItems: 'center', color: '#f87171' }}>
                <input type="checkbox" checked={forceExecute} onChange={(e) => setForceExecute(e.target.checked)} disabled={isProcessing} style={{ marginRight: '8px', accentColor: '#f87171' }}/>
                Bypass Offline Warnings
                <span className="tooltip-icon" title="Forces file to printer spooler even if Windows claims the printer is offline or out of paper.">?</span>
              </label>
              <label style={{ fontSize: '14px', cursor: 'pointer', display: 'flex', alignItems: 'center', color: smartManualDuplex ? '#10b981' : '#e2e8f0' }}>
                <input type="checkbox" checked={smartManualDuplex} onChange={(e) => setSmartManualDuplex(e.target.checked)} disabled={isProcessing} style={{ marginRight: '8px', accentColor: '#10b981' }}/>
                Smart Manual Duplex
                <span className="tooltip-icon" title="Auto-extracts odd pages, then lets you re-insert paper to print even pages in reverse.">?</span>
              </label>
              <label style={{ fontSize: '14px', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
                <input type="checkbox" checked={autoFixDuplex} onChange={(e) => setAutoFixDuplex(e.target.checked)} disabled={isProcessing || smartManualDuplex} style={{ marginRight: '8px', accentColor: '#0ea5e9', opacity: smartManualDuplex ? 0.4 : 1 }}/>
                Inject Blank Pages
                <span className="tooltip-icon" title="Adds a blank page to 3-page documents so the next document doesn't print on the back of it.">?</span>
              </label>
            </div>
          </div>
        </section>

        <section style={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px', padding: '1.5rem', boxShadow: '0 4px 6px rgba(0,0,0,0.3)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
            <button onClick={handleFileSelect} style={{ padding: '12px 24px', cursor: 'pointer', backgroundColor: '#2563eb', color: 'white', border: 'none', borderRadius: '6px', fontWeight: 'bold', boxShadow: '0 2px 4px rgba(37, 99, 235, 0.3)' }} disabled={isProcessing}>+ Add Files</button>
            <div style={{ display: 'flex', gap: '12px' }}>
              <button onClick={() => initiateActionFlow('preview')} style={{ padding: '12px 20px', cursor: 'pointer', backgroundColor: '#475569', color: 'white', border: 'none', borderRadius: '6px', fontWeight: 'bold' }} disabled={isProcessing || fileQueue.length === 0}>Preview</button>
              <button onClick={() => initiateActionFlow('download')} style={{ padding: '12px 20px', cursor: 'pointer', backgroundColor: '#0284c7', color: 'white', border: 'none', borderRadius: '6px', fontWeight: 'bold' }} disabled={isProcessing || fileQueue.length === 0}>Download</button>
              <button onClick={() => initiateActionFlow('print')} style={{ padding: '12px 24px', cursor: 'pointer', backgroundColor: '#059669', color: 'white', border: 'none', borderRadius: '6px', fontWeight: 'bold', boxShadow: '0 2px 4px rgba(5, 150, 105, 0.3)' }} disabled={isProcessing || fileQueue.length === 0}>Print Now</button>
            </div>
          </div>
          
          <div style={{ border: '1px solid #334155', borderRadius: '6px', overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ backgroundColor: '#0f172a', textAlign: 'left', borderBottom: '2px solid #334155' }}>
                  <th style={{ padding: '12px', width: '50px', textAlign: 'center', color: '#94a3b8' }}>Select</th>
                  <th style={{ padding: '12px', width: '80px', textAlign: 'center', color: '#94a3b8' }}>Order</th>
                  <th style={{ padding: '12px', width: '90px', textAlign: 'center', color: '#94a3b8' }}>Copies</th>
                  <th style={{ padding: '12px', color: '#94a3b8' }}>File Name (PDF, DOC)</th>
                  <th style={{ padding: '12px', color: '#94a3b8' }}>Status</th>
                  <th style={{ padding: '12px', textAlign: 'center', color: '#94a3b8' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {(fileQueue || []).length === 0 ? (
                  <tr><td colSpan={6} style={{ padding: '20px', textAlign: 'center', color: '#64748b' }}>The queue is empty. Click '+ Add Files'.</td></tr>
                ) : (
                  (fileQueue || []).map((file, idx) => (
                    <tr key={file.id} style={{ opacity: file.selected ? 1 : 0.5, borderBottom: '1px solid #334155', backgroundColor: '#1e293b' }}>
                      <td style={{ padding: '12px', textAlign: 'center' }}><input type="checkbox" checked={file.selected} onChange={() => toggleSelection(file.id)} disabled={isProcessing} style={{ cursor: 'pointer', width: '16px', height: '16px', accentColor: '#0ea5e9' }} /></td>
                      <td style={{ padding: '12px', textAlign: 'center' }}>
                        <button onClick={() => moveFile(idx, 'up')} disabled={idx === 0 || isProcessing} style={{ marginRight: '8px', cursor: idx === 0 ? 'default' : 'pointer', background: 'none', border: 'none', color: idx === 0 ? '#475569' : '#cbd5e1' }}>▲</button>
                        <button onClick={() => moveFile(idx, 'down')} disabled={idx === fileQueue.length - 1 || isProcessing} style={{ cursor: idx === fileQueue.length - 1 ? 'default' : 'pointer', background: 'none', border: 'none', color: idx === fileQueue.length - 1 ? '#475569' : '#cbd5e1' }}>▼</button>
                      </td>
                      <td style={{ padding: '12px', textAlign: 'center' }}><input type="number" min="1" value={file.copies} onChange={(e) => updateCopies(file.id, parseInt(e.target.value) || 1)} disabled={isProcessing || !file.selected} style={{ width: '60px', padding: '6px', borderRadius: '4px', border: '1px solid #475569', backgroundColor: '#0f172a', color: '#fff', textAlign: 'center', outline: 'none' }} /></td>
                      <td style={{ padding: '12px', fontWeight: '500', color: '#f8fafc', maxWidth: '250px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file.name}</td>
                      <td style={{ padding: '12px', fontWeight: 'bold', color: file.status === 'Completed' ? '#10b981' : (file.status === 'Failed' || file.status === 'Blocked') ? '#ef4444' : file.status === 'Processing...' ? '#38bdf8' : '#cbd5e1' }}>{file.status}</td>
                      <td style={{ padding: '12px', textAlign: 'center' }}><button onClick={() => removeFile(file.id)} disabled={isProcessing} style={{ color: '#ef4444', cursor: 'pointer', background: 'none', border: 'none', fontSize: '14px' }}>Remove</button></td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <div 
        className={globalAdLink ? 'clickable-banner' : ''}
        onClick={() => globalAdLink ? window.open(globalAdLink, '_blank') : null}
        style={{ width: '100%', height: '90px', backgroundColor: '#1e293b', display: 'flex', justifyContent: 'center', alignItems: 'center', borderTop: '1px solid #334155', position: 'relative', cursor: globalAdLink ? 'pointer' : 'default', overflow: 'hidden' }}
      >
        {renderedBottomBanner && renderedBottomBanner.startsWith('data:image') ? (
           <img src={renderedBottomBanner} style={{ width: '728px', height: '90px', objectFit: 'contain' }} alt="Sponsor Banner" />
        ) : (
           <span style={{ color: '#64748b', fontWeight: 'bold', letterSpacing: '1px' }}>[ BOTTOM BANNER AD SPACE ]</span>
        )}
        <button 
          onClick={(e) => {
            e.stopPropagation(); 
            if (!currentUser) return alert("You must login to access the Ad Studio.")
            setShowAdStudio(true)
          }}
          style={{ position: 'absolute', right: '20px', padding: '8px 16px', backgroundColor: '#0ea5e9', color: '#fff', border: 'none', borderRadius: '4px', fontSize: '12px', fontWeight: 'bold', cursor: 'pointer', zIndex: 10 }}
        >
          {isAdmin ? 'Admin Ad Studio' : (clientAds || []).length > 0 ? 'Manage Ads / Advertise' : 'Advertise Here (₹49)'}
        </button>
      </div>

      <footer style={{ backgroundColor: '#0f172a', padding: '12px', textAlign: 'center', fontSize: '13px', color: '#64748b', borderTop: '1px solid #1e293b' }}>
        © {new Date().getFullYear()} Mr. Yellapu Sampreeth Naidu. All rights reserved.
      </footer>

      {showNagModal && !activePremium && !activeAdmin && !updateData.required && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', backgroundColor: 'rgba(0,0,0,0.85)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 99999 }}>
          <div style={{ backgroundColor: '#1e293b', width: '500px', borderRadius: '12px', padding: '30px', border: '2px solid #2563EB', textAlign: 'center', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.7)' }}>
            <h2 style={{ margin: '0 0 15px 0', color: '#f8fafc' }}>Unlock Maximum Efficiency</h2>
            <p style={{ color: '#cbd5e1', marginBottom: '25px', lineHeight: '1.5' }}>
              You are using the Free Tier. Mandatory video advertisements apply before processing. Upgrade to Premium for a lifetime of ad-free processing.
            </p>
            <div style={{ display: 'flex', gap: '15px', justifyContent: 'center' }}>
              <button onClick={() => setShowNagModal(false)} style={{ padding: '12px 20px', backgroundColor: '#334155', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}>Continue Free</button>
              <button onClick={() => { setShowNagModal(false); handlePremiumUpgrade(); }} style={{ padding: '12px 24px', backgroundColor: '#2563EB', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', boxShadow: '0 4px 6px rgba(37,99,235,0.4)' }}>Upgrade Now (₹19)</button>
            </div>
          </div>
        </div>
      )}

      {/* AD STUDIO MODAL (CLIENT/ADMIN) */}
      {showAdStudio && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', backgroundColor: 'rgba(0,0,0,0.9)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 999999 }}>
          <div style={{ backgroundColor: '#1e293b', width: '800px', borderRadius: '12px', padding: '30px', border: isAdmin ? '1px solid #8b5cf6' : '1px solid #0ea5e9', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.7)', maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #334155', paddingBottom: '15px', marginBottom: '25px' }}>
              <h2 style={{ margin: 0, color: isAdmin ? '#a78bfa' : '#38bdf8', fontWeight: '400' }}>{isAdmin ? 'Admin Ad Deployment Studio' : 'Advertising Studio'}</h2>
              <button onClick={() => setShowAdStudio(false)} style={{ background: 'none', border: 'none', fontSize: '24px', cursor: 'pointer', color: '#94a3b8' }}>×</button>
            </div>
            
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '30px' }}>
              <div style={{ backgroundColor: '#0f172a', padding: '20px', borderRadius: '8px', border: '1px solid #334155' }}>
                <h3 style={{ margin: '0 0 15px 0', color: '#f8fafc', fontSize: '15px' }}>Create New Campaign</h3>
                
                <div style={{ display: 'flex', flexDirection: 'column', gap: '15px', marginBottom: '20px' }}>
                  {isAdmin && (
                    <div>
                      <label style={{ fontSize: '12px', color: '#a78bfa', fontWeight: 'bold' }}>Admin Override: Live Duration (Days)</label>
                      <input 
                        type="number" min="1" value={adminDurationDays} onChange={(e) => setAdminDurationDays(parseInt(e.target.value) || 30)}
                        style={{ width: '100%', padding: '8px', marginTop: '5px', borderRadius: '4px', border: '1px solid #6d28d9', backgroundColor: '#1e293b', color: '#f8fafc', outline: 'none' }} 
                      />
                    </div>
                  )}
                  <div>
                    <label style={{ fontSize: '12px', color: '#cbd5e1', fontWeight: 'bold' }}>Target Link (URL)</label>
                    <input 
                      type="url" placeholder="https://yourwebsite.com" value={adTargetUrl} onChange={(e) => setAdTargetUrl(e.target.value)}
                      style={{ width: '100%', padding: '8px', marginTop: '5px', borderRadius: '4px', border: '1px solid #475569', backgroundColor: '#1e293b', color: '#f8fafc', outline: 'none' }} 
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '12px', color: '#cbd5e1', fontWeight: 'bold' }}>Top Banner Image (Exactly 728x90 px)</label>
                    <input type="file" accept="image/*" onChange={(e) => handleFileChange(e, 'top')} style={{ width: '100%', marginTop: '5px', color: '#94a3b8', fontSize: '12px' }} />
                  </div>
                  <div>
                    <label style={{ fontSize: '12px', color: '#cbd5e1', fontWeight: 'bold' }}>Bottom Banner Image (Exactly 728x90 px)</label>
                    <input type="file" accept="image/*" onChange={(e) => handleFileChange(e, 'bottom')} style={{ width: '100%', marginTop: '5px', color: '#94a3b8', fontSize: '12px' }} />
                  </div>
                  <div>
                    <label style={{ fontSize: '12px', color: '#cbd5e1', fontWeight: 'bold' }}>Video Ad (Strict 16:9 Ratio, Max 5MB)</label>
                    <input type="file" accept="video/mp4" onChange={(e) => handleFileChange(e, 'video')} style={{ width: '100%', marginTop: '5px', color: '#94a3b8', fontSize: '12px' }} />
                  </div>
                </div>

                <button 
                  onClick={submitNewAdCampaign} disabled={isSubmittingAd}
                  style={{ width: '100%', padding: '12px', backgroundColor: isAdmin ? '#8b5cf6' : '#0ea5e9', color: '#fff', border: 'none', borderRadius: '6px', fontWeight: 'bold', cursor: isSubmittingAd ? 'wait' : 'pointer', opacity: isSubmittingAd ? 0.6 : 1 }}
                >
                  {isSubmittingAd ? 'Processing...' : isAdmin ? 'Force Deploy Override (Free)' : 'Submit Campaign (₹49)'}
                </button>
              </div>

              {!isAdmin && (
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <h3 style={{ margin: '0 0 15px 0', color: '#f8fafc', fontSize: '15px' }}>Campaign History</h3>
                  <div style={{ flexGrow: 1, backgroundColor: '#0f172a', borderRadius: '8px', border: '1px solid #334155', overflowY: 'auto', padding: '10px', maxHeight: '380px' }}>
                    {(clientAds || []).length === 0 ? (
                      <div style={{ color: '#64748b', fontSize: '13px', textAlign: 'center', marginTop: '50px' }}>No campaigns found.</div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        {(clientAds || []).map(ad => (
                          <div key={ad.id} style={{ backgroundColor: '#1e293b', padding: '12px', borderRadius: '6px', borderLeft: `4px solid ${ad.status === 'Aired' ? '#10b981' : ad.status === 'Pending' ? '#eab308' : '#ef4444'}` }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px' }}>
                              <strong style={{ color: '#f8fafc', fontSize: '13px' }}>ID: {ad.id?.slice(-6)}</strong>
                              <span style={{ fontSize: '11px', fontWeight: 'bold', color: ad.status === 'Aired' ? '#10b981' : ad.status === 'Pending' ? '#eab308' : '#ef4444' }}>{ad.status.toUpperCase()}</span>
                            </div>
                            <div style={{ color: '#94a3b8', fontSize: '11px', marginBottom: '4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Target: {ad.targetUrl}</div>
                            {ad.expiryEpoch && <div style={{ color: '#cbd5e1', fontSize: '11px', marginBottom: '4px' }}>Expires: {new Date(ad.expiryEpoch).toLocaleDateString()}</div>}
                            <div style={{ color: '#64748b', fontSize: '11px', marginBottom: ad.remark ? '4px' : '0' }}>Submitted: {new Date(ad.date || 0).toLocaleDateString()}</div>
                            {ad.remark && <div style={{ color: '#fbbf24', fontSize: '11px', borderTop: '1px dashed #475569', paddingTop: '4px', fontStyle: 'italic' }}>Admin: "{ad.remark}"</div>}
                            {(ad.status === 'Terminated' || ad.status === 'Rejected') && (
                            <button onClick={() => handleAdRenewal(ad)} style={{ marginTop: '8px', padding: '6px 12px', backgroundColor: '#0ea5e9', color: '#fff', border: 'none', borderRadius: '4px', fontSize: '11px', fontWeight: 'bold', cursor: 'pointer', width: '100%' }}>
                           ↻ Renew Campaign (₹49)
                           </button>
                           )}
                            
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ADMIN DASHBOARD MODAL */}
      {showAdminDashboard && isAdmin && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', backgroundColor: 'rgba(0,0,0,0.9)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 999999 }}>
          <div style={{ backgroundColor: '#1e293b', width: '950px', borderRadius: '12px', padding: '30px', border: '1px solid #8b5cf6', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.7)', maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #334155', paddingBottom: '15px', marginBottom: '25px' }}>
              <h2 style={{ margin: '0 0 15px 0', color: '#a78bfa', fontWeight: '400' }}>Master Admin Dashboard</h2>
              <button onClick={() => setShowAdminDashboard(false)} style={{ background: 'none', border: 'none', fontSize: '24px', cursor: 'pointer', color: '#94a3b8' }}>×</button>
            </div>

            <div style={{ backgroundColor: '#0f172a', padding: '20px', borderRadius: '8px', border: '1px solid #334155', marginBottom: '25px' }}>
              <h3 style={{ margin: '0 0 15px 0', color: '#f8fafc', fontSize: '14px', textTransform: 'uppercase' }}>🔧 App Tier Simulation (Testing)</h3>
              <div style={{ display: 'flex', gap: '20px' }}>
                <label style={{ color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center' }}><input type="radio" name="tier" checked={simulateTier === 'admin'} onChange={() => setSimulateTier('admin')} style={{ marginRight: '8px', accentColor: '#8b5cf6' }} />Admin Master</label>
                <label style={{ color: '#10b981', cursor: 'pointer', display: 'flex', alignItems: 'center' }}><input type="radio" name="tier" checked={simulateTier === 'premium'} onChange={() => setSimulateTier('premium')} style={{ marginRight: '8px', accentColor: '#10b981' }} />Premium Tier</label>
                <label style={{ color: '#94a3b8', cursor: 'pointer', display: 'flex', alignItems: 'center' }}><input type="radio" name="tier" checked={simulateTier === 'free'} onChange={() => { setSimulateTier('free'); setShowAdminDashboard(false); setShowNagModal(true); }} style={{ marginRight: '8px', accentColor: '#94a3b8' }} />Free Tier</label>
              </div>
            </div>
            
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '15px', marginBottom: '25px' }}>
              <div style={{ backgroundColor: '#0f172a', padding: '25px 20px', borderRadius: '8px', border: '1px solid #334155', textAlign: 'center' }}><div style={{ color: '#94a3b8', fontSize: '13px', textTransform: 'uppercase', marginBottom: '8px', fontWeight: 'bold' }}>Free Users</div><div style={{ color: '#f8fafc', fontSize: '32px', fontWeight: 'bold' }}>{adminStats.free}</div></div>
              <div style={{ backgroundColor: '#0f172a', padding: '25px 20px', borderRadius: '8px', border: '1px solid #10b981', textAlign: 'center' }}><div style={{ color: '#10b981', fontSize: '13px', textTransform: 'uppercase', marginBottom: '8px', fontWeight: 'bold' }}>Premium Users</div><div style={{ color: '#10b981', fontSize: '32px', fontWeight: 'bold' }}>{adminStats.paid}</div></div>
              <div style={{ backgroundColor: '#0f172a', padding: '25px 20px', borderRadius: '8px', border: '1px solid #0ea5e9', textAlign: 'center' }}><div style={{ color: '#0ea5e9', fontSize: '13px', textTransform: 'uppercase', marginBottom: '8px', fontWeight: 'bold' }}>Files Downloaded</div><div style={{ color: '#0ea5e9', fontSize: '32px', fontWeight: 'bold' }}>{adminStats.downloads}</div></div>
            </div>

            <div style={{ backgroundColor: '#0f172a', padding: '20px', borderRadius: '8px', border: '1px solid #334155' }}>
              <h3 style={{ margin: '0 0 15px 0', color: '#f8fafc', fontSize: '14px', textTransform: 'uppercase' }}>Ad Campaign Review Queue</h3>
              {(adminAdQueue || []).length === 0 ? (
                <div style={{ color: '#64748b', fontSize: '13px', textAlign: 'center', padding: '20px' }}>No campaigns in system.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '400px', overflowY: 'auto', paddingRight: '10px' }}>
                  {(adminAdQueue || []).map(ad => (
                    <div key={ad.id} style={{ display: 'flex', flexDirection: 'column', gap: '10px', backgroundColor: '#1e293b', padding: '15px', borderRadius: '6px', borderLeft: `4px solid ${ad.status === 'Aired' ? '#10b981' : ad.status === 'Pending' ? '#eab308' : '#ef4444'}` }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <div style={{ color: '#f8fafc', fontWeight: 'bold', fontSize: '13px', marginBottom: '5px' }}>ID: {ad.id?.slice(-8)} | <span style={{ color: ad.status === 'Aired' ? '#10b981' : ad.status === 'Pending' ? '#eab308' : '#ef4444' }}>{ad.status.toUpperCase()}</span></div>
                          <div style={{ color: '#94a3b8', fontSize: '12px' }}>UID: {ad.uid}</div>
                          <div style={{ color: '#38bdf8', fontSize: '12px', marginTop: '4px', textDecoration: 'underline', cursor: 'pointer' }} onClick={() => window.open(ad.targetUrl, '_blank')}>Target: {ad.targetUrl}</div>
                        </div>
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <button onClick={() => setPreviewAdMedia(ad)} style={{ padding: '6px 12px', backgroundColor: '#3b82f6', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold', fontSize: '12px' }}>View Media</button>
                        </div>
                      </div>
                      
                      <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginTop: '10px', borderTop: '1px solid #334155', paddingTop: '10px' }}>
                        <input 
                          type="text" placeholder={ad.remark || "Enter admin remarks for client..."} 
                          value={adminRemarks[ad.id as string] || ''} 
                          onChange={(e) => setAdminRemarks(prev => ({...prev, [ad.id as string]: e.target.value}))}
                          style={{ flexGrow: 1, padding: '8px', borderRadius: '4px', border: '1px solid #475569', backgroundColor: '#0f172a', color: '#fff', fontSize: '12px', outline: 'none' }} 
                        />
                        <div style={{ display: 'flex', gap: '8px' }}>
                          {ad.status === 'Pending' && (
                            <><button onClick={() => handleAdminAdAction(ad, 'Aired')} style={{ padding: '6px 12px', backgroundColor: '#10b981', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold', fontSize: '12px' }}>Approve (30 Days)</button>
                            <button onClick={() => handleAdminAdAction(ad, 'Rejected')} style={{ padding: '6px 12px', backgroundColor: '#ef4444', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold', fontSize: '12px' }}>Reject</button></>
                          )}
                          {ad.status === 'Aired' && <button onClick={() => handleAdminAdAction(ad, 'Terminated')} style={{ padding: '6px 12px', backgroundColor: '#f97316', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold', fontSize: '12px' }}>Terminate Ad</button>}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ADMIN MEDIA PREVIEW OVERLAY */}
      {previewAdMedia && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', backgroundColor: 'rgba(0,0,0,0.95)', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', zIndex: 9999999 }}>
          <div style={{ width: '80%', maxWidth: '900px', backgroundColor: '#1e293b', padding: '20px', borderRadius: '12px', border: '1px solid #475569', display: 'flex', flexDirection: 'column', gap: '20px', maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #334155', paddingBottom: '10px' }}>
              <span style={{ color: '#38bdf8', fontWeight: 'bold' }}>Media Inspector (ID: {previewAdMedia.id?.slice(-6)})</span>
              <button onClick={() => setPreviewAdMedia(null)} style={{ background: 'none', border: 'none', color: '#ef4444', fontSize: '24px', cursor: 'pointer', fontWeight: 'bold' }}>×</button>
            </div>
            <div><span style={{ color: '#94a3b8', fontSize: '12px' }}>Top Banner:</span><img src={previewAdMedia.topBannerStr} style={{ width: '100%', marginTop: '5px', border: '1px solid #475569' }} alt="Top Banner" /></div>
            <div><span style={{ color: '#94a3b8', fontSize: '12px' }}>Bottom Banner:</span><img src={previewAdMedia.bottomBannerStr} style={{ width: '100%', marginTop: '5px', border: '1px solid #475569' }} alt="Bottom Banner" /></div>
            <div>
              <span style={{ color: '#94a3b8', fontSize: '12px' }}>Video (Base64 Memory Render):</span>
              <video src={previewAdMedia.videoUrl} controls style={{ width: '100%', marginTop: '5px', border: '1px solid #475569', maxHeight: '300px', backgroundColor: '#000' }} />
            </div>
          </div>
        </div>
      )}

      {/* PDF PREVIEW MODAL */}
      {showPdfModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', backgroundColor: 'rgba(0,0,0,0.9)', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', zIndex: 99999 }}>
          <div style={{ width: '90%', height: '90%', backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '10px', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ padding: '12px 20px', backgroundColor: '#0f172a', borderBottom: '1px solid #334155', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ color: '#f8fafc', fontWeight: 'bold', fontSize: '15px' }}>Document In-App Preview</span>
              <button onClick={() => setShowPdfModal(false)} style={{ background: 'none', border: 'none', color: '#ef4444', fontSize: '22px', cursor: 'pointer', fontWeight: 'bold' }}>×</button>
            </div>
            <iframe src={previewPdfSrc} style={{ width: '100%', height: '100%', border: 'none' }} title="PDF In-App Preview" />
          </div>
        </div>
      )}

      {/* LOADING OVERLAY */}
      {showPremiumLoading && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', backgroundColor: 'rgba(15, 23, 42, 0.95)', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', zIndex: 9999 }}>
          <div style={{ width: '60px', height: '60px', border: '4px solid #334155', borderTop: '4px solid #10b981', borderRadius: '50%', animation: 'spin 1s linear infinite', marginBottom: '25px' }}></div>
          <h2 style={{ color: '#f8fafc', marginBottom: '10px', fontWeight: '300' }}>Compiling Documents Securely...</h2>
        </div>
      )}

      {/* VIDEO AD MODAL */}
      {showVideoAd && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', backgroundColor: 'rgba(15, 23, 42, 0.98)', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', zIndex: 9999 }}>
          <h2 style={{ color: '#f8fafc', marginBottom: '25px', fontWeight: '300' }}>Advertisement (Mandatory Watch)</h2>
          {adVideoSrc && (
            <video 
              src={adVideoSrc} 
              autoPlay 
              loop 
              controls
              style={{ width: '100%', maxWidth: '800px', maxHeight: '400px', objectFit: 'contain', backgroundColor: '#000', border: '1px solid #334155', borderRadius: '8px', boxShadow: '0 10px 25px rgba(0,0,0,0.5)' }} 
            />
          )}
          <div style={{ marginTop: '35px' }}>
            {adTimer > 0 ? (
              <button disabled style={{ padding: '16px 32px', fontSize: '16px', backgroundColor: '#334155', color: '#94a3b8', border: '1px solid #475569', borderRadius: '8px', cursor: 'not-allowed' }}>Action unlocking in {adTimer} seconds...</button>
            ) : (
              <button onClick={handleAdClose} disabled={!compiledPdfPath} style={{ padding: '16px 32px', fontSize: '16px', backgroundColor: !compiledPdfPath ? '#334155' : '#10b981', color: !compiledPdfPath ? '#94a3b8' : 'white', border: 'none', borderRadius: '8px', cursor: !compiledPdfPath ? 'not-allowed' : 'pointer', fontWeight: 'bold', boxShadow: '0 4px 6px rgba(0,0,0,0.3)' }}>
                {!compiledPdfPath ? 'Finalizing Document...' : `Close Ad & Execute Action`}
              </button>
            )}
          </div>
        </div>
      )}

      {/* SUBSCRIPTION & TRANSACTION HISTORY MODAL */}
      {showHistoryModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', backgroundColor: 'rgba(0,0,0,0.85)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 99999 }}>
          <div style={{ backgroundColor: '#1e293b', width: '650px', borderRadius: '12px', padding: '25px', border: '1px solid #334155', boxShadow: '0 20px 25px rgba(0,0,0,0.7)', maxHeight: '80vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #334155', paddingBottom: '12px', marginBottom: '20px' }}>
              <h3 style={{ margin: 0, color: '#f8fafc', fontWeight: '500' }}>Subscription & Transaction History</h3>
              <button onClick={() => setShowHistoryModal(false)} style={{ background: 'none', border: 'none', color: '#ef4444', fontSize: '22px', cursor: 'pointer', fontWeight: 'bold' }}>×</button>
            </div>
            
            {paymentHistory.length === 0 ? (
              <div style={{ color: '#94a3b8', textAlign: 'center', margin: '40px 0', fontSize: '14px' }}>No payment records or coupon redemptions found for this account.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {paymentHistory.map((item) => (
                  <div key={item.id} style={{ backgroundColor: '#0f172a', padding: '16px', borderRadius: '8px', border: '1px solid #334155', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ color: '#f8fafc', fontWeight: 'bold', fontSize: '14px' }}>{item.type || 'Transaction'}</div>
                      <div style={{ color: '#64748b', fontSize: '12px', marginTop: '4px' }}>{item.date ? new Date(item.date).toLocaleString() : 'N/A'}</div>
                      {item.orderId && <div style={{ color: '#94a3b8', fontSize: '11px', marginTop: '2px' }}>Order ID: {item.orderId}</div>}
                      {item.paymentId && <div style={{ color: '#94a3b8', fontSize: '11px' }}>Payment ID: {item.paymentId}</div>}
                      {item.code && <div style={{ color: '#38bdf8', fontSize: '12px', marginTop: '2px' }}>Coupon Code: {item.code}</div>}
                    </div>
                    <div style={{ color: '#10b981', fontWeight: 'bold', fontSize: '16px' }}>{item.amount || '—'}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default App