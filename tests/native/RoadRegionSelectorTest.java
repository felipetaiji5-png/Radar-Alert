package com.radalert.app;

import java.util.Arrays;
import java.util.List;

public class RoadRegionSelectorTest {
    private static void check(boolean value, String title) {
        if (!value) throw new AssertionError(title);
    }

    public static void main(String[] args) {
        RoadRegionSelector.Region home = new RoadRegionSelector.Region("home.json", -23.5000, -46.8000, 3000, 1000);
        RoadRegionSelector.Region ahead = new RoadRegionSelector.Region("ahead.json", -23.4850, -46.8000, 3000, 1001);
        RoadRegionSelector.Region narrow = new RoadRegionSelector.Region("narrow.json", -23.5000, -46.8000, 1000, 2000);
        List<RoadRegionSelector.Region> regions = Arrays.asList(home, ahead, narrow);
        check(RoadRegionSelector.bestCovering(regions, -23.5000, -46.8000, 0.72) == home,
            "prefers wider safety margin over a newer narrow region");
        check(RoadRegionSelector.bestCovering(regions, -23.4800, -46.8000, 0.72) == ahead,
            "switches to previously cached region ahead");
        check(RoadRegionSelector.bestCovering(regions, -23.6000, -46.8000, 0.72) == null,
            "never claims coverage outside any stored region");
        check(RoadRegionSelector.bestCovering(regions, Double.NaN, -46.8, 0.72) == null,
            "rejects NaN GPS location");
        check(RoadRegionSelector.bestCovering(regions, -23.5, -46.8, 1.5) == null,
            "rejects unsafe coverage margin");
        check(RoadRegionSelector.bestCovering(Arrays.asList(
              new RoadRegionSelector.Region("bad.json", -23.5, -46.8, Double.NaN, 9)),
              -23.5, -46.8, 0.72) == null,
            "rejects invalid region radius");
        RoadRegionSelector.Region older = new RoadRegionSelector.Region("older", -23.5, -46.8, 3000, 1);
        RoadRegionSelector.Region newer = new RoadRegionSelector.Region("newer", -23.5, -46.8, 3000, 2);
        check(RoadRegionSelector.bestCovering(Arrays.asList(older, newer), -23.5, -46.8, 0.72) == newer,
            "prefers newer snapshots when coverage is equal");
        double nearby = RoadRegionSelector.distanceMeters(-23.5, -46.8, -23.501, -46.8);
        check(nearby > 109 && nearby < 112,
            "geodesic distance near São Paulo is consistent");
        System.out.println("8 testes Java de seleção de regiões passaram.");
    }
}
