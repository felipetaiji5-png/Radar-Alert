package com.radalert.app;

/** Version gate for radar-to-road attachments; older unversioned snapshots fail closed. */
public final class RoadSnapshotRevision {
    private RoadSnapshotRevision() { }

    public static boolean compatible(String snapshotRevision, String catalogRevision) {
        return catalogRevision != null && catalogRevision.matches("[0-9a-f]{12}")
            && catalogRevision.equals(snapshotRevision);
    }
}
