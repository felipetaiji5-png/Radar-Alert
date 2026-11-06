package com.radalert.app;

/** Rejeita posições antigas antes de atualizar a sessão ou avaliar alertas. */
public final class LiveFixPolicy {
    private LiveFixPolicy() {}

    public static boolean isFresh(long timestamp, long now) {
        return timestamp > 0 && timestamp <= now && now - timestamp <= 90000L;
    }
}
