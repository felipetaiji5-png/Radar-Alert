package com.radalert.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(RadarTrackingPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
