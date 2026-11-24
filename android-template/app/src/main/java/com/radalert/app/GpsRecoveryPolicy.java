package com.radalert.app;

/** Recupera uma assinatura silenciosa sem reinícios contínuos ou após parada manual. */
public final class GpsRecoveryPolicy {
    private GpsRecoveryPolicy() {}

    public static boolean shouldRetry(boolean running, boolean enabled, boolean registered,
            long nowMillis, long lastValidMillis, long lastRequestMillis) {
        if (!running || !enabled) return false;
        if (!registered) return nowMillis - lastRequestMillis >= 5000L;
        return nowMillis - Math.max(lastValidMillis, lastRequestMillis) >= 45000L;
    }
}
