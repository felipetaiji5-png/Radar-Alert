package com.radalert.app;

public final class LiveFixPolicyTest {
    public static void main(String[] args) {
        long now = 1000000;
        if (!LiveFixPolicy.isFresh(now, now)) throw new AssertionError("atual");
        if (!LiveFixPolicy.isFresh(now - 90000, now)) throw new AssertionError("limite");
        for (long timestamp : new long[] { 0, -1, now - 90001, now + 1, Long.MAX_VALUE }) {
            if (LiveFixPolicy.isFresh(timestamp, now)) throw new AssertionError("rejeitar " + timestamp);
        }
        System.out.println("7 checks Java de idade GPS passaram");
    }
}
