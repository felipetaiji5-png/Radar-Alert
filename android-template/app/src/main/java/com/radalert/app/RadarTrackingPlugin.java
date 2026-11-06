package com.radalert.app;

import android.Manifest;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.SystemClock;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;

@CapacitorPlugin(
    name = "RadarTracking",
    permissions = {
        @Permission(
            alias = "location",
            strings = {
                Manifest.permission.ACCESS_FINE_LOCATION,
                Manifest.permission.ACCESS_COARSE_LOCATION
            }
        ),
        @Permission(
            alias = "notifications",
            strings = { Manifest.permission.POST_NOTIFICATIONS }
        )
    }
)
public class RadarTrackingPlugin extends Plugin {
    private BroadcastReceiver eventReceiver;

    @Override
    public void load() {
        super.load();
        eventReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                if (intent == null) return;
                String eventName = intent.getStringExtra("event");
                if (eventName == null) return;
                JSObject payload = new JSObject();
                if (intent.hasExtra("latitude")) payload.put("latitude", intent.getDoubleExtra("latitude", 0));
                if (intent.hasExtra("longitude")) payload.put("longitude", intent.getDoubleExtra("longitude", 0));
                if (intent.hasExtra("accuracy")) payload.put("accuracy", intent.getFloatExtra("accuracy", 0));
                if (intent.hasExtra("speedMps")) payload.put("speedMps", intent.getFloatExtra("speedMps", 0));
                if (intent.hasExtra("bearingDegrees")) payload.put("bearingDegrees", intent.getFloatExtra("bearingDegrees", -1));
                if ("locationUpdate".equals(eventName)) {
                    // Inclui o tempo de espera do broadcast: evento atrasado não vira fix novo.
                    payload.put("timestampMs", LiveFixPolicy.webTimestamp(
                        intent.getLongExtra("fixElapsedNanos", 0),
                        SystemClock.elapsedRealtimeNanos(), System.currentTimeMillis()));
                }
                if (intent.hasExtra("message")) payload.put("message", intent.getStringExtra("message"));
                if (intent.hasExtra("mode")) payload.put("mode", intent.getStringExtra("mode"));
                if (intent.hasExtra("running")) payload.put("running", intent.getBooleanExtra("running", false));
                notifyListeners(eventName, payload);
            }
        };
        IntentFilter filter = new IntentFilter(RadarTrackingService.ACTION_EVENT);
        if (Build.VERSION.SDK_INT >= 33) {
            getContext().registerReceiver(eventReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
        } else {
            getContext().registerReceiver(eventReceiver, filter);
        }
    }

    @Override
    protected void handleOnDestroy() {
        if (eventReceiver != null) {
            try { getContext().unregisterReceiver(eventReceiver); } catch (Exception ignored) { }
            eventReceiver = null;
        }
        super.handleOnDestroy();
    }

    @PluginMethod
    public void requestPermissions(PluginCall call) {
        if (!hasFineLocation()) {
            requestPermissionForAlias("location", call, "locationPermissionCallback");
            return;
        }
        call.resolve(permissionResult());
    }

    @PermissionCallback
    private void locationPermissionCallback(PluginCall call) {
        if (!hasFineLocation()) {
            call.reject("O Radar Alert precisa de localização precisa para monitorar radares. Permita 'Localização precisa' nas configurações do Android.");
            return;
        }
        call.resolve(permissionResult());
    }

    @PluginMethod
    public void requestNotificationPermission(PluginCall call) {
        if (Build.VERSION.SDK_INT >= 33 && getPermissionState("notifications") != PermissionState.GRANTED) {
            requestPermissionForAlias("notifications", call, "notificationPermissionCallback");
        } else {
            call.resolve(permissionResult());
        }
    }

    @PermissionCallback
    private void notificationPermissionCallback(PluginCall call) {
        call.resolve(permissionResult()); // Voz continua disponível mesmo se notificações forem recusadas.
    }

    private boolean hasFineLocation() {
        return getContext().checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    private JSObject permissionResult() {
        JSObject result = new JSObject();
        result.put("fineLocationGranted", hasFineLocation());
        result.put("coarseLocationGranted", getContext().checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED);
        result.put("notificationsGranted", Build.VERSION.SDK_INT < 33 || getContext().checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED);
        return result;
    }

    // Only invalidate road attachments when the radar catalog really changes.
    // Rewriting the same dataset on every app start previously erased all road coverage.
    private static boolean fileEquals(File file, byte[] bytes) throws IOException {
        if (!file.isFile() || file.length() != bytes.length) return false;
        try (FileInputStream input = new FileInputStream(file)) {
            byte[] buffer = new byte[8192];
            int offset = 0, read;
            while ((read = input.read(buffer)) != -1) {
                for (int i = 0; i < read; i++) {
                    if (buffer[i] != bytes[offset + i]) return false;
                }
                offset += read;
            }
            return offset == bytes.length;
        }
    }

    @PluginMethod
    public void setRadars(PluginCall call) {
        JSArray radars = call.getArray("radars");
        if (radars == null) { call.reject("A lista de radares não foi fornecida."); return; }
        if (radars.length() > 12000) { call.reject("A lista excede o limite de 12.000 radares."); return; }
        File target = new File(getContext().getFilesDir(), RadarTrackingService.RADARS_FILE);
        try {
            byte[] bytes = radars.toString().getBytes(StandardCharsets.UTF_8);
            boolean changed = !fileEquals(target, bytes);
            String revision = RoadRegionStore.catalogRevision(bytes);
            if (changed) {
                RoadRegionStore.writeAtomic(target, bytes);
                getContext().getSharedPreferences(RadarTrackingService.PREFS, Context.MODE_PRIVATE)
                    .edit().putString("catalogRevision", revision).commit();
                // Old attachments are no longer trustworthy after an actual dataset change.
                File oldRoad = new File(getContext().getFilesDir(), RadarTrackingService.ROAD_NETWORK_FILE);
                if (oldRoad.exists() && !oldRoad.delete()) throw new IOException("Não foi possível invalidar malha antiga.");
                RoadRegionStore.clear(getContext().getFilesDir());
                if (RadarTrackingService.isServiceActive()) {
                    Intent reload = new Intent(getContext(), RadarTrackingService.class)
                        .setAction(RadarTrackingService.ACTION_RELOAD_DATA);
                    getContext().startService(reload);
                }
            }
            // Revision is part of every cached file name, preventing stale
            // radar/road associations even if cleanup was interrupted.
            getContext().getSharedPreferences(RadarTrackingService.PREFS, Context.MODE_PRIVATE)
                .edit().putString("catalogRevision", revision).apply();
            JSObject result = new JSObject();
            result.put("saved", true); result.put("changed", changed); result.put("count", radars.length());
            call.resolve(result);
        } catch (Exception error) {
            call.reject("Falha ao salvar radares para Android: " + error.getMessage(), error);
        }
    }

    private static void validateRoadNetwork(JSONObject network) {
        if (network == null || network.optInt("schemaVersion", 0) != 1)
            throw new IllegalArgumentException("A rede viária usa uma versão de esquema incompatível.");
        JSONArray edges = network.optJSONArray("edges");
        JSONArray attachments = network.optJSONArray("attachments");
        JSONObject center = network.optJSONObject("center");
        if (edges == null || attachments == null || edges.length() == 0 || center == null)
            throw new IllegalArgumentException("Malha sem segmentos, associações ou centro.");
        if (edges.length() > 30000 || attachments.length() > 12000)
            throw new IllegalArgumentException("A malha excede os limites de segurança.");
        double lat = center.optDouble("lat", Double.NaN), lng = center.optDouble("lng", Double.NaN);
        double radius = network.optDouble("radiusMeters", 0);
        if (!Double.isFinite(lat) || !Double.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180
            || !Double.isFinite(radius) || radius < 500 || radius > 10000)
            throw new IllegalArgumentException("Centro ou raio da rede viária inválido.");
    }

    private void persistRoadNetwork(PluginCall call, boolean activate) {
        try {
            JSONObject network = call.getObject("network");
            validateRoadNetwork(network);
            String revision = getContext().getSharedPreferences(RadarTrackingService.PREFS, Context.MODE_PRIVATE)
                .getString("catalogRevision", "");
            if (!revision.matches("[0-9a-f]{12}"))
                throw new IllegalStateException("Sincronize a base de radares antes da malha OSM.");
            // Prevent a road snapshot from being used after the radar dataset changes.
            network.put("catalogRevision", revision);
            byte[] bytes = network.toString().getBytes(StandardCharsets.UTF_8);
            if (bytes.length > 8 * 1024 * 1024) throw new IllegalArgumentException("Malha OSM excede 8 MB.");
            // Always save regional coverage. Prefetch does not replace the active network.
            int cached = RoadRegionStore.cache(getContext().getFilesDir(), network, bytes, revision);
            if (activate) {
                File target = new File(getContext().getFilesDir(), RadarTrackingService.ROAD_NETWORK_FILE);
                if (!fileEquals(target, bytes)) {
                    RoadRegionStore.writeAtomic(target, bytes);
                    if (RadarTrackingService.isServiceActive()) {
                        Intent reload = new Intent(getContext(), RadarTrackingService.class)
                            .setAction(RadarTrackingService.ACTION_RELOAD_DATA);
                        getContext().startService(reload);
                    }
                }
            }
            JSObject result = new JSObject();
            result.put("saved", true);
            result.put("activated", activate);
            result.put("edges", network.getJSONArray("edges").length());
            result.put("attachments", network.getJSONArray("attachments").length());
            result.put("cachedRegions", cached);
            result.put("bytes", bytes.length);
            call.resolve(result);
        } catch (Exception error) {
            call.reject("Falha ao salvar malha OSM regional: " + error.getMessage(), error);
        }
    }

    @PluginMethod
    public void setRoadNetwork(PluginCall call) { persistRoadNetwork(call, true); }

    @PluginMethod
    public void cacheRoadNetwork(PluginCall call) { persistRoadNetwork(call, false); }

    @PluginMethod
    public void setPreferences(PluginCall call) {
        android.content.SharedPreferences.Editor editor = getContext()
            .getSharedPreferences(RadarTrackingService.PREFS, Context.MODE_PRIVATE).edit();
        Integer far = call.getInt("far");
        Integer mid = call.getInt("mid");
        Integer near = call.getInt("near");
        Boolean voice = call.getBoolean("voice");
        Boolean notifications = call.getBoolean("notifications");
        Integer volume = call.getInt("volume");
        editor.putInt("far", far == null ? 1000 : Math.max(100, Math.min(5000, far)));
        editor.putInt("mid", mid == null ? 500 : Math.max(50, Math.min(3000, mid)));
        editor.putInt("near", near == null ? 200 : Math.max(30, Math.min(1500, near)));
        editor.putBoolean("voice", voice == null || voice);
        editor.putBoolean("notifications", notifications != null && notifications);
        editor.putFloat("volume", (volume == null ? 100 : Math.max(0, Math.min(100, volume))) / 100.0f);
        editor.apply();
        call.resolve();
    }

    @PluginMethod
    public void setAppVisible(PluginCall call) {
        Boolean visible = call.getBoolean("visible");
        boolean isVisible = visible == null || visible;
        getContext().getSharedPreferences(RadarTrackingService.PREFS, Context.MODE_PRIVATE)
            .edit().putBoolean("appVisible", isVisible)
            .putLong("appVisibleAt", isVisible ? System.currentTimeMillis() : 0L).apply();
        call.resolve();
    }

    @PluginMethod
    public void start(PluginCall call) {
        if (!hasFineLocation()) {
            call.reject("Permissão de localização precisa não concedida.");
            return;
        }
        File radarFile = new File(getContext().getFilesDir(), RadarTrackingService.RADARS_FILE);
        if (!radarFile.isFile() || radarFile.length() == 0) {
            call.reject("A base de radares ainda não foi sincronizada com o serviço Android.");
            return;
        }
        try {
            Intent intent = new Intent(getContext(), RadarTrackingService.class);
            intent.setAction(RadarTrackingService.ACTION_START);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) getContext().startForegroundService(intent);
            else getContext().startService(intent);
            JSObject result = new JSObject();
            result.put("running", true);
            result.put("mode", "ANDROID_FOREGROUND_SERVICE");
            call.resolve(result);
        } catch (Exception error) {
            call.reject("Não foi possível iniciar o serviço de localização: " + error.getMessage(), error);
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        getContext().stopService(new Intent(getContext(), RadarTrackingService.class));
        call.resolve();
    }


    @PluginMethod
    public void clearLocalData(PluginCall call) {
        try {
            // Encerra o serviço antes de apagar a cópia nativa da base.
            getContext().stopService(new Intent(getContext(), RadarTrackingService.class));
            File target = new File(getContext().getFilesDir(), RadarTrackingService.RADARS_FILE);
            File temporary = new File(getContext().getFilesDir(), RadarTrackingService.RADARS_FILE + ".tmp");
            File roadTarget = new File(getContext().getFilesDir(), RadarTrackingService.ROAD_NETWORK_FILE);
            File roadTemporary = new File(getContext().getFilesDir(), RadarTrackingService.ROAD_NETWORK_FILE + ".tmp");
            if (target.exists() && !target.delete()) throw new IllegalStateException("Não foi possível apagar a base nativa.");
            if (temporary.exists() && !temporary.delete()) throw new IllegalStateException("Não foi possível apagar o arquivo temporário.");
            if (roadTarget.exists() && !roadTarget.delete()) throw new IllegalStateException("Não foi possível apagar a malha OSM nativa.");
            if (roadTemporary.exists() && !roadTemporary.delete()) throw new IllegalStateException("Não foi possível apagar o arquivo temporário da malha OSM.");
            RoadRegionStore.clear(getContext().getFilesDir());
            getContext().getSharedPreferences(RadarTrackingService.PREFS, Context.MODE_PRIVATE).edit().clear().commit();
            call.resolve();
        } catch (Exception error) {
            call.reject("Falha ao apagar dados locais do serviço Android: " + error.getMessage(), error);
        }
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        android.content.SharedPreferences prefs = getContext().getSharedPreferences(RadarTrackingService.PREFS, Context.MODE_PRIVATE);
        JSObject status = new JSObject();
        status.put("running", RadarTrackingService.isServiceActive() && prefs.getBoolean("running", false));
        status.put("mode", prefs.getString("mode", "UNKNOWN"));
        status.put("lastAccuracy", prefs.getFloat("lastAccuracy", -1));
        status.put("lastSpeedKmh", prefs.getFloat("lastSpeedKmh", -1));
        status.put("lastFixAt", prefs.getLong("lastFixAt", 0));
        status.put("gpsEnabled", prefs.getBoolean("gpsEnabled", false));
        status.put("roadNetworkReady", prefs.getBoolean("roadNetworkReady", false));
        status.put("roadEdgeCount", prefs.getInt("roadEdgeCount", 0));
        status.put("roadRadarCount", prefs.getInt("roadRadarCount", 0));
        status.put("roadNetworkIssue", prefs.getString("roadNetworkIssue", ""));
        String revision = prefs.getString("catalogRevision", "");
        status.put("cachedRoadRegions", RoadRegionStore.count(getContext().getFilesDir(), revision));
        call.resolve(status);
    }
}
