import assert from 'node:assert/strict';

// Testa a integração JavaScript com respostas controladas do plugin, sem simular hardware.
export async function testNativeFlows(browser, origin, csv, pass) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  await context.route('**/*', route => {
    const url = route.request().url();
    if (url.startsWith(origin)) return route.continue();
    if (url.includes('radares.csv')) return route.fulfill({ status: 200, body: csv });
    return route.fulfill({ status: 503, body: 'fixture' });
  });
  await context.addInitScript(() => {
    window.androidBridge = {};
    const state = window.__native = { listeners: {}, calls: [], running: false };
    const promises = ['getStatus', 'requestPermissions', 'requestNotificationPermission', 'setRadars',
      'setPreferences', 'setAppVisible', 'start', 'stop', 'clearLocalData', 'setRoadNetwork', 'cacheRoadNetwork'];
    window.Capacitor = {
      PluginHeaders: [{ name: 'RadarTracking', methods: [
        ...promises.map(name => ({ name, rtype: 'promise' })), { name: 'addListener', rtype: 'callback' }
      ] }],
      nativeCallback(plugin, method, options, callback) {
        state.listeners[options.eventName] = callback;
        return Promise.resolve(options.eventName);
      },
      async nativePromise(plugin, method, options) {
        state.calls.push(method);
        if (method === 'requestPermissions') return { fineLocationGranted: true, notificationsGranted: true };
        if (method === 'getStatus') return { running: state.running, cachedRoadRegions: 0 };
        if (method === 'start') {
          if (state.delayStart) await new Promise(resolve => { state.releaseStart = resolve; state.startPending = true; });
          state.running = true;
          state.listeners.serviceEvent({ running: true, mode: 'started' });
          return { running: true };
        }
        if (method === 'stop') {
          if (state.failStop) throw new Error('fixture: stop failed');
          state.running = false;
          state.listeners.serviceEvent({ running: false, mode: 'stopped' });
        }
        if (method === 'clearLocalData') state.running = false;
        return {};
      }
    };
    window.__nativeFix = () => state.listeners.locationUpdate({ latitude: -23.55, longitude: -46.63,
      accuracy: 8, speedMps: 0, bearingDegrees: null, timestampMs: Date.now() });
  });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(origin);
    await page.waitForFunction(() => document.getElementById('datasetStatus').textContent.includes('131'));
    await page.locator('#startBtn').click();
    await page.waitForFunction(() => window.__native.running);
    await page.evaluate(() => window.__nativeFix());
    await page.waitForFunction(() => document.getElementById('speedLimit').textContent === '50');
    for (const mode of ['gpsLowAccuracy', 'gpsOutlier', 'gpsStale', 'gpsDisabled']) {
      await page.evaluate(mode => window.__native.listeners.serviceEvent({ mode, running: true }), mode);
      assert.equal(await page.locator('#speedLimit').textContent(), '—');
      assert.equal(await page.locator('#proximityRadar').isVisible(), false);
      await page.waitForTimeout(20);
      await page.evaluate(() => window.__nativeFix());
      assert.equal(await page.locator('#speedLimit').textContent(), '50');
    }
    pass('Ponte Android: rejeição, GPS desligado e recuperação atualizam painel e ilustração');
    const stopsBeforeHide = await page.evaluate(() => window.__native.calls.filter(call => call === 'stop').length);
    await page.evaluate(() => {
      window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
      window.__native.listeners.serviceEvent({ mode: 'gpsRecovering', running: true,
        message: 'Renovando solicitação GPS' });
    });
    assert.equal(await page.evaluate(() => window.__native.running), true);
    assert.equal(await page.evaluate(() => window.__native.calls.filter(call => call === 'stop').length), stopsBeforeHide);
    await page.waitForTimeout(20);
    await page.evaluate(() => window.__nativeFix());
    assert.equal(await page.locator('#speedLimit').textContent(), '50');
    assert.equal(await page.locator('#stopBtn').isVisible(), true);
    pass('Ponte Android: suspensão da página e recuperação GPS preservam monitoramento ativo');
    await page.evaluate(() => { window.__native.failStop = true; });
    await page.locator('#stopBtn').click();
    await page.waitForFunction(() => document.getElementById('gpsError').textContent.includes('não confirmou'));
    assert.equal(await page.locator('#stopBtn').isVisible(), true);
    await page.evaluate(() => { window.__native.failStop = false; });
    await page.locator('#stopBtn').click();
    await page.waitForFunction(() => !window.__native.running);
    await page.waitForFunction(() => !document.getElementById('startBtn').classList.contains('hidden'));
    pass('Ponte Android: falha ao parar é informada e permite nova tentativa');
    await page.evaluate(() => { window.__native.delayStart = true; });
    await page.locator('#startBtn').click();
    await page.waitForFunction(() => window.__native.startPending);
    await page.locator('#settingsBtn').click();
    page.once('dialog', dialog => dialog.accept());
    await page.locator('#clearDataBtn').click();
    assert.equal(await page.evaluate(() => window.__native.calls.includes('clearLocalData')), false);
    await page.evaluate(() => window.__native.releaseStart());
    await page.waitForFunction(() => document.getElementById('datasetStatus').textContent === 'Cache apagado');
    assert.equal(await page.evaluate(() => window.__native.running), false);
    assert.equal(await page.locator('#stopBtn').isVisible(), false);
    const calls = await page.evaluate(() => window.__native.calls);
    assert.ok(calls.lastIndexOf('stop') < calls.lastIndexOf('clearLocalData'));
    assert.ok(calls.lastIndexOf('setRadars') < calls.lastIndexOf('clearLocalData'));
    assert.deepEqual(errors, []);
    pass('Ponte Android: limpeza durante início atrasado encerra serviço antes de apagar dados');
  } finally { await context.close(); }
}
