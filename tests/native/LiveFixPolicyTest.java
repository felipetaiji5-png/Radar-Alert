package com.radalert.app;

public final class LiveFixPolicyTest {
    public static void main(String[] args) {
        long now = 1000000000000L;
        if (!LiveFixPolicy.isFresh(now, now)) throw new AssertionError("atual");
        if (!LiveFixPolicy.isFresh(now - 90000000000L, now)) throw new AssertionError("limite");
        for (long timestamp : new long[] { 0, -1, now - 90001000000L, now + 1, Long.MAX_VALUE }) {
            if (LiveFixPolicy.isFresh(timestamp, now)) throw new AssertionError("rejeitar " + timestamp);
        }
        // O horário UTC do GPS não participa da decisão. Relógio do aparelho
        // adiantado/atrasado mantém a mesma idade real no timestamp para a WebView.
        long fix = now - 3000000000L;
        for (long wall : new long[] { 1700000000000L, 1700003600000L, 1699996400000L }) {
            if (LiveFixPolicy.webTimestamp(fix, now, wall) != wall - 3000) throw new AssertionError("relógio civil");
            if (LiveFixPolicy.webTimestamp(fix, now + 2000000000L, wall + 2000) != wall - 3000)
                throw new AssertionError("broadcast atrasado deve preservar idade");
        }
        if (LiveFixPolicy.webTimestamp(fix, now + 90000000000L, 1700000000000L) != 0)
            throw new AssertionError("broadcast antigo não pode renovar posição");
        if (LiveFixPolicy.ageMillis(0, now) != -1) throw new AssertionError("tempo ausente");
        if (LiveFixPolicy.webTimestamp(now + 1, now, 1700000000000L) != 0) throw new AssertionError("futuro monotônico");
        System.out.println("16 checks Java de idade monotônica GPS passaram");
    }
}
