package org.pathlab.mobile;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(PathLabNativePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
