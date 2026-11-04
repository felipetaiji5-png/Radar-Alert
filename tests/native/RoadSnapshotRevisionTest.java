package com.radalert.app;

public final class RoadSnapshotRevisionTest {
    public static void main(String[] args) {
        String valid = "0123456789ab";
        check(RoadSnapshotRevision.compatible(valid, valid), "mesma revisão deve aceitar");
        check(!RoadSnapshotRevision.compatible("", valid), "snapshot legado deve rejeitar");
        check(!RoadSnapshotRevision.compatible(null, valid), "snapshot ausente deve rejeitar");
        check(!RoadSnapshotRevision.compatible("fedcba987654", valid), "outra revisão deve rejeitar");
        check(!RoadSnapshotRevision.compatible(valid, ""), "catálogo ausente deve rejeitar");
        check(!RoadSnapshotRevision.compatible(valid, null), "catálogo nulo deve rejeitar");
        check(!RoadSnapshotRevision.compatible(valid, "abc"), "revisão incorreta deve rejeitar");
        System.out.println("7 checks Java de revisao passaram");
    }
    private static void check(boolean condition, String message) {
        if (!condition) throw new AssertionError(message);
    }
}
