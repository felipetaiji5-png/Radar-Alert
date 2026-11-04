package com.radalert.app;

import android.util.AtomicFile;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.security.MessageDigest;

/** Stores a bounded number of road networks in internal app storage for offline background use. */
public final class RoadRegionStore {
    public static final int MAX_REGIONS = 12;
    private static final String DIRECTORY = "road-regions-v1";
    private static final Pattern NAME = Pattern.compile("region_([0-9a-f]{12})_(-?\\d+)_(-?\\d+)_(\\d+)\\.json");

    private RoadRegionStore() { }

    public static String catalogRevision(byte[] bytes) throws Exception {
        byte[] digest = MessageDigest.getInstance("SHA-256").digest(bytes);
        StringBuilder result = new StringBuilder();
        for (int i = 0; i < 6; i++) {
            String hex = Integer.toHexString(digest[i] & 0xff);
            if (hex.length() == 1) result.append('0');
            result.append(hex);
        }
        return result.toString();
    }

    public static File directory(File filesDir) { return new File(filesDir, DIRECTORY); }

    public static void writeAtomic(File file, byte[] bytes) throws IOException {
        AtomicFile atomic = new AtomicFile(file);
        FileOutputStream stream = null;
        try {
            stream = atomic.startWrite();
            stream.write(bytes);
            atomic.finishWrite(stream);
        } catch (IOException | RuntimeException error) {
            if (stream != null) atomic.failWrite(stream);
            throw error;
        }
    }

    private static String fileName(JSONObject network, String revision) {
        if (revision == null || !revision.matches("[0-9a-f]{12}"))
            throw new IllegalArgumentException("A base de radares precisa ser sincronizada antes das regiões OSM.");
        JSONObject center = network.optJSONObject("center");
        if (center == null) throw new IllegalArgumentException("Malha sem centro.");
        double lat = center.optDouble("lat", Double.NaN);
        double lng = center.optDouble("lng", Double.NaN);
        double radius = network.optDouble("radiusMeters", 0);
        if (!Double.isFinite(lat) || !Double.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180 ||
            !Double.isFinite(radius) || radius < 500 || radius > 10000) {
            throw new IllegalArgumentException("Centro ou raio da malha OSM inválido.");
        }
        return "region_" + revision + "_" + Math.round(lat * 10000) + "_" + Math.round(lng * 10000)
            + "_" + Math.round(radius) + ".json";
    }

    public static int cache(File filesDir, JSONObject network, byte[] bytes, String revision) throws IOException {
        File folder = directory(filesDir);
        if (!folder.exists() && !folder.mkdirs()) throw new IOException("Não foi possível criar o cache regional.");
        File destination = new File(folder, fileName(network, revision));
        writeAtomic(destination, bytes);
        // Preserve the most recently synced regions, not every road file downloaded over time.
        File[] files = folder.listFiles((dir, name) -> name.startsWith("region_" + revision + "_") && NAME.matcher(name).matches());
        if (files == null) return 0;
        if (files.length > MAX_REGIONS) {
            Arrays.sort(files, Comparator.comparingLong(File::lastModified)
                .thenComparing(File::getName));
            int toRemove = files.length - MAX_REGIONS;
            for (File old : files) {
                if (toRemove <= 0) break;
                if (!old.equals(destination) && old.delete()) toRemove--;
            }
        }
        return count(filesDir, revision);
    }

    public static List<RoadRegionSelector.Region> regions(File filesDir, String revision) {
        List<RoadRegionSelector.Region> result = new ArrayList<>();
        File[] files = directory(filesDir).listFiles();
        if (files == null) return result;
        for (File file : files) {
            if (!file.isFile()) continue;
            Matcher matcher = NAME.matcher(file.getName());
            if (!matcher.matches() || !matcher.group(1).equals(revision)) continue;
            try {
                double lat = Long.parseLong(matcher.group(2)) / 10000.0;
                double lng = Long.parseLong(matcher.group(3)) / 10000.0;
                double radius = Long.parseLong(matcher.group(4));
                if (Math.abs(lat) > 90 || Math.abs(lng) > 180 || radius < 500 || radius > 10000) continue;
                result.add(new RoadRegionSelector.Region(file.getName(), lat, lng, radius, file.lastModified()));
            } catch (NumberFormatException ignored) { }
        }
        return result;
    }

    public static File bestCovering(File filesDir, double lat, double lng, double margin, String revision) {
        RoadRegionSelector.Region found = RoadRegionSelector.bestCovering(regions(filesDir, revision), lat, lng, margin);
        return found == null ? null : new File(directory(filesDir), found.filename);
    }

    public static int count(File filesDir, String revision) { return regions(filesDir, revision).size(); }

    public static void clear(File filesDir) throws IOException {
        File folder = directory(filesDir);
        File[] files = folder.listFiles();
        if (files == null) return;
        for (File file : files) {
            if (!file.delete()) throw new IOException("Não foi possível apagar " + file.getName());
        }
        if (!folder.delete() && folder.exists()) throw new IOException("Não foi possível remover cache regional.");
    }
}
