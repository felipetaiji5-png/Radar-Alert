import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const config = JSON.parse(await readFile(path.join(root, 'capacitor.config.json'), 'utf8'));
const android = path.join(root, 'android');
const packagePath = config.appId.replaceAll('.', path.sep);
const javaDir = path.join(android, 'app', 'src', 'main', 'java', packagePath);
const manifestPath = path.join(android, 'app', 'src', 'main', 'AndroidManifest.xml');
const drawableDir = path.join(android, 'app', 'src', 'main', 'res', 'drawable');

await mkdir(javaDir, { recursive: true });
await mkdir(drawableDir, { recursive: true });
const nativeDir = path.join(root, 'android-template', 'app', 'src', 'main');
for (const file of ['MainActivity.java', 'RadarTrackingPlugin.java', 'RadarTrackingService.java', 'RoadRegionSelector.java', 'RoadRegionStore.java', 'RoadSnapshotRevision.java', 'LiveFixPolicy.java']) {
  await copyFile(path.join(nativeDir, 'java', 'com', 'radalert', 'app', file), path.join(javaDir, file));
}
await copyFile(path.join(nativeDir, 'res', 'drawable', 'ic_stat_radar.xml'), path.join(drawableDir, 'ic_stat_radar.xml'));
for (const resource of ['drawable/ic_radar_foreground.xml', 'mipmap-anydpi/ic_launcher.xml',
  'mipmap-anydpi-v26/ic_launcher.xml', 'values/ic_launcher_background.xml']) {
  const destination = path.join(android, 'app/src/main/res', resource);
  await mkdir(path.dirname(destination), { recursive: true });
  await copyFile(path.join(nativeDir, 'res', resource), destination);
}
for (const folder of ['mipmap-anydpi', 'mipmap-anydpi-v26']) {
  const resourceDir = path.join(android, 'app/src/main/res', folder);
  await copyFile(path.join(resourceDir, 'ic_launcher.xml'), path.join(resourceDir, 'ic_launcher_round.xml'));
}

const version = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).version;
const [major, minor, patch] = version.split('.').map(Number);
const gradlePath = path.join(android, 'app/build.gradle');
let gradle = await readFile(gradlePath, 'utf8');
const currentCode = Number(gradle.match(/versionCode\s+(\d+)/)?.[1] || 1);
const versionCode = Math.max(currentCode, major * 1000000 + minor * 1000 + patch);
gradle = gradle.replace(/versionCode\s+\d+/, `versionCode ${versionCode}`)
  .replace(/versionName\s+["'][^"']+["']/, `versionName "${version}"`);
await writeFile(gradlePath, gradle);

let xml = await readFile(manifestPath, 'utf8');
const permissions = [
  'android.permission.ACCESS_COARSE_LOCATION',
  'android.permission.ACCESS_FINE_LOCATION',
  'android.permission.FOREGROUND_SERVICE',
  'android.permission.FOREGROUND_SERVICE_LOCATION',
  'android.permission.POST_NOTIFICATIONS'
];
for (const permission of permissions) {
  const re = new RegExp(`<uses-permission\\s+android:name=["']${permission.replaceAll('.', '\\.')}["']\\s*/>`);
  if (!re.test(xml)) xml = xml.replace(/<application\b/, `<uses-permission android:name="${permission}" />\n    <application`);
}
if (!xml.includes('com.radalert.app.RadarTrackingService')) {
  xml = xml.replace('</application>', '        <service android:name="com.radalert.app.RadarTrackingService" android:exported="false" android:foregroundServiceType="location" android:stopWithTask="false" />\n    </application>');
}
await writeFile(manifestPath, xml);
console.log('Integração nativa aplicada: plugin, serviço de localização, permissões e MainActivity.');
