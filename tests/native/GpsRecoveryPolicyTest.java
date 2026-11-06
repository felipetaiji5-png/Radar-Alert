package com.radalert.app;

public final class GpsRecoveryPolicyTest {
    private static void expect(boolean expected, boolean running, boolean enabled, boolean registered,
            long now, long lastValid, long lastRequest, String message) {
        if (GpsRecoveryPolicy.shouldRetry(running, enabled, registered, now, lastValid, lastRequest) != expected)
            throw new AssertionError(message);
    }

    public static void main(String[] args) {
        expect(false, true, true, true, 144999, 100000, 100000, "aguardar aquisição");
        expect(true, true, true, true, 145000, 100000, 100000, "recuperar assinatura silenciosa");
        expect(false, true, true, true, 150000, 100000, 145000, "não repetir a cada ciclo");
        expect(true, true, true, true, 190000, 100000, 145000, "nova tentativa limitada");
        expect(false, true, true, true, 190000, 186000, 145000, "fix novo encerra recuperação");
        expect(false, false, true, true, 999999, 0, 0, "parada manual respeitada");
        expect(false, true, false, true, 999999, 0, 0, "GPS desligado aguarda usuário");
        expect(true, true, true, false, 105000, 0, 100000, "erro de registro permite nova tentativa");
        expect(false, true, true, false, 104999, 0, 100000, "erro não causa loop imediato");
        expect(false, true, true, true, 5000, 0, 1000, "primeira aquisição tem tempo");
        System.out.println("10 checks Java de recuperação GPS passaram");
    }
}
