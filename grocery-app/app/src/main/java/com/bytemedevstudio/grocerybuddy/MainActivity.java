package com.bytemedevstudio.grocerybuddy;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;

/**
 * Hosts the app's screens (HTML in assets/www) in a WebView.
 *
 * Everything stays on the phone: data is saved in SharedPreferences through the
 * "Android" bridge, and any web link (weekly ads, maps) opens in the phone's own
 * browser instead of inside the app.
 */
public class MainActivity extends Activity {

    private static final String START_PAGE = "file:///android_asset/www/index.html";
    private static final String PREFS = "grocery_buddy";

    private WebView web;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.parseColor("#1B5E20"));
        web = new WebView(this);
        web.setBackgroundColor(Color.parseColor("#FFFDF7"));
        root.addView(web, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        setContentView(root);

        // Android 15 draws apps under the status and navigation bars; keep the
        // screens (and the keyboard) clear of them.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            root.setOnApplyWindowInsetsListener((View v, WindowInsets insets) -> {
                android.graphics.Insets bars = insets.getInsets(
                        WindowInsets.Type.systemBars() | WindowInsets.Type.ime()
                                | WindowInsets.Type.displayCutout());
                v.setPadding(bars.left, bars.top, bars.right, bars.bottom);
                return WindowInsets.CONSUMED;
            });
        }

        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        // The app has its own text-size buttons, so ignore the system zoom here
        // to keep the big buttons from overflowing the screen.
        settings.setTextZoom(100);

        web.addJavascriptInterface(new Bridge(getApplicationContext()), "Android");
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (uri.toString().startsWith("file:///android_asset/")) {
                    return false;
                }
                openExternal(uri);
                return true;
            }
        });

        web.loadUrl(START_PAGE);
    }

    private void openExternal(Uri uri) {
        String scheme = uri.getScheme() == null ? "" : uri.getScheme();
        Intent intent;
        if (scheme.equals("tel")) {
            intent = new Intent(Intent.ACTION_DIAL, uri);
        } else if (scheme.equals("https") || scheme.equals("http")) {
            intent = new Intent(Intent.ACTION_VIEW, uri);
        } else {
            return;
        }
        try {
            startActivity(intent);
        } catch (ActivityNotFoundException e) {
            Toast.makeText(this, "No app on this phone can open that.", Toast.LENGTH_LONG).show();
        }
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        // Let the page close an open box or go back to the list first.
        web.evaluateJavascript("window.appBack ? window.appBack() : false", value -> {
            if (!"true".equals(value)) {
                finish();
            }
        });
    }

    @Override
    protected void onDestroy() {
        if (web != null) {
            web.destroy();
        }
        super.onDestroy();
    }

    /** Methods the page can call as window.Android.* */
    private class Bridge {
        private final SharedPreferences prefs;

        Bridge(Context context) {
            prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        }

        @JavascriptInterface
        public String load(String key) {
            return prefs.getString(key, null);
        }

        @JavascriptInterface
        public boolean save(String key, String value) {
            return prefs.edit().putString(key, value).commit();
        }

        @JavascriptInterface
        public void openUrl(String url) {
            runOnUiThread(() -> openExternal(Uri.parse(url)));
        }

        @JavascriptInterface
        public void share(String text) {
            runOnUiThread(() -> {
                Intent send = new Intent(Intent.ACTION_SEND);
                send.setType("text/plain");
                send.putExtra(Intent.EXTRA_TEXT, text);
                try {
                    startActivity(Intent.createChooser(send, "Send with"));
                } catch (ActivityNotFoundException e) {
                    Toast.makeText(MainActivity.this, "No app on this phone can send that.",
                            Toast.LENGTH_LONG).show();
                }
            });
        }
    }
}
