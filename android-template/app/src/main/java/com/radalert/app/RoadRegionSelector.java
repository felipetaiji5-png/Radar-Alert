package com.radalert.app;

import java.util.List;

/** Pure-Java selection of a previously cached road region. No GPS or UI dependencies. */
public final class RoadRegionSelector {
    private static final double EARTH_RADIUS_METERS = 6371000.0;

    private RoadRegionSelector() { }

    public static final class Region {
        public final String filename;
        public final double latitude;
        public final double longitude;
        public final double radiusMeters;
        public final long updatedAt;

        public Region(String filename, double latitude, double longitude, double radiusMeters, long updatedAt) {
            this.filename = filename;
            this.latitude = latitude;
            this.longitude = longitude;
            this.radiusMeters = radiusMeters;
            this.updatedAt = updatedAt;
        }
    }

    public static double distanceMeters(double latA, double lngA, double latB, double lngB) {
        double aLat = Math.toRadians(latA), bLat = Math.toRadians(latB);
        double dLat = bLat - aLat, dLng = Math.toRadians(lngB - lngA);
        double h = Math.sin(dLat / 2) * Math.sin(dLat / 2)
            + Math.cos(aLat) * Math.cos(bLat) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
        return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1.0, Math.sqrt(Math.max(0.0, h))));
    }

    /** Chooses the region with the largest safe remaining radius, not merely the latest file. */
    public static Region bestCovering(List<Region> regions, double lat, double lng, double margin) {
        if (!Double.isFinite(lat) || !Double.isFinite(lng) || lat < -90 || lat > 90 ||
            lng < -180 || lng > 180 || !Double.isFinite(margin) || margin <= 0 || margin > 1) return null;
        Region best = null;
        double bestRemaining = -1;
        for (Region region : regions) {
            if (region == null || !Double.isFinite(region.latitude) || !Double.isFinite(region.longitude) ||
                !Double.isFinite(region.radiusMeters) || region.radiusMeters <= 0) continue;
            double remaining = region.radiusMeters * margin
                - distanceMeters(lat, lng, region.latitude, region.longitude);
            if (remaining < 0) continue;
            if (best == null || remaining > bestRemaining + 0.1 ||
                (Math.abs(remaining - bestRemaining) <= 0.1 && region.updatedAt > best.updatedAt)) {
                best = region;
                bestRemaining = remaining;
            }
        }
        return best;
    }
}
