package com.radalert.app;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.graphics.drawable.Icon;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.media.AudioAttributes;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.IBinder;
import android.os.Looper;
import android.speech.tts.TextToSpeech;
import android.util.AtomicFile;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.PriorityQueue;
import java.util.Set;

public class RadarTrackingService extends Service implements LocationListener {
    public static volatile boolean serviceActive = false;

    public static boolean isServiceActive() { return serviceActive; }

    public static final String ACTION_START = "com.radalert.app.action.START_TRACKING";
    public static final String ACTION_STOP = "com.radalert.app.action.STOP_TRACKING";
    public static final String ACTION_EVENT = "com.radalert.app.action.TRACKING_EVENT";
    public static final String ACTION_RELOAD_DATA = "com.radalert.app.action.RELOAD_DATA";
    public static final String RADARS_FILE = "radars-background.json";
    public static final String ROAD_NETWORK_FILE = "road-network-background.json";
    public static final String PREFS = "radar-alert-native";

    private static final int SERVICE_NOTIFICATION_ID = 7101;
    private static final String CHANNEL_SERVICE = "radar_tracking_status";
    private static final String CHANNEL_ALERTS = "radar_tracking_alerts";
    private static final double EARTH_RADIUS_M = 6371000.0;
    private static final double ROAD_GRID_CELL = 0.0025;

    private LocationManager locationManager;
    private HandlerThread locationThread;
    private Handler mainHandler;
    private Runnable providerMonitor;
    private boolean serviceRunning = false;
    private TextToSpeech textToSpeech;
    private boolean ttsReady = false;
    private boolean locationRegistered = false;
    private Location previousLocation;
    private double effectiveHeading = Double.NaN;
    private double currentSpeedKmh = Double.NaN;
    private String gpsMode = "RECOVERING";
    private int stoppedTicks = 0;
    private long lastForegroundNotificationAt = 0;
    private long lastAlertAt = 0;
    private final Map<String, Integer> alertTiers = new HashMap<>();
    private final Map<String, Long> radarLastSeen = new HashMap<>();
    private JSONArray radars = new JSONArray();
    private final Map<String, JSONObject> radarById = new HashMap<>();
    private final Map<String, RoadEdge> roadEdgesById = new HashMap<>();
    private final Map<String, List<RoadEdge>> roadOutgoing = new HashMap<>();
    private final Map<String, List<RoadEdge>> roadGrid = new HashMap<>();
    private final Map<String, RadarAttachment> radarAttachments = new HashMap<>();
    private double roadCenterLat = Double.NaN;
    private double roadCenterLng = Double.NaN;
    private double roadRadiusMeters = 0;
    private boolean roadNetworkReady = false;
    private String lastMatchedEdgeId = null;
    private long lastNoRoadNetworkEventAt = 0;
    private android.content.SharedPreferences prefs;
    private final Object roadDataLock = new Object();
    private long lastRegionSearchAt = 0;


    @Override
    public void onCreate() {
        super.onCreate();
        prefs = getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        locationManager = (LocationManager) getSystemService(Context.LOCATION_SERVICE);
        mainHandler = new Handler(Looper.getMainLooper());
        providerMonitor = new Runnable() {
            @Override public void run() {
                if (!serviceRunning) return;
                boolean enabled = isGpsEnabled();
                if (enabled && !locationRegistered) {
                    try { startLocationUpdates(); }
                    catch (SecurityException error) {
                        emitServiceEvent("Permissão GPS perdida: " + error.getMessage(), "error", false);
                        stopTracking();
                        return;
                    }
                } else if (!enabled && locationRegistered) {
                    try { locationManager.removeUpdates(RadarTrackingService.this); } catch (SecurityException ignored) { }
                    locationRegistered = false;
                    prefs.edit().putBoolean("gpsEnabled", false).apply();
                    emitServiceEvent("GPS desligado. Serviço aguardando a reativação.", "gpsDisabled", true);
                    updateForegroundNotification("GPS desligado · aguardando ativação");
                }
                mainHandler.postDelayed(this, 5000L);
            }
        };
        locationThread = new HandlerThread("RadarAlertGps");
        locationThread.start();
        createNotificationChannels();
        textToSpeech = new TextToSpeech(getApplicationContext(), status -> {
            if (status == TextToSpeech.SUCCESS) {
                int languageResult = textToSpeech.setLanguage(new Locale("pt", "BR"));
                ttsReady = languageResult != TextToSpeech.LANG_MISSING_DATA && languageResult != TextToSpeech.LANG_NOT_SUPPORTED;
                if (Build.VERSION.SDK_INT >= 21) {
                    textToSpeech.setAudioAttributes(new AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                        .build());
                }
            }
        });
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent == null ? ACTION_START : intent.getAction();
        if (ACTION_STOP.equals(action)) {
            stopTracking();
            return START_NOT_STICKY;
        }
        if (ACTION_RELOAD_DATA.equals(action)) {
            if (!serviceRunning) return START_NOT_STICKY;
            try {
                synchronized (roadDataLock) {
                    loadRadars();
                    // A malha é opcional: dados antigos não podem derrubar o serviço GPS.
                    restoreRoadNetworkOrSuspend();
                }
                emitServiceEvent("Base de radares atualizada; cobertura viária disponível apenas quando validada.", "dataReloaded", true);
            } catch (Exception error) {
                emitServiceEvent("Falha ao atualizar a malha viária nativa; última malha válida preservada: " + error.getMessage(), "error", true);
            }
            return START_NOT_STICKY;
        }

        try {
            // A notificação é promovida antes de iniciar qualquer operação de GPS.
            Notification notification = buildServiceNotification("Preparando GPS…");
            if (Build.VERSION.SDK_INT >= 29) {
                startForeground(SERVICE_NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION);
            } else {
                startForeground(SERVICE_NOTIFICATION_ID, notification);
            }
            serviceRunning = true;
            serviceActive = true;
            synchronized (roadDataLock) {
                loadRadars();
                // Migração de versões antigas: se a malha estiver incompatível,
                // continuar o GPS sem alertas por rota até obter uma região válida.
                restoreRoadNetworkOrSuspend();
            }
            prefs.edit().putBoolean("running", true).putBoolean("gpsEnabled", isGpsEnabled()).apply();
            if (mainHandler != null && providerMonitor != null) {
                mainHandler.removeCallbacks(providerMonitor);
                mainHandler.post(providerMonitor);
            }
            emitServiceEvent("Serviço Android em primeiro plano iniciado. Aguardando posição GPS.", "started", true);
            startLocationUpdates();
            return START_STICKY;
        } catch (SecurityException error) {
            emitServiceEvent("Permissão de localização revogada ou insuficiente: " + error.getMessage(), "error", false);
            stopTracking();
            return START_NOT_STICKY;
        } catch (Exception error) {
            emitServiceEvent("Falha ao iniciar monitoramento nativo: " + error.getMessage(), "error", false);
            stopTracking();
            return START_NOT_STICKY;
        }
    }

