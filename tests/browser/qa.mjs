import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { testNativeFlows } from './native-flows.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.RADAR_PLAYWRIGHT_PATH || 'playwright');
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const root = path.join(projectRoot, 'www');
const out = path.resolve(process.env.RADAR_QA_OUTPUT || path.join(projectRoot, 'qa-results'));
await mkdir(out, { recursive: true });
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const file = path.resolve(root, '.' + (url.pathname === '/' ? '/index.html' : url.pathname));
  if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
  try {
    const data = await readFile(file);
    res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' })[path.extname(file)] || 'application/octet-stream');
    res.end(data);
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
const checks = [];
const pass = name => { checks.push(name); console.log('OK: ' + name); };
const csv = ['id,lat,lng,direction,limit,active,kind,source',
  'near,-23.549,-46.63,180,50,true,FIXED,Teste ficticio',
  ...Array.from({ length: 130 }, (_, i) => `r${i},${-23.53 + i * .002},-46.63,180,60,true,FIXED,Teste ficticio`)].join('\n');
try {
  browser = await chromium.launch({ executablePath: process.env.RADAR_BROWSER_EXECUTABLE || undefined, headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block', reducedMotion: 'reduce' });
  await context.route('**/*', route => {
    const url = route.request().url();
    if (url.startsWith(origin)) return route.continue();
    if (url.includes('radares.csv')) return route.fulfill({ status: 200, contentType: 'text/plain', body: csv });
    if (url.includes('catalogo.json')) return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ufs":{"SP":{"built_at":"2026-11-05"}}}' });
    return route.fulfill({ status: 503, body: 'Offline fixture' });
  });
  await context.addInitScript(() => {
    window.__gpsCallbacks = new Map();
    window.__gpsNext = 0;
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: {
      watchPosition(success, error) { const id = ++window.__gpsNext; window.__gpsCallbacks.set(id, { success, error }); return id; },
      clearWatch(id) { window.__gpsCallbacks.delete(id); }
    } });
    window.__feedGps = (overrides = {}, timestamp = Date.now()) => {
      const coords = { latitude: -23.55, longitude: -46.63, accuracy: 8, heading: null, speed: 0, ...overrides };
      for (const { success } of window.__gpsCallbacks.values()) success({ coords, timestamp });
    };
    window.__spoken = [];
    if (window.speechSynthesis) {
      window.speechSynthesis.speak = message => window.__spoken.push(message.text);
      window.speechSynthesis.cancel = () => {};
    }
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin);
  await page.waitForFunction(() => document.getElementById('datasetStatus').textContent.includes('131'));
  pass('Inicialização e carregamento da base de teste');
  assert.equal(await page.evaluate(() => document.getElementById('startBtn').getBoundingClientRect().bottom < document.querySelector('.mobile-nav').getBoundingClientRect().top), true,
    'Iniciar deve ficar inteiramente visível antes de obter GPS');
  await page.screenshot({ path: path.join(out, '01-mobile-inicial.png'), fullPage: true });
  await page.locator('#startBtn').click();
  await page.evaluate(() => window.__feedGps());
  await page.waitForFunction(() => document.getElementById('distanceValue').textContent.includes('111'));
  assert.equal(await page.locator('#speedLimit').textContent(), '50');
  assert.match(await page.locator('#distanceTypeLabel').textContent(), /linha reta/);
  assert.equal(await page.evaluate(() => window.__spoken.length), 0);
  pass('GPS parado sem OSM: 111 m, limite 50 e nenhuma fala automática');
  const marker = page.locator('#proximityRadar');
  assert.equal(await marker.isVisible(), true);
  const initialLeft = await marker.evaluate(el => parseFloat(el.style.left));
  assert.match(await page.locator('#proximityMode').textContent(), /Linha reta/);
  await page.waitForTimeout(40);
  await page.evaluate(() => window.__feedGps({ latitude: -23.5495 }));
  const closerLeft = await marker.evaluate(el => parseFloat(el.style.left));
  assert.ok(closerLeft < initialLeft, 'Marcador deve se aproximar do carro');
  assert.match(await page.locator('#proximityDistance').textContent(), /56 m/);
  await page.waitForTimeout(40);
  await page.evaluate(() => window.__feedGps());
  const fartherLeft = await marker.evaluate(el => parseFloat(el.style.left));
  assert.ok(fartherLeft > closerLeft, 'Marcador deve recuar ao se afastar');
  await page.waitForTimeout(40);
  await page.evaluate(() => window.__feedGps({ accuracy: 200 }));
  assert.equal(await marker.isVisible(), false);
  await page.waitForTimeout(40);
  await page.evaluate(() => window.__feedGps());
  assert.equal(await marker.isVisible(), true);
  assert.equal(await marker.evaluate(el => getComputedStyle(el).transitionDuration), '0s');
  assert.match(await page.locator('#mainNotice').textContent(), /GPS recuperada/);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.waitForTimeout(40);
  await page.evaluate(() => window.__feedGps());
  assert.equal(await marker.evaluate(el => getComputedStyle(el).transitionDuration), '0.65s');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  pass('Ilustração 2D acompanha aproximação/afastamento reais da fixture, oculta GPS recusado e respeita movimento reduzido');
  await page.locator('#radarProximity').screenshot({ path: path.join(out, '09-ilustracao-radar.png') });
  await page.screenshot({ path: path.join(out, '02-mobile-referencia.png'), fullPage: true });
  await page.screenshot({ path: path.join(out, '10-painel-viewport.png'), fullPage: false });
  const primaryActionFits = await page.evaluate(() => document.getElementById('stopBtn').getBoundingClientRect().bottom < document.querySelector('.mobile-nav').getBoundingClientRect().top);
  assert.equal(primaryActionFits, true, 'A ação principal deve aparecer acima da navegação em 390 × 844');
  await page.locator('#settingsBtn').click();
  await page.locator('#prefContrastToggle').check();
  await page.locator('#saveSettingsBtn').click();
  await page.screenshot({ path: path.join(out, '11-mobile-alto-contraste.png'), fullPage: false });
  await page.locator('#settingsBtn').click();
  await page.locator('#prefContrastToggle').uncheck();
  await page.locator('#saveSettingsBtn').click();
  pass('Visual: controles principais cabem em 390 × 844; alto contraste pode ser aplicado e removido');
  const nav = screen => page.locator(`.mobile-nav [data-screen-link="${screen}"]`);
  await nav('proximos').click();
  assert.ok(await page.locator('.nearby-item').count() > 0);
  await page.screenshot({ path: path.join(out, '03-mobile-radares.png'), fullPage: true });
  await nav('mapa').click();
  await page.locator('#toggleAccuracyBtn').click();
  assert.equal(await page.locator('#toggleAccuracyBtn').getAttribute('aria-pressed'), 'false');
  await page.locator('#toggleTrailBtn').click();
  assert.equal(await page.locator('#toggleTrailBtn').getAttribute('aria-pressed'), 'true');
  await page.locator('#expandMapBtn').click();
  assert.equal(await page.locator('#expandMapBtn').getAttribute('aria-expanded'), 'true');
  await page.locator('#expandMapBtn').click();
  await page.locator('#locateMapBtn').click();
  pass('Mapa: precisão, trilha, expansão e centralização');
  await page.screenshot({ path: path.join(out, '04-mobile-mapa.png'), fullPage: true });
  await nav('via').click();
  await page.locator('#simRunBtn').click();
  await page.waitForFunction(() => document.getElementById('simRunBtn').textContent === 'Executar novamente');
  assert.match(await page.locator('#simEventList').textContent(), /FAR|MID|NEAR/);
  await page.locator('#simResetBtn').click();
  assert.match(await page.locator('#simProgressText').textContent(), /^0 /);
  for (const scenario of ['parallel', 'stopped']) {
    await page.locator('#simScenario').selectOption(scenario);
    await page.locator('#simRunBtn').click();
    await page.waitForFunction(() => document.getElementById('simRunBtn').textContent === 'Executar novamente');
    assert.match(await page.locator('#simEventList').textContent(), /Nenhum aviso/);
  }
  pass('Simulador: via única alerta; pistas paralelas e parado não alertam; reinício funciona');
  await page.screenshot({ path: path.join(out, '05-mobile-diagnostico.png'), fullPage: true });
  await page.locator('#settingsBtn').click();
  assert.equal(await page.evaluate(() => document.activeElement.id), 'closeSettingsBtn');
  await page.keyboard.press('Shift+Tab');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'saveSettingsBtn');
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'closeSettingsBtn');
  await page.locator('#prefTierFar').selectOption('800');
  await page.locator('#voiceVolSlider').fill('45');
  await page.locator('#testVoiceBtn').click();
  assert.equal(await page.evaluate(() => window.__spoken.length), 1);
  await page.screenshot({ path: path.join(out, '06-mobile-ajustes.png'), fullPage: true });
  await page.locator('#saveSettingsBtn').click();
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('radar-alert:settings')).far), 800);
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('radar-alert:settings')).volume), 45);
  await page.locator('#settingsBtn').click();
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'settingsBtn');
  pass('Preferências: volume, distância, fala simulada, persistência, foco e Escape');
  await nav('painel').click();
  await page.locator('#stopBtn').click();
  assert.equal(await page.locator('#speedLimit').textContent(), '—');
  assert.equal(await page.locator('#proximityRadar').isVisible(), false);
  assert.equal(await page.evaluate(() => window.__gpsCallbacks.size), 0);
  assert.equal(await page.locator('#currentSpeed').textContent(), '—');
  assert.equal(await page.locator('.nearby-item').count(), 0);
  pass('Parar monitoramento cancela GPS e limpa o radar do painel');
  await page.reload();
  await page.waitForFunction(() => document.getElementById('datasetStatus').textContent.includes('131'));
  await page.locator('#settingsBtn').click();
  assert.equal(await page.locator('#prefTierFar').inputValue(), '800');
  assert.equal(await page.locator('#voiceVolSlider').inputValue(), '45');
  await page.keyboard.press('Escape');
  pass('Preferências recuperadas após recarregar');
  await page.locator('#startBtn').click();
  await page.evaluate(() => window.__feedGps({}, Date.now() - 120000));
  assert.equal(await page.locator('#speedLimit').textContent(), '—');
  assert.equal(await page.locator('#proximityRadar').isVisible(), false);
  assert.match(await page.locator('#mainNotice').textContent(), /GPS antiga/);
  await page.evaluate(() => window.__feedGps({}, Date.now() + 60000));
  assert.equal(await page.locator('#speedLimit').textContent(), '—');
  await page.evaluate(() => window.__feedGps());
  assert.equal(await page.locator('#speedLimit').textContent(), '50');
  pass('GPS antigo/futuro recusado antes da primeira posição; leitura atual recupera painel');
  await page.evaluate(() => { for (const { error } of window.__gpsCallbacks.values()) error({ code: 3 }); });
  assert.equal(await page.locator('#gpsError').isVisible(), true);
  await page.waitForTimeout(40);
  await page.evaluate(() => window.__feedGps());
  assert.equal(await page.locator('#gpsError').isVisible(), false);
  pass('Erro temporário GPS desaparece após leitura válida');
  await page.evaluate(() => { window.__oldGps = [...window.__gpsCallbacks.values()][0]; });
  await page.locator('#stopBtn').click();
  await page.locator('#startBtn').click();
  await page.evaluate(() => window.__oldGps.success({ coords: { latitude: -23.55, longitude: -46.63, accuracy: 8, speed: 0 }, timestamp: Date.now() }));
  assert.equal(await page.locator('#speedLimit').textContent(), '—');
  pass('Callback atrasado de sessão encerrada não contamina o reinício');
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => window.__feedGps({ speed: 6, heading: 0 }));
    await page.waitForTimeout(40);
  }
  assert.equal(await page.locator('body').evaluate(el => el.classList.contains('driving-mode')), true);
  pass('Modo direção entra após movimento consistente');
  await page.screenshot({ path: path.join(out, '08-mobile-direcao.png'), fullPage: true });
  await page.evaluate(() => { for (const { error } of window.__gpsCallbacks.values()) error({ code: 1, message: 'Permissão negada no teste' }); });
  await page.waitForFunction(() => document.getElementById('stopBtn').classList.contains('hidden'));
  assert.equal(await page.locator('#speedLimit').textContent(), '—');
  pass('Permissão GPS negada encerra a sessão e remove valores anteriores');
  await page.locator('#startBtn').click();
  await page.evaluate(() => window.__feedGps());
  const layout = [];
  for (const width of [320, 360, 390, 430, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const screen of ['painel', 'mapa', 'via', 'proximos']) {
      await page.locator(`${width <= 820 ? '.mobile-nav' : '.desktop-nav'} [data-screen-link="${screen}"]`).click();
      const sizes = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
      if (sizes.scroll > sizes.width + 1) console.log(await page.evaluate(() => [...document.querySelectorAll('body *')].map(el => ({ id: el.id, class: el.className, right: el.getBoundingClientRect().right, width: el.getBoundingClientRect().width })).filter(el => el.right > innerWidth + 1).slice(0, 15)));
      layout.push({ width, screen, ...sizes });
      assert.ok(sizes.scroll <= sizes.width + 1, `Overflow ${width}/${screen}: ${sizes.scroll}`);
      assert.equal(await page.locator(`main>[data-screen="${screen}"]`).isVisible(), true);
    }
  }
  pass('Layout: 4 telas sem rolagem horizontal em 320, 360, 390, 430, 768, 1024 e 1440 px');
  await page.locator('.desktop-nav [data-screen-link="painel"]').click();
  await page.locator('#stopBtn').click();
  await page.locator('#startBtn').click();
  await page.evaluate(() => window.__feedGps());
  await page.waitForFunction(() => document.getElementById('speedLimit').textContent === '50');
  await page.screenshot({ path: path.join(out, '07-desktop-painel.png'), fullPage: true });
  assert.deepEqual(errors, []);
  pass('Nenhuma exceção JavaScript durante os fluxos');
  const offlineContext = await browser.newContext({ serviceWorkers: 'allow' });
  await offlineContext.route('**/*.tile.openstreetmap.org/**', route => route.abort());
  await offlineContext.addInitScript(({ csv }) => {
    const realFetch = window.fetch.bind(window);
    window.fetch = (url, options) => {
      const address = String(url);
      if (address.includes('radares.csv')) return Promise.resolve(new Response(csv, { status: 200 }));
      if (address.includes('catalogo.json')) return Promise.resolve(new Response('{}', { status: 200 }));
      return realFetch(url, options);
    };
  }, { csv });
  const offlinePage = await offlineContext.newPage();
  await offlinePage.goto(origin);
  await offlinePage.waitForFunction(() => document.getElementById('datasetStatus').textContent.includes('131'));
  await offlinePage.evaluate(() => navigator.serviceWorker.ready);
  await offlinePage.reload();
  await offlinePage.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  await offlineContext.setOffline(true);
  await offlinePage.reload();
  await offlinePage.waitForFunction(() => document.getElementById('datasetStatus').textContent.includes('131'));
  assert.match(await offlinePage.locator('#datasetMeta').textContent(), /cache local/);
  pass('PWA reabre sem internet com app-shell e base local armazenados');
  await offlineContext.close();
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
  await page.waitForFunction(() => !document.getElementById('startBtn').classList.contains('hidden'));
  assert.equal(await page.locator('#speedLimit').textContent(), '—');
  assert.equal(await page.evaluate(() => window.__gpsCallbacks.size), 0);
  await page.locator('#startBtn').click();
  await page.evaluate(() => window.__feedGps());
  assert.equal(await page.locator('#speedLimit').textContent(), '50');
  pass('Suspensão da página limpa sessão e permite reinício');
  // Mantém a atualização pendente para reproduzir a corrida entre download e limpeza.
  await page.evaluate(() => {
    const original = window.fetch;
    window.__restoreFetch = () => { window.fetch = original; };
    window.fetch = (url, options) => {
      if (!String(url).includes('radares.csv')) return original(url, options);
      window.__pendingDownload = true;
      return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => {
        window.__downloadCancelled = true;
        reject(new DOMException('cancelled', 'AbortError'));
      }, { once: true }));
    };
  });
  await page.locator('#refreshBtn').click();
  await page.waitForFunction(() => window.__pendingDownload);
  await page.locator('#settingsBtn').click();
  page.once('dialog', dialog => dialog.accept());
  await page.locator('#clearDataBtn').click();
  await page.waitForFunction(() => document.getElementById('datasetStatus').textContent === 'Cache apagado');
  assert.equal(await page.evaluate(() => window.__downloadCancelled), true);
  assert.equal(await page.locator('#speedLimit').textContent(), '—');
  assert.equal(await page.locator('#radarCount').textContent(), '0');
  assert.equal(await page.locator('.radar-marker').count(), 0);
  assert.equal(await page.evaluate(() => localStorage.getItem('radar-alert:settings')), null);
  const recordCount = await page.evaluate(async () => {
    const databases = await indexedDB.databases();
    let total = 0;
    for (const entry of databases) {
      const db = await new Promise(resolve => { const request = indexedDB.open(entry.name); request.onsuccess = () => resolve(request.result); });
      for (const name of db.objectStoreNames) total += await new Promise(resolve => {
        const request = db.transaction(name).objectStore(name).count(); request.onsuccess = () => resolve(request.result);
      });
      db.close();
    }
    return total;
  });
  assert.equal(recordCount, 0);
  await page.locator('#settingsBtn').click();
  assert.equal(await page.locator('#voiceVolSlider').inputValue(), '100');
  assert.equal(await page.locator('#prefTierFar').inputValue(), '1000');
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.__restoreFetch());
  await page.locator('#refreshBtn').click();
  await page.waitForFunction(() => document.getElementById('datasetStatus').textContent.includes('131'));
  pass('Limpeza cancela download, esvazia IndexedDB/mapa, restaura preferências e permite atualização manual');
  assert.deepEqual(errors, []);
  const routePage = await context.newPage();
  routePage.on('pageerror', error => errors.push(error.message));
  let releaseRoad;
  const roadRequested = new Promise(resolve => {
    routePage.route('**/*', async route => {
      if (!route.request().url().includes('/api/interpreter')) return route.fallback();
      releaseRoad = () => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ elements: [
        { type: 'way', id: 10, nodes: [1, 2], tags: { highway: 'primary', name: 'Avenida Teste', oneway: 'yes' },
          geometry: [{ lat: -23.54, lon: -46.63 }, { lat: -23.56, lon: -46.63 }] }
      ] }) });
      resolve();
    });
  });
  await routePage.goto(origin);
  await routePage.waitForFunction(() => document.getElementById('datasetStatus').textContent.includes('131'));
  await routePage.locator('#startBtn').click();
  await routePage.evaluate(() => window.__feedGps({ latitude: -23.548, speed: 6, heading: 180 }));
  await roadRequested;
  await routePage.evaluate(() => window.__feedGps({ accuracy: 200 }));
  await releaseRoad();
  await routePage.waitForFunction(() => document.getElementById('diagLogBox').textContent.includes('Malha OSM carregada'));
  assert.equal(await routePage.evaluate(() => window.__spoken.length), 0);
  assert.equal(await routePage.locator('#speedLimit').textContent(), '—');
  pass('Resposta OSM atrasada após GPS recusado não dispara alerta nem restaura limite antigo');
  await routePage.waitForTimeout(40);
  await routePage.evaluate(() => window.__feedGps({ latitude: -23.548, speed: 6, heading: 180 }));
  await routePage.waitForFunction(() => document.getElementById('distanceTypeLabel').textContent === 'Distância pela via');
  assert.equal(await routePage.locator('#speedLimit').textContent(), '50');
  assert.match(await routePage.locator('#distanceValue').textContent(), /111/);
  assert.equal(await routePage.evaluate(() => window.__spoken.length), 1);
  for (let i = 0; i < 3; i++) {
    await routePage.waitForTimeout(40);
    await routePage.evaluate(() => window.__feedGps({ latitude: -23.548, speed: 6, heading: 180 }));
  }
  assert.equal(await routePage.evaluate(() => window.__spoken.length), 1);
  assert.match(await routePage.locator('#proximityMode').textContent(), /via/i);
  pass('Via OSM confirmada: 111 m, limite 50 e um alerta sem repetição nos fixes seguintes');
  await routePage.close();
  await testNativeFlows(browser, origin, csv, pass);
  await writeFile(path.join(out, 'report.json'), JSON.stringify({ checks, layout, errors }, null, 2));
} finally {
  await browser?.close();
  server.close();
}
