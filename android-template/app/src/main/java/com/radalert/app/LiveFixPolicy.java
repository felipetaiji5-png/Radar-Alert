package com.radalert.app;

/** Rejeita posições antigas antes de atualizar a sessão ou avaliar alertas. */
public final class LiveFixPolicy {
    private LiveFixPolicy() {}

    public static long ageMillis(long fixElapsedNanos, long nowElapsedNanos) {
        if (fixElapsedNanos <= 0 || nowElapsedNanos < fixElapsedNanos) return -1;
        return (nowElapsedNanos - fixElapsedNanos) / 1000000L;
    }

    public static boolean isFresh(long fixElapsedNanos, long nowElapsedNanos) {
        long age = ageMillis(fixElapsedNanos, nowElapsedNanos);
        return age >= 0 && age <= 90000L;
    }

    /** Preserva a idade real ao traduzir para o relógio usado pelo painel web. */
    public static long webTimestamp(long fixElapsedNanos, long nowElapsedNanos, long wallNowMillis) {
        if (!isFresh(fixElapsedNanos, nowElapsedNanos)) return 0;
        return wallNowMillis - ageMillis(fixElapsedNanos, nowElapsedNanos);
    }
}