    private void loadRadars() throws Exception {
        File file = new File(getFilesDir(), RADARS_FILE);
        if (!file.isFile()) throw new IllegalStateException("Base nativa não encontrada.");
        String json;
        try (FileInputStream input = new AtomicFile(file).openRead();
             ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192];
            int count;
            while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
            json = new String(output.toByteArray(), StandardCharsets.UTF_8);
        }
        // Resolve revision from the actual disk file, even after an interrupted update.
        String revision = RoadRegionStore.catalogRevision(json.getBytes(StandardCharsets.UTF_8));
        if (!prefs.edit().putString("catalogRevision", revision).commit()) {
            throw new IllegalStateException("Não foi possível persistir revisão da base de radares.");
        }
        radars = new JSONArray(json);
        radarById.clear();
        for (int i = 0; i < radars.length(); i++) {
            JSONObject radar = radars.optJSONObject(i);
            if (radar == null) continue;
            String id = radar.optString("id", "");
            if (!id.isEmpty()) radarById.put(id, radar);
        }
    }

    /**
     * Road geometry is optional for tracking, but mandatory for route alerts.
     * A legacy/incompatible/corrupt snapshot must fail closed WITHOUT stopping GPS.
     * Region switches use loadRoadNetwork(File) directly so invalid candidates
     * never destroy an already validated active graph.
     */
    private boolean restoreRoadNetworkOrSuspend() {
        try {
            loadRoadNetwork();
            prefs.edit().remove("roadNetworkIssue").apply();
            return roadNetworkReady;
        } catch (Exception error) {
            clearRoadNetworkState();
            String issue = error.getMessage() == null ? error.getClass().getSimpleName() : error.getMessage();
            prefs.edit().putString("roadNetworkIssue", issue).apply();
            emitServiceEvent("Malha OSM incompatível ou inválida: " + issue
                + " GPS continua ativo, mas alertas por rota ficam suspensos até nova sincronização.",
                "roadNetworkUnavailable", true);
            return false;
        }
    }

    private void clearRoadNetworkState() {
        roadEdgesById.clear(); roadOutgoing.clear(); roadGrid.clear(); radarAttachments.clear();
        roadNetworkReady = false;
        roadCenterLat = Double.NaN; roadCenterLng = Double.NaN; roadRadiusMeters = 0;
        lastMatchedEdgeId = null;
        lastRegionSearchAt = 0;
        alertTiers.clear(); radarLastSeen.clear();
        prefs.edit().putBoolean("roadNetworkReady", false)
            .putInt("roadEdgeCount", 0).putInt("roadRadarCount", 0).apply();
    }

    private void loadRoadNetwork() throws Exception {
        loadRoadNetwork(new File(getFilesDir(), ROAD_NETWORK_FILE));
    }

    /** Parse the complete graph before replacing anything used by GPS callbacks. */
    private void loadRoadNetwork(File file) throws Exception {
        if (!file.isFile()) {
            clearRoadNetworkState();
            return;
        }
        String json;
        try (FileInputStream input = new AtomicFile(file).openRead();
             ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192];
            int count;
            while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
            json = new String(output.toByteArray(), StandardCharsets.UTF_8);
        }
        JSONObject root = new JSONObject(json);
        if (root.optInt("schemaVersion", 0) != 1) throw new IllegalStateException("Versão de malha OSM incompatível.");
        if (!RoadSnapshotRevision.compatible(root.optString("catalogRevision", ""),
            prefs.getString("catalogRevision", ""))) {
            // Não toque na malha ativa aqui: este método também testa regiões de cache.
            throw new IllegalStateException("Malha OSM associada à revisão antiga do catálogo de radares.");
        }
        JSONObject center = root.optJSONObject("center");
        double newLat = center == null ? Double.NaN : center.optDouble("lat", Double.NaN);
        double newLng = center == null ? Double.NaN : center.optDouble("lng", Double.NaN);
        double newRadius = root.optDouble("radiusMeters", 0);
        if (!Double.isFinite(newLat) || !Double.isFinite(newLng) || Math.abs(newLat) > 90 ||
            Math.abs(newLng) > 180 || !Double.isFinite(newRadius) || newRadius < 500 || newRadius > 10000)
            throw new IllegalStateException("Centro ou raio da malha OSM inválido.");
        JSONArray edges = root.optJSONArray("edges");
        JSONArray attachments = root.optJSONArray("attachments");
        if (edges == null || edges.length() == 0 || edges.length() > 30000)
            throw new IllegalStateException("Quantidade de segmentos OSM inválida.");
        if (attachments != null && attachments.length() > 12000)
            throw new IllegalStateException("Quantidade de radares associados inválida.");
        Map<String, RoadEdge> nextEdges = new HashMap<>();
        Map<String, List<RoadEdge>> nextOutgoing = new HashMap<>();
        Map<String, List<RoadEdge>> nextGrid = new HashMap<>();
        Map<String, RadarAttachment> nextAttachments = new HashMap<>();
        for (int i = 0; i < edges.length(); i++) {
            JSONArray row = edges.optJSONArray(i);
            if (row == null || row.length() < 12) continue;
            RoadEdge edge = new RoadEdge(row);
            if (!edge.isValid()) continue;
            nextEdges.put(edge.id, edge);
            List<RoadEdge> outgoing = nextOutgoing.get(edge.fromNode);
            if (outgoing == null) { outgoing = new ArrayList<>(); nextOutgoing.put(edge.fromNode, outgoing); }
            outgoing.add(edge);
            addRoadEdgeToGrid(edge, nextGrid);
        }
        if (nextEdges.isEmpty()) throw new IllegalStateException("Malha OSM sem arestas válidas.");
        if (attachments != null) {
            for (int i = 0; i < attachments.length(); i++) {
                JSONArray row = attachments.optJSONArray(i);
                if (row == null || row.length() < 9) continue;
                RadarAttachment attachment = new RadarAttachment(row);
                if (attachment.isValid() && nextEdges.containsKey(attachment.edgeId)
                    && radarById.containsKey(attachment.radarId)) {
                    nextAttachments.put(attachment.radarId, attachment);
                }
            }
        }
        // Commit is atomic with respect to the GPS callback via roadDataLock.
        roadEdgesById.clear(); roadEdgesById.putAll(nextEdges);
        roadOutgoing.clear(); roadOutgoing.putAll(nextOutgoing);
        roadGrid.clear(); roadGrid.putAll(nextGrid);
        radarAttachments.clear(); radarAttachments.putAll(nextAttachments);
        roadCenterLat = newLat; roadCenterLng = newLng; roadRadiusMeters = newRadius;
        roadNetworkReady = !radarAttachments.isEmpty();
        lastMatchedEdgeId = null;
        alertTiers.clear(); radarLastSeen.clear();
        prefs.edit().remove("roadNetworkIssue")
            .putBoolean("roadNetworkReady", roadNetworkReady)
            .putInt("roadEdgeCount", roadEdgesById.size())
            .putInt("roadRadarCount", radarAttachments.size()).apply();
        if (radarAttachments.isEmpty()) {
            emitServiceEvent("Malha OSM recebida, mas sem radares com via e sentido confirmados nesta região.",
                "noConfirmedRadars", true);
        }
    }

    /** Selects previously synchronized regional data without network access or WebView. */
    private void chooseCachedRegion(Location location) {
        double lat = location.getLatitude(), lng = location.getLongitude();
        if (!roadEdgesById.isEmpty() &&
            distanceMeters(lat, lng, roadCenterLat, roadCenterLng) <= roadRadiusMeters * 0.72) return;
        long now = System.currentTimeMillis();
        if (now - lastRegionSearchAt < 20000L) return;
        lastRegionSearchAt = now;
        File selected = RoadRegionStore.bestCovering(getFilesDir(), lat, lng, 0.72,
            prefs.getString("catalogRevision", ""));
        if (selected == null) return;
        try {
            loadRoadNetwork(selected);
            emitServiceEvent("Região OSM armazenada ativada automaticamente em segundo plano: "
                + roadEdgesById.size() + " arestas e " + radarAttachments.size() + " radares associados.",
                "roadRegionSwitched", true);
        } catch (Exception error) {
            // Invalid snapshots must never replace an already validated graph.
            emitServiceEvent("Região OSM em cache inválida: " + error.getMessage(), "roadRegionError", true);
        }
    }

    private void addRoadEdgeToGrid(RoadEdge edge, Map<String, List<RoadEdge>> grid) {
        int minLat = gridIndex(Math.min(edge.fromLat, edge.toLat));
        int maxLat = gridIndex(Math.max(edge.fromLat, edge.toLat));
        int minLng = gridIndex(Math.min(edge.fromLng, edge.toLng));
        int maxLng = gridIndex(Math.max(edge.fromLng, edge.toLng));
        long cellCount = (long)(maxLat - minLat + 1) * (maxLng - minLng + 1);
        if (cellCount <= 100) {
            for (int x = minLat; x <= maxLat; x++) for (int y = minLng; y <= maxLng; y++) addEdgeToCell(edge, x, y, grid);
            return;
        }
        // Ways rurais podem ter nós muito espaçados. Para arestas longas, amostra o traçado
        // e inclui células vizinhas em vez de descartá-las do índice espacial.
        double maxDelta = Math.max(Math.abs(edge.toLat - edge.fromLat), Math.abs(edge.toLng - edge.fromLng));
        int steps = Math.max(1, (int)Math.ceil(maxDelta / (ROAD_GRID_CELL / 2.0)));
        for (int i = 0; i <= steps; i++) {
            double fraction = i / (double)steps;
            int gx = gridIndex(edge.fromLat + (edge.toLat - edge.fromLat) * fraction);
            int gy = gridIndex(edge.fromLng + (edge.toLng - edge.fromLng) * fraction);
            for (int dx = -1; dx <= 1; dx++) for (int dy = -1; dy <= 1; dy++) addEdgeToCell(edge, gx + dx, gy + dy, grid);
        }
    }

    private void addEdgeToCell(RoadEdge edge, int x, int y, Map<String, List<RoadEdge>> grid) {
        String key = x + ":" + y;
        List<RoadEdge> cell = grid.get(key);
        if (cell == null) { cell = new ArrayList<>(); grid.put(key, cell); }
        cell.add(edge);
    }

    private static int gridIndex(double coordinate) { return (int)Math.floor(coordinate / ROAD_GRID_CELL); }

    private void createNotificationChannels() {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        NotificationChannel serviceChannel = new NotificationChannel(CHANNEL_SERVICE, "Monitoramento Radar Alert", NotificationManager.IMPORTANCE_LOW);
        serviceChannel.setDescription("Indica que o monitoramento GPS está ativo.");
        serviceChannel.setShowBadge(false);
        manager.createNotificationChannel(serviceChannel);
        NotificationChannel alertChannel = new NotificationChannel(CHANNEL_ALERTS, "Alertas de radar", NotificationManager.IMPORTANCE_HIGH);
        alertChannel.setDescription("Avisos de proximidade de radares identificados pelo serviço em segundo plano.");
        manager.createNotificationChannel(alertChannel);
    }

    private Notification buildServiceNotification(String text) {
        Intent stopIntent = new Intent(this, RadarTrackingService.class).setAction(ACTION_STOP);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= 23) flags |= PendingIntent.FLAG_IMMUTABLE;
        PendingIntent stopPendingIntent = PendingIntent.getService(this, 7102, stopIntent, flags);
        Notification.Builder builder = Build.VERSION.SDK_INT >= 26
            ? new Notification.Builder(this, CHANNEL_SERVICE)
            : new Notification.Builder(this);
        builder.setSmallIcon(R.drawable.ic_stat_radar)
            .setContentTitle("Radar Alert · monitoramento ativo")
            .setContentText(text)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setCategory(Notification.CATEGORY_SERVICE)
            .addAction(new Notification.Action.Builder(Icon.createWithResource(this, R.drawable.ic_stat_radar), "Parar", stopPendingIntent).build());
        return builder.build();
    }

    private void updateForegroundNotification(String text) {
        long now = System.currentTimeMillis();
        if (now - lastForegroundNotificationAt < 10000) return;
        lastForegroundNotificationAt = now;
        try {
            NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            manager.notify(SERVICE_NOTIFICATION_ID, buildServiceNotification(text));
        } catch (SecurityException ignored) { }
    }

    private boolean isGpsEnabled() {
        try { return locationManager != null && locationManager.isProviderEnabled(LocationManager.GPS_PROVIDER); }
        catch (Exception ignored) { return false; }
    }

    private void startLocationUpdates() {
        if (locationManager == null) throw new IllegalStateException("LocationManager indisponível.");
        if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            throw new SecurityException("Permissão precisa de localização não concedida.");
        }
        if (!isGpsEnabled()) {
            prefs.edit().putBoolean("gpsEnabled", false).apply();
            emitServiceEvent("GPS do aparelho desligado. Ative a localização para receber atualizações.", "gpsDisabled", true);
            updateForegroundNotification("GPS desligado · aguardando ativação");
            return;
        }
        long interval = "HIGHWAY".equals(gpsMode) ? 1000L : ("STOPPED".equals(gpsMode) ? 6000L : 1800L);
        // O intervalo reduz a frequência quando parado. Exigir deslocamento aqui
        // impediria novos fixes no mesmo ponto e faria o painel expirar em 90 s.
        float minDistance = 0.0f;
        try {
            if (locationRegistered) locationManager.removeUpdates(this);
            locationManager.requestLocationUpdates(LocationManager.GPS_PROVIDER, interval, minDistance, this, locationThread.getLooper());
            locationRegistered = true;
            prefs.edit().putBoolean("gpsEnabled", true).putString("mode", gpsMode).apply();
        } catch (SecurityException error) {
            throw error;
        } catch (Exception error) {
            emitServiceEvent("Não foi possível solicitar GPS: " + error.getMessage(), "error", false);
        }
    }

    @Override
    public void onLocationChanged(Location location) {
        if (location != null && !LiveFixPolicy.isFresh(location.getTime(), System.currentTimeMillis())) {
            emitServiceEvent("Leitura GPS antiga ou com horário inválido. Aguardando posição atual.", "gpsStale", true);
            return;
        }
        if (location == null || !location.hasAccuracy() || location.getAccuracy() <= 0 || location.getAccuracy() > 65.0f) {
            emitServiceEvent("Fix GPS ignorado: precisão acima de 65 metros ou inválida.", "gpsLowAccuracy", true);
            return;
        }

        double speedKmh = location.hasSpeed() ? location.getSpeed() * 3.6 : Double.NaN;
        // Não reutilize o rumo de um fix anterior: parado, sem bearing ou
        // após oscilações de GPS, o rumo deve ficar desconhecido.
        effectiveHeading = Double.NaN;
        if (previousLocation != null) {
            long elapsedMs = location.getTime() - previousLocation.getTime();
            if (elapsedMs <= 0) return;
            double distance = previousLocation.distanceTo(location);
            double tolerated = Math.max(75.0, location.getAccuracy() + previousLocation.getAccuracy() + 25.0);
            double seconds = elapsedMs / 1000.0;
            if (seconds < 30 && distance > tolerated && (distance - tolerated) / seconds > (220.0 / 3.6)) {
                emitServiceEvent("Fix GPS rejeitado por salto incompatível.", "gpsOutlier", true);
                return;
            }
            // Sem sensor de velocidade, não transforme jitter de localização
            // em velocidade e rumo. A variação deve superar a incerteza GPS.
            double minMovement = Math.max(12.0,
                Math.hypot(location.getAccuracy(), previousLocation.getAccuracy()) * 1.8);
            double inferredSpeed = distance / seconds * 3.6;
            boolean trustworthyMotion = seconds <= 10.0 && distance >= minMovement
                && inferredSpeed >= 5.0 && inferredSpeed <= 220.0;
            if (Double.isNaN(speedKmh) && trustworthyMotion) speedKmh = inferredSpeed;
            if (trustworthyMotion && (!location.hasBearing() || !location.hasSpeed() || location.getSpeed() < 1.5f)
                    && Double.isFinite(speedKmh) && speedKmh >= 5.0) {
                effectiveHeading = bearing(previousLocation, location);
            }
        }
        if (location.hasBearing() && location.hasSpeed() && location.getSpeed() >= 1.5f) {
            effectiveHeading = normalize(location.getBearing());
        }

        previousLocation = new Location(location);
        currentSpeedKmh = speedKmh;
        updateGpsMode(speedKmh);
        prefs.edit()
            .putFloat("lastAccuracy", location.getAccuracy())
            .putFloat("lastSpeedKmh", Double.isNaN(speedKmh) ? -1.0f : (float) speedKmh)
            .putLong("lastFixAt", System.currentTimeMillis())
            .putString("mode", gpsMode)
            .putBoolean("gpsEnabled", true)
            .apply();

        emitLocation(location, speedKmh, effectiveHeading);
        String speedText = Double.isNaN(speedKmh) ? "velocidade indisponível" : Math.round(speedKmh) + " km/h";
        updateForegroundNotification("GPS ativo · " + speedText + " · ±" + Math.round(location.getAccuracy()) + " m");
        processBackgroundAlerts(location, speedKmh, effectiveHeading);
    }

    private void updateGpsMode(double speedKmh) {
        String next = gpsMode;
        if (Double.isNaN(speedKmh)) {
            if ("UNKNOWN".equals(gpsMode)) next = "RECOVERING";
        } else if (speedKmh < 3.0) {
            stoppedTicks++;
            if (stoppedTicks >= 5) next = "STOPPED";
            else if ("UNKNOWN".equals(gpsMode)) next = "URBAN";
        } else {
            stoppedTicks = 0;
            next = speedKmh > 45.0 ? "HIGHWAY" : "URBAN";
        }
        if (!next.equals(gpsMode)) {
            gpsMode = next;
            prefs.edit().putString("mode", gpsMode).apply();
            try { startLocationUpdates(); }
            catch (SecurityException error) { emitServiceEvent("Permissão GPS perdida: " + error.getMessage(), "error", false); stopTracking(); }
            emitServiceEvent("Perfil de GPS alterado: " + gpsMode + ".", "modeChanged", true);
        }
    }

    private void emitLocation(Location location, double speedKmh, double heading) {
        Intent event = new Intent(ACTION_EVENT).setPackage(getPackageName());
        event.putExtra("event", "locationUpdate");
        event.putExtra("latitude", location.getLatitude());
        event.putExtra("longitude", location.getLongitude());
        event.putExtra("accuracy", location.getAccuracy());
        if (!Double.isNaN(speedKmh)) event.putExtra("speedMps", (float) (speedKmh / 3.6));
        if (!Double.isNaN(heading)) event.putExtra("bearingDegrees", (float) heading);
        event.putExtra("timestampMs", location.getTime());
        sendBroadcast(event);
    }

    private void processBackgroundAlerts(Location location, double speedKmh, double heading) {
        synchronized (roadDataLock) {
            processBackgroundAlertsLocked(location, speedKmh, heading);
        }
    }

    private void processBackgroundAlertsLocked(Location location, double speedKmh, double heading) {
        // Even without speed/bearing, prepare the right cached graph for the next GPS fix.
        if (!isWebUiResponsive()) chooseCachedRegion(location);
        // Quando a interface está responsiva, o motor JavaScript continua responsável pelos alertas.
        if (isWebUiResponsive() || Double.isNaN(speedKmh) || speedKmh < 5.0 || Double.isNaN(heading)) return;
        if (!roadNetworkReady) {
            long now = System.currentTimeMillis();
            if (now - lastNoRoadNetworkEventAt > 60000L) {
                lastNoRoadNetworkEventAt = now;
                if (!roadEdgesById.isEmpty() && radarAttachments.isEmpty()) {
                    emitServiceEvent("Sem radares associados com via e sentido confirmados na malha atual; alertas de rota suspensos.", "noConfirmedRadars", true);
                    updateForegroundNotification("GPS ativo · sem radares confirmados nesta malha");
                } else {
                    emitServiceEvent("Alertas em segundo plano suspensos: malha OSM local indisponível. Abra o app com internet para sincronizar a região.", "roadNetworkUnavailable", true);
                    updateForegroundNotification("GPS ativo · aguardando malha OSM para alertas de rota");
                }
            }
            return;
        }
        if (distanceMeters(location.getLatitude(), location.getLongitude(), roadCenterLat, roadCenterLng) > roadRadiusMeters * 0.72) {
            long now = System.currentTimeMillis();
            if (now - lastNoRoadNetworkEventAt > 60000L) {
                lastNoRoadNetworkEventAt = now;
                emitServiceEvent("Fora da região OSM sincronizada. Alertas por estrada suspensos até carregar nova geometria com o app visível.", "roadNetworkCoverageEnded", true);
                updateForegroundNotification("GPS ativo · fora da região OSM carregada");
            }
            return;
        }

        RoadMatch match = matchRoad(location, heading);
        if (match == null) return;
        Map<String, Double> distances = shortestRoadDistances(match.edge.toNode, match.edge.roadKey, match.edge.layer, 5000.0, match.edge);
        double remainingOnCurrent = Math.max(0.0, match.edge.length - match.distanceAlong);
        Candidate nearest = null;
        Set<String> seenNow = new HashSet<>();
        long now = System.currentTimeMillis();

        for (RadarAttachment attachment : radarAttachments.values()) {
            if (!match.edge.roadKey.equals(attachment.roadKey) || match.edge.layer != attachment.layer) continue;
            if (angleDiff(heading, attachment.direction) > 50.0) continue;
            JSONObject radar = radarById.get(attachment.radarId);
            if (radar == null || !radar.optBoolean("active", true)) continue;

            double routeDistance;
            if (attachment.edgeId.equals(match.edge.id)) {
                routeDistance = attachment.distAlong - match.distanceAlong;
                if (routeDistance <= 12.0) continue; // já passou ou está dentro da margem de passagem
            } else {
                Double graphDistance = distances.get(roadEdgesById.get(attachment.edgeId).fromNode);
                if (graphDistance == null) continue;
                routeDistance = remainingOnCurrent + graphDistance + attachment.distAlong;
            }
            if (routeDistance <= 12.0 || routeDistance > 5000.0) continue;
            seenNow.add(attachment.radarId);
            radarLastSeen.put(attachment.radarId, now);
            if (nearest == null || routeDistance < nearest.distance) nearest = new Candidate(radar, routeDistance);
        }

        // Libera o estado de alerta quando o motorista deixou de se aproximar daquele radar por tempo suficiente.
        for (Map.Entry<String, Long> entry : new HashMap<>(radarLastSeen).entrySet()) {
            if (!seenNow.contains(entry.getKey()) && now - entry.getValue() > 120000L) {
                alertTiers.remove(entry.getKey());
                radarLastSeen.remove(entry.getKey());
            }
        }
        if (nearest == null || now - lastAlertAt < 4500L) return;

        int far = prefs.getInt("far", 1000);
        int mid = prefs.getInt("mid", 500);
        int near = prefs.getInt("near", 200);
        int targetTier = nearest.distance <= near ? 3 : (nearest.distance <= mid ? 2 : (nearest.distance <= far ? 1 : 0));
        String id = nearest.radar.optString("id", "");
        int previousTier = alertTiers.containsKey(id) ? alertTiers.get(id) : 0;
        if (targetTier <= previousTier || targetTier == 0) return;
        alertTiers.put(id, targetTier);
        lastAlertAt = now;

        int limit = nearest.radar.optInt("limit", -1);
        String kind = nearest.radar.optString("kind", "FIXED");
        String label = "SECTION".equalsIgnoreCase(kind) ? "início de radar de trecho" : "radar";
        String distanceText = Math.round(nearest.distance) + " metros";
        String limitText = limit > 0 ? " Limite cadastrado: " + limit + " quilômetros por hora." : " Limite não informado.";
        RadarAttachment attachment = radarAttachments.get(id);
        String sectionText = attachment != null && attachment.sectionLength > 0
            ? " Extensão mapeada do trecho: aproximadamente " + Math.round(attachment.sectionLength) + " metros." : "";
        String message = "Atenção: " + label + " a " + distanceText + " pela via, conforme a malha OpenStreetMap sincronizada." + sectionText + limitText + " Confira a sinalização física.";

        if (prefs.getBoolean("voice", true) && ttsReady && textToSpeech != null) {
            android.os.Bundle speechParams = new android.os.Bundle();
            speechParams.putFloat(TextToSpeech.Engine.KEY_PARAM_VOLUME, prefs.getFloat("volume", 1.0f));
            textToSpeech.speak(message, TextToSpeech.QUEUE_ADD, speechParams, "radar-" + id + "-" + targetTier);
        }
        if (prefs.getBoolean("notifications", false) && hasNotificationPermission()) postAlertNotification(message, id, targetTier);
        emitServiceEvent("Aviso em segundo plano pela malha OSM: " + label + " a " + distanceText + ".", "backgroundRouteAlert", true);
    }

    private RoadMatch matchRoad(Location location, double heading) {
        if (!Double.isFinite(heading) || location.getAccuracy() > 50.0f) return null;
        double radius = Math.max(25.0, Math.min(65.0, location.getAccuracy() * 1.5));
        double latDelta = radius / 110540.0;
        double cosLat = Math.max(0.15, Math.cos(Math.toRadians(location.getLatitude())));
        double lngDelta = radius / (111320.0 * cosLat);
        int minX = gridIndex(location.getLatitude() - latDelta), maxX = gridIndex(location.getLatitude() + latDelta);
        int minY = gridIndex(location.getLongitude() - lngDelta), maxY = gridIndex(location.getLongitude() + lngDelta);
        Map<String, RoadEdge> candidates = new HashMap<>();
        for (int x = minX; x <= maxX; x++) for (int y = minY; y <= maxY; y++) {
            List<RoadEdge> cell = roadGrid.get(x + ":" + y);
            if (cell != null) for (RoadEdge edge : cell) candidates.put(edge.id, edge);
        }
        if (candidates.isEmpty()) return null;
        List<RoadMatch> scored = new ArrayList<>();
        double sigma = Math.max(8.0, location.getAccuracy());
        for (RoadEdge edge : candidates.values()) {
            Projection projection = projectOnEdge(location.getLatitude(), location.getLongitude(), edge);
            if (projection.crossTrack > radius) continue;
            double directionDiff = angleDiff(heading, edge.bearing);
            if (directionDiff > 50.0) continue;
            double distanceScore = Math.exp(-(projection.crossTrack * projection.crossTrack) / (2.0 * sigma * sigma));
            double directionScore = (1.0 + Math.cos(Math.toRadians(directionDiff))) / 2.0;
            double continuity = edge.id.equals(lastMatchedEdgeId) ? 1.12 : 1.0;
            scored.add(new RoadMatch(edge, projection.along, projection.crossTrack, distanceScore * directionScore * continuity));
        }
        if (scored.isEmpty()) return null;
        Collections.sort(scored, (a, b) -> Double.compare(b.score, a.score));
        RoadMatch best = scored.get(0);
        double margin = scored.size() > 1 ? best.score - scored.get(1).score : best.score;
        boolean competingRoads = false;
        if (scored.size() > 1 && margin < 0.075) {
            RoadEdge second = scored.get(1).edge;
            boolean sameTopologicalRoad = best.edge.roadKey.equals(second.roadKey)
                && best.edge.layer == second.layer
                && (best.edge.toNode.equals(second.fromNode)
                    || second.toNode.equals(best.edge.fromNode)
                    || best.edge.wayId.equals(second.wayId));
            competingRoads = !sameTopologicalRoad;
        }
        if (best.score < 0.32 || competingRoads) return null;
        lastMatchedEdgeId = best.edge.id;
        return best;
    }

    private static Projection projectOnEdge(double lat, double lng, RoadEdge edge) {
        double cosLat = Math.cos(Math.toRadians(edge.fromLat));
        double px = (lng - edge.fromLng) * 111320.0 * cosLat;
        double py = (lat - edge.fromLat) * 110540.0;
        double bx = (edge.toLng - edge.fromLng) * 111320.0 * cosLat;
        double by = (edge.toLat - edge.fromLat) * 110540.0;
        double lengthSquared = bx * bx + by * by;
        double t = lengthSquared <= 0.000001 ? 0.0 : Math.max(0.0, Math.min(1.0, (px * bx + py * by) / lengthSquared));
        double cross = Math.hypot(px - t * bx, py - t * by);
        return new Projection(t * edge.length, cross);
    }

    private Map<String, Double> shortestRoadDistances(String startNode, String roadKey, int layer, double maxDistance, RoadEdge previous) {
        Map<String, Double> stateBest = new HashMap<>();
        Map<String, Double> nodeBest = new HashMap<>();
        PriorityQueue<RoadPathState> queue = new PriorityQueue<>(Comparator.comparingDouble(state -> state.distance));
        String previousNode = previous == null ? null : previous.fromNode;
        String previousWay = previous == null ? null : previous.wayId;
        String initialKey = roadStateKey(startNode, previousNode, previousWay);
        stateBest.put(initialKey, 0.0);
        nodeBest.put(startNode, 0.0);
        queue.add(new RoadPathState(startNode, previousNode, previousWay, 0.0));
        while (!queue.isEmpty()) {
            RoadPathState current = queue.poll();
            String currentKey = roadStateKey(current.node, current.previousNode, current.previousWay);
            if (current.distance > stateBest.getOrDefault(currentKey, Double.POSITIVE_INFINITY)) continue;
            if (current.distance > maxDistance) break;
            List<RoadEdge> outgoing = roadOutgoing.get(current.node);
            if (outgoing == null) continue;
            for (RoadEdge edge : outgoing) {
                if (!roadKey.equals(edge.roadKey) || layer != edge.layer) continue;
                if (current.previousNode != null && edge.wayId.equals(current.previousWay) && edge.toNode.equals(current.previousNode)) continue;
                double nextDistance = current.distance + edge.length;
                if (nextDistance > maxDistance) continue;
                String nextNode = edge.toNode;
                String nextKey = roadStateKey(nextNode, current.node, edge.wayId);
                if (nextDistance >= stateBest.getOrDefault(nextKey, Double.POSITIVE_INFINITY)) continue;
                stateBest.put(nextKey, nextDistance);
                nodeBest.put(nextNode, Math.min(nodeBest.getOrDefault(nextNode, Double.POSITIVE_INFINITY), nextDistance));
                queue.add(new RoadPathState(nextNode, current.node, edge.wayId, nextDistance));
            }
        }
        return nodeBest;
    }

    private static String roadStateKey(String node, String previousNode, String previousWay) {
        return node + "|" + (previousNode == null ? "" : previousNode) + "|" + (previousWay == null ? "" : previousWay);
    }

    private boolean isWebUiResponsive() {
        boolean visible = prefs.getBoolean("appVisible", false);
        long heartbeatAt = prefs.getLong("appVisibleAt", 0L);
        return visible && System.currentTimeMillis() - heartbeatAt <= 15000L;
    }

    private boolean hasNotificationPermission() {
        return Build.VERSION.SDK_INT < 33 || checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED;
    }

    private void postAlertNotification(String message, String id, int tier) {
        try {
            Notification.Builder builder = Build.VERSION.SDK_INT >= 26
                ? new Notification.Builder(this, CHANNEL_ALERTS)
                : new Notification.Builder(this);
            builder.setSmallIcon(R.drawable.ic_stat_radar)
                .setContentTitle("Radar Alert")
                .setContentText(message)
                .setStyle(new Notification.BigTextStyle().bigText(message))
                .setAutoCancel(true)
                .setCategory(Notification.CATEGORY_REMINDER);
            NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            manager.notify((id + "-" + tier).hashCode(), builder.build());
        } catch (SecurityException ignored) { }
    }

    private void emitServiceEvent(String message, String type, boolean running) {
        Intent event = new Intent(ACTION_EVENT).setPackage(getPackageName());
        event.putExtra("event", "serviceEvent");
        event.putExtra("message", message);
        event.putExtra("mode", type);
        event.putExtra("running", running);
        sendBroadcast(event);
    }

    private void stopTracking() {
        serviceRunning = false;
        serviceActive = false;
        if (mainHandler != null && providerMonitor != null) mainHandler.removeCallbacks(providerMonitor);
        prefs.edit().putBoolean("running", false).putBoolean("gpsEnabled", false).putString("mode", "STOPPED").apply();
        if (locationManager != null && locationRegistered) {
            try { locationManager.removeUpdates(this); } catch (SecurityException ignored) { }
        }
        locationRegistered = false;
        lastMatchedEdgeId = null;
        if (Build.VERSION.SDK_INT >= 24) stopForeground(STOP_FOREGROUND_REMOVE);
        else stopForeground(true);
        emitServiceEvent("Monitoramento Android interrompido.", "stopped", false);
        stopSelf();
    }

    @Override
    public void onProviderDisabled(String provider) {
        if (LocationManager.GPS_PROVIDER.equals(provider)) {
            prefs.edit().putBoolean("gpsEnabled", false).apply();
            emitServiceEvent("GPS desativado no aparelho. O serviço permanece ativo aguardando reativação.", "gpsDisabled", true);
            updateForegroundNotification("GPS desligado · aguardando ativação");
        }
    }

    @Override
    public void onProviderEnabled(String provider) {
        if (LocationManager.GPS_PROVIDER.equals(provider)) {
            emitServiceEvent("GPS reativado. Retomando atualizações.", "gpsEnabled", true);
            try { startLocationUpdates(); }
            catch (SecurityException error) { emitServiceEvent("Permissão GPS perdida: " + error.getMessage(), "error", false); stopTracking(); }
        }
    }

    @Override public void onStatusChanged(String provider, int status, Bundle extras) { }

    @Override
    public void onDestroy() {
        serviceRunning = false;
        serviceActive = false;
        if (prefs != null) prefs.edit().putBoolean("running", false).putBoolean("gpsEnabled", false).putString("mode", "STOPPED").apply();
        if (mainHandler != null && providerMonitor != null) mainHandler.removeCallbacks(providerMonitor);
        if (locationManager != null && locationRegistered) {
            try { locationManager.removeUpdates(this); } catch (SecurityException ignored) { }
        }
        locationRegistered = false;
        if (locationThread != null) { locationThread.quitSafely(); locationThread = null; }
        if (textToSpeech != null) {
            try { textToSpeech.stop(); textToSpeech.shutdown(); } catch (Exception ignored) { }
            textToSpeech = null;
        }
        super.onDestroy();
    }

    @Override public IBinder onBind(Intent intent) { return null; }
    @Override public void onTaskRemoved(Intent rootIntent) { super.onTaskRemoved(rootIntent); /* Serviço continua após remover a tarefa. */ }

    private static class RoadEdge {
        final String id, wayId, roadKey, fromNode, toNode;
        final int layer;
        final double length, fromLat, fromLng, toLat, toLng, bearing;
        RoadEdge(JSONArray row) {
            id = row.optString(0, ""); wayId = row.optString(1, ""); roadKey = row.optString(2, "");
            fromNode = row.optString(3, ""); toNode = row.optString(4, ""); layer = row.optInt(5, 0);
            length = row.optDouble(6, Double.NaN); fromLat = row.optDouble(7, Double.NaN); fromLng = row.optDouble(8, Double.NaN);
            toLat = row.optDouble(9, Double.NaN); toLng = row.optDouble(10, Double.NaN); bearing = normalize(row.optDouble(11, Double.NaN));
        }
        boolean isValid() { return !id.isEmpty() && !fromNode.isEmpty() && !toNode.isEmpty() && !roadKey.isEmpty()
            && Double.isFinite(length) && length > 0 && Double.isFinite(fromLat) && Double.isFinite(fromLng)
            && Double.isFinite(toLat) && Double.isFinite(toLng) && Double.isFinite(bearing); }
    }

    private static class RadarAttachment {
        final String radarId, edgeId, roadKey, directionSource;
        final int layer;
        final double distAlong, direction, offsetMeters, sectionLength;
        RadarAttachment(JSONArray row) {
            radarId = row.optString(0, ""); edgeId = row.optString(1, ""); roadKey = row.optString(2, "");
            layer = row.optInt(3, 0); distAlong = row.optDouble(4, Double.NaN); direction = normalize(row.optDouble(5, Double.NaN));
            offsetMeters = row.optDouble(6, Double.NaN); sectionLength = row.isNull(7) ? Double.NaN : row.optDouble(7, Double.NaN);
            directionSource = row.optString(8, "unknown");
        }
        boolean isValid() { return !radarId.isEmpty() && !edgeId.isEmpty() && !roadKey.isEmpty()
            && Double.isFinite(distAlong) && Double.isFinite(direction) && Double.isFinite(offsetMeters); }
    }

    private static class Projection {
        final double along, crossTrack;
        Projection(double along, double crossTrack) { this.along = along; this.crossTrack = crossTrack; }
    }

    private static class RoadMatch {
        final RoadEdge edge;
        final double distanceAlong, crossTrack, score;
        RoadMatch(RoadEdge edge, double distanceAlong, double crossTrack, double score) {
            this.edge = edge; this.distanceAlong = distanceAlong; this.crossTrack = crossTrack; this.score = score;
        }
    }

    private static class RoadPathState {
        final String node, previousNode, previousWay;
        final double distance;
        RoadPathState(String node, String previousNode, String previousWay, double distance) {
            this.node = node; this.previousNode = previousNode; this.previousWay = previousWay; this.distance = distance;
        }
    }

    private static class Candidate {
        final JSONObject radar;
        final double distance;
        Candidate(JSONObject radar, double distance) { this.radar = radar; this.distance = distance; }
    }

    private static double normalize(double degrees) { return ((degrees % 360.0) + 360.0) % 360.0; }
    private static double angleDiff(double a, double b) { return Math.abs(((a - b + 540.0) % 360.0) - 180.0); }

    private static double distanceMeters(double lat1, double lon1, double lat2, double lon2) {
        double p1 = Math.toRadians(lat1), p2 = Math.toRadians(lat2);
        double dLat = Math.toRadians(lat2 - lat1), dLon = Math.toRadians(lon2 - lon1);
        double h = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(p1) * Math.cos(p2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
        return 2.0 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
    }

    private static double bearing(Location from, Location to) {
        return normalize(from.bearingTo(to));
    }

    private static double bearing(double lat1, double lon1, double lat2, double lon2) {
        double p1 = Math.toRadians(lat1), p2 = Math.toRadians(lat2), dLon = Math.toRadians(lon2 - lon1);
        double y = Math.sin(dLon) * Math.cos(p2);
        double x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dLon);
        return normalize(Math.toDegrees(Math.atan2(y, x)));
    }
}
