import { readFile, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const root = process.cwd();
const config = JSON.parse(await readFile(path.join(root, 'capacitor.config.json'), 'utf8'));
const packageName = config.appId.replaceAll('.', path.sep);
const installed = path.join(root, 'android', 'app', 'src', 'main', 'java', packageName);
const template = path.join(root, 'android-template', 'app', 'src', 'main', 'java', 'com', 'radalert', 'app');
const classes = ['MainActivity.java', 'RadarTrackingPlugin.java', 'RadarTrackingService.java',
  'RoadRegionSelector.java', 'RoadRegionStore.java', 'RoadSnapshotRevision.java', 'LiveFixPolicy.java', 'GpsRecoveryPolicy.java'];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
let errors = 0;
for (const name of classes) {
  try {
    const [reference, native] = await Promise.all([
      readFile(path.join(template, name)), readFile(path.join(installed, name))
    ]);
    if (hash(reference) === hash(native)) console.log(`OK: ${name}`);
    else { errors++; console.error(`DESATUALIZADO: ${name}`); }
  } catch {
    errors++;
    console.error(`AUSENTE: ${name} no projeto Android.`);
  }
}
const expected = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).version;
try {
  const index = await readFile(path.join(root, 'android/app/src/main/assets/public/index.html'), 'utf8');
  if (index.includes(`v${expected}`)) console.log(`OK: conteúdo Web v${expected} sincronizado no Android.`);
  else { errors++; console.error(`DESATUALIZADO: assets Web não indicam v${expected}.`); }
} catch {
  errors++;
  console.error('AUSENTE: index.html no assets/public do Android.');
}
if (errors) {
  console.error(`\n${errors} problema(s). Na pasta com package.json, execute npm run android:sync.`);
  process.exitCode = 1;
} else console.log('\nIntegração Android sincronizada. Ainda é necessário compilar e testar o APK no Android Studio.');
