/* Service worker do CRM do Sérgio
   - Guarda o app no aparelho para abrir sem internet
   - Recebe as notificações enviadas pelo Supabase (lembretes e resumo do dia) */
const VERSAO = 'ce21c8a00d';
const CACHE = 'crm-sergio-' + VERSAO;
const ARQUIVOS = ['./', './index.html', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png', './icons/badge-96.png', './icons/logo-emblema.webp', './icons/logo-completa.webp'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ARQUIVOS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('crm-sergio-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

// Com internet: busca a versão mais nova (até 4 s). Sem internet: usa a cópia guardada.
async function paginaRedePrimeiro(req) {
  const cache = await caches.open(CACHE);
  try {
    const rede = await Promise.race([fetch(req), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 4000))]);
    if (rede && rede.ok) cache.put('./index.html', rede.clone());
    return rede;
  } catch (e) {
    return (await cache.match('./index.html')) || (await cache.match('./')) || Response.error();
  }
}
self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;   // Supabase e outros domínios: direto na rede
  if (req.mode === 'navigate') { e.respondWith(paginaRedePrimeiro(req)); return; }
  e.respondWith(caches.match(req, { ignoreSearch: true }).then(r => r || fetch(req)));
});

self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { title: 'CRM DO SÉRGIO', body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'CRM DO SÉRGIO', {
    body: d.body || '', tag: d.tag || undefined, renotify: !!d.tag,
    icon: './icons/icon-192.png', badge: './icons/badge-96.png', lang: 'pt-BR',
    data: { url: d.url || './?tab=agenda' }
  }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const alvo = new URL((e.notification.data && e.notification.data.url) || './', self.registration.scope).href;
  const tab = new URL(alvo).searchParams.get('tab');
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(lista => {
    const aberto = lista.find(c => c.url.startsWith(self.registration.scope));
    if (aberto) { aberto.postMessage({ tipo: 'abrirAba', tab }); return aberto.focus(); }
    return self.clients.openWindow(alvo);
  }));
});
