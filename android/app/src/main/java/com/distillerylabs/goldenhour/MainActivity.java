package com.distillerylabs.goldenhour;

import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.webkit.PermissionRequest;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebChromeClient;

public class MainActivity extends BridgeActivity {

    private static final int RUNTIME_PERMISSIONS_REQUEST = 1001;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        ensureRuntimePermissions();
        installPermissiveWebChromeClient();
    }

    /**
     * Ask Android for RECORD_AUDIO + ACCESS_FINE_LOCATION on first launch.
     * Capacitor declares them in the manifest, but post-API-23 still needs
     * the runtime grant before getUserMedia / Geolocation will work.
     */
    private void ensureRuntimePermissions() {
        if (Build.VERSION.SDK_INT < 23) return;

        String[] needed = new String[] {
            Manifest.permission.RECORD_AUDIO,
            Manifest.permission.ACCESS_FINE_LOCATION
        };

        boolean missing = false;
        for (String p : needed) {
            if (ContextCompat.checkSelfPermission(this, p) != PackageManager.PERMISSION_GRANTED) {
                missing = true;
                break;
            }
        }
        if (missing) {
            ActivityCompat.requestPermissions(this, needed, RUNTIME_PERMISSIONS_REQUEST);
        }
    }

    /**
     * Forward WebView permission requests (getUserMedia, etc.) to the
     * permissions Android has already granted. Capacitor's default
     * BridgeWebChromeClient only auto-grants for plugins it knows about,
     * so we override onPermissionRequest to grant any resource the page
     * asks for that we've already secured at the OS level.
     */
    private void installPermissiveWebChromeClient() {
        bridge.getWebView().setWebChromeClient(new BridgeWebChromeClient(bridge) {
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                runOnUiThread(() -> request.grant(request.getResources()));
            }
        });
    }
}
