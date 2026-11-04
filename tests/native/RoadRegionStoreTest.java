package com.radalert.app;

import org.json.JSONObject;
import java.io.File;
import java.nio.file.Files;
import java.util.List;

public final class RoadRegionStoreTest {
    private static void check(boolean value, String title) {
        if (!value) throw new AssertionError(title);
    }
    private static JSONObject region(double lat, double lng, double radius) {
        return new JSONObject().put("center", new JSONObject().put("lat", lat).put("lng", lng))
            .put("radiusMeters", radius);
    }
    public static void main(String[] args) throws Exception {
        File home = Files.createTempDirectory("radar-regions-").toFile();
        String a = "1234567890ab", b = "9876543210ab";
        try {
            byte[] data = "synthetic road network".getBytes("UTF-8");
            check(RoadRegionStore.cache(home, region(-23.5, -46.8, 3000), data, a) == 1,
                "cache first region");
            check(RoadRegionStore.cache(home, region(-23.49, -46.8, 3000), data, a) == 2,
                "cache second region");
            check(RoadRegionStore.count(home, a) == 2 && RoadRegionStore.count(home, b) == 0,
                "revisions stay isolated");
            File covering = RoadRegionStore.bestCovering(home, -23.49, -46.8, .72, a);
            check(covering != null && covering.isFile(), "find cached road for background GPS");
            check(RoadRegionStore.bestCovering(home, -23.49, -46.8, .72, b) == null,
                "new dataset revision cannot use old road attachments");
            check(RoadRegionStore.bestCovering(home, -23.6, -46.8, .72, a) == null,
                "out-of-region location has no false coverage");
            boolean badRadius = false;
            try { RoadRegionStore.cache(home, region(-23.5, -46.8, 50000), data, a); }
            catch (IllegalArgumentException expected) { badRadius = true; }
            check(badRadius, "rejects overly large region bounds");
            for (int i = 0; i < 20; i++) {
                RoadRegionStore.cache(home, region(-23.5 + i * .02, -46.8, 3000), data, a);
            }
            check(RoadRegionStore.count(home, a) == RoadRegionStore.MAX_REGIONS,
                "keeps the last twelve regional snapshots");
            RoadRegionStore.cache(home, region(-23.5, -46.8, 3000), data, b);
            check(RoadRegionStore.count(home, b) == 1,
                "new catalog can cache independent region");
            RoadRegionStore.clear(home);
            check(RoadRegionStore.count(home, a) == 0 && RoadRegionStore.count(home, b) == 0,
                "clear removes all catalog versions");
            System.out.println("10 testes Java do armazenamento regional passaram.");
        } finally {
            RoadRegionStore.clear(home);
            home.delete();
        }
    }
}
