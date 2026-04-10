/* ════════════════════════════════════════════
   서비스워커 — apt-price-v10
   ────────────────────────────────────────────
   전략:
   ① HTML/CSS/JS → Cache-First
   ② map.csv     → Network-Only (no-store) + 날짜 변경 감지
   ③ 외부 도메인 → 무시
   ④ CSV 날짜 변경 감지 → 앱에 postMessage + 푸시 알림
════════════════════════════════════════════ */
const CACHE = 'apt-price-v10';
const STATIC = [
    './',
    './index.html',
    './css/common.css',
    './js/app.js',
    './manifest.json',
];

/* ── install ── */
self.addEventListener('install', e => {
    e.waitUntil(
        caches.open(CACHE).then(c => c.addAll(STATIC))
    );
    self.skipWaiting();
});

/* ── activate: 구버전 캐시 삭제 ── */
self.addEventListener('activate', e => {
    e.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
        )
    );
    self.clients.claim();
});

/* ── fetch ── */
self.addEventListener('fetch', e => {
    const url = new URL(e.request.url);

    /* 외부 도메인 무시 */
    if (url.origin !== self.location.origin) return;

    /* CSV: Network-Only (no-store) + 날짜 변경 감지 */
    if (url.pathname.endsWith('map.csv')) {
        e.respondWith(handleCsvFetch(e.request));
        return;
    }

    /* 정적 자산: Cache-First */
    e.respondWith(
        caches.match(e.request).then(cached => {
            if (cached) return cached;
            return fetch(e.request).then(res => {
                if (res.ok) {
                    const clone = res.clone();
                    caches.open(CACHE).then(c => c.put(e.request, clone));
                }
                return res;
            });
        })
    );
});

/* CSV fetch + 날짜 변경 감지 */
async function handleCsvFetch(request) {
    const res = await fetch(request, { cache: 'no-store' });

    try {
        /* Last-Modified 헤더로 날짜 비교 */
        const lastMod = res.headers.get('last-modified') || '';
        const stored  = await getStore('csv_last_mod');

        if (lastMod && stored && lastMod !== stored) {
            /* CSV가 변경됨 → 앱 탭에 알림 + 푸시 알림 */
            await setStore('csv_last_mod', lastMod);
            notifyClients('CSV_UPDATED', lastMod);
            sendPushNotification();
        } else if (lastMod && !stored) {
            /* 최초 기록 */
            await setStore('csv_last_mod', lastMod);
        }
    } catch (_) {}

    return res;
}

/* ── 앱 탭들에 메시지 전송 ── */
function notifyClients(type, data) {
    self.clients.matchAll({ type: 'window' }).then(clients => {
        clients.forEach(c => c.postMessage({ type, data }));
    });
}

/* ── 푸시 알림 표시 (앱이 포그라운드여도 표시) ── */
async function sendPushNotification() {
    const opts = {
        body: '최신 KB 아파트 시세가 업데이트되었습니다.',
        icon: './icons/icon-192.png',
        badge: './icons/icon-96.png',
        tag: 'csv-update',       /* 동일 tag → 중복 알림 대체 */
        renotify: true,
        requireInteraction: false,
        data: { url: self.registration.scope },
    };
    try {
        await self.registration.showNotification('📊 아파트 시세 업데이트', opts);
    } catch (_) {}
}

/* ── push 이벤트 (OneSignal 등 외부 푸시 수신 시) ── */
self.addEventListener('push', e => {
    let payload = { title: '📊 아파트 시세 업데이트', body: '최신 시세를 확인하세요.' };
    try { payload = e.data?.json() || payload; } catch (_) {}

    e.waitUntil(
        self.registration.showNotification(payload.title, {
            body: payload.body,
            icon: './icons/icon-192.png',
            badge: './icons/icon-96.png',
            tag: 'csv-update',
            data: { url: self.registration.scope },
        })
    );
});

/* ── 알림 클릭 → 앱 포커스 또는 열기 ── */
self.addEventListener('notificationclick', e => {
    e.notification.close();
    const target = e.notification.data?.url || self.registration.scope;
    e.waitUntil(
        self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
            const existing = clients.find(c => c.url.startsWith(self.registration.scope));
            if (existing) return existing.focus();
            return self.clients.openWindow(target);
        })
    );
});

/* ── IndexedDB 간단 KV 저장 (SW에선 localStorage 사용 불가) ── */
function getStore(key) {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open('sw-store', 1);
        req.onupgradeneeded = e => e.target.result.createObjectStore('kv');
        req.onsuccess = e => {
            const tx = e.target.result.transaction('kv', 'readonly');
            const r  = tx.objectStore('kv').get(key);
            r.onsuccess = () => resolve(r.result ?? null);
            r.onerror   = () => resolve(null);
        };
        req.onerror = () => resolve(null);
    });
}
function setStore(key, val) {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open('sw-store', 1);
        req.onupgradeneeded = e => e.target.result.createObjectStore('kv');
        req.onsuccess = e => {
            const tx = e.target.result.transaction('kv', 'readwrite');
            tx.objectStore('kv').put(val, key);
            tx.oncomplete = resolve;
            tx.onerror    = reject;
        };
        req.onerror = reject;
    });
}

/* ════════════════════════════════════════════
   Web Push 알림 핸들러
════════════════════════════════════════════ */
self.addEventListener('push', e => {
    let data = {};
    try { data = e.data ? e.data.json() : {}; } catch (_) {}
    const title   = data.title   || 'KB 아파트 시세표';
    const message = data.message || data.body || '새로운 시세 데이터가 업데이트되었습니다!';
    e.waitUntil(
        self.registration.showNotification(title, {
            body: message,
            icon:  './icon-192.png',
            badge: './icon-192.png',
            tag:   'apt-update',
            requireInteraction: false,
            data:  { url: self.registration.scope }
        })
    );
});

/* 알림 클릭 → 앱 포커스 or 새창 */
self.addEventListener('notificationclick', e => {
    e.notification.close();
    const target = e.notification.data?.url || self.registration.scope;
    e.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
            const found = list.find(c => c.url.startsWith(target));
            return found ? found.focus() : clients.openWindow(target);
        })
    );
});
