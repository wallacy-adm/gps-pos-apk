const { withAndroidManifest, withDangerousMod, withMainApplication } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTES
// ─────────────────────────────────────────────────────────────────────────────
const SUPABASE_URL = 'https://pbzoggfmegmawbnmblpm.supabase.co';
const ANON_KEY     = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBiem9nZ2ZtZWdtYXdibm1ibHBtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkzMDYzOTksImV4cCI6MjA5NDg4MjM5OX0.OpRY-AH7vHsQYHzi39QpqiYL_uNxWOZFE_pYvOSo3Ic';

// ─────────────────────────────────────────────────────────────────────────────
// ImeiModule — bridge nativo React Native (old arch) que expõe getImei() para JS
// Lê IMEI via TelephonyManager (Android 9 suporta sem restrição com READ_PHONE_STATE)
// ─────────────────────────────────────────────────────────────────────────────
const IMEI_MODULE_JAVA = `package com.system.posservice;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.PowerManager;
import android.provider.Settings;
import android.telephony.TelephonyManager;
import androidx.core.content.ContextCompat;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;

public class ImeiModule extends ReactContextBaseJavaModule {

    public ImeiModule(ReactApplicationContext reactContext) {
        super(reactContext);
    }

    @Override
    public String getName() {
        return "ImeiModule";
    }

    @ReactMethod
    public void getImei(Promise promise) {
        try {
            Context ctx = getReactApplicationContext();
            if (ContextCompat.checkSelfPermission(ctx, Manifest.permission.READ_PHONE_STATE)
                    != PackageManager.PERMISSION_GRANTED) {
                promise.resolve(null);
                return;
            }
            TelephonyManager tm = (TelephonyManager) ctx.getSystemService(Context.TELEPHONY_SERVICE);
            if (tm == null) {
                promise.resolve(null);
                return;
            }
            String imei = tm.getImei();
            promise.resolve(imei);
        } catch (Exception e) {
            promise.resolve(null);
        }
    }

    @ReactMethod
    public void requestBatteryOptimizationExemption(Promise promise) {
        try {
            PowerManager pm = (PowerManager)
                getReactApplicationContext().getSystemService(Context.POWER_SERVICE);
            String pkg = getReactApplicationContext().getPackageName();
            if (pm != null && !pm.isIgnoringBatteryOptimizations(pkg)) {
                Intent intent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
                intent.setData(Uri.parse("package:" + pkg));
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getReactApplicationContext().startActivity(intent);
            }
            promise.resolve(true);
        } catch (Exception e) {
            promise.resolve(false);
        }
    }

    @ReactMethod
    public void isIgnoringBatteryOptimizations(Promise promise) {
        try {
            PowerManager pm = (PowerManager)
                getReactApplicationContext().getSystemService(Context.POWER_SERVICE);
            String pkg = getReactApplicationContext().getPackageName();
            boolean ignoring = pm != null && pm.isIgnoringBatteryOptimizations(pkg);
            promise.resolve(ignoring);
        } catch (Exception e) {
            promise.resolve(false);
        }
    }
}
`;

// ─────────────────────────────────────────────────────────────────────────────
// ImeiPackage — registra ImeiModule no React Native package system
// ─────────────────────────────────────────────────────────────────────────────
const IMEI_PACKAGE_JAVA = `package com.system.posservice;

import com.facebook.react.ReactPackage;
import com.facebook.react.bridge.NativeModule;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.uimanager.ViewManager;

import java.util.Arrays;
import java.util.Collections;
import java.util.List;

public class ImeiPackage implements ReactPackage {

    @Override
    public List<NativeModule> createNativeModules(ReactApplicationContext reactContext) {
        return Arrays.<NativeModule>asList(new ImeiModule(reactContext));
    }

    @Override
    public List<ViewManager> createViewManagers(ReactApplicationContext reactContext) {
        return Collections.emptyList();
    }
}
`;


// ─────────────────────────────────────────────────────────────────────────────
// BootReceiver — dispara quando o dispositivo termina de ligar
// → lê IMEI → captura localização → envia evento 'boot' ao Supabase
// → agenda alarme de backup → abre o app para iniciar serviço GPS
// ─────────────────────────────────────────────────────────────────────────────
const BOOT_RECEIVER_JAVA = `package com.system.posservice;

import android.Manifest;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.location.Location;
import android.location.LocationManager;
import android.provider.Settings;
import android.telephony.TelephonyManager;
import androidx.core.content.ContextCompat;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;

public class BootReceiver extends BroadcastReceiver {

    private static final String SUPABASE_URL = "${SUPABASE_URL}";
    private static final String ANON_KEY     = "${ANON_KEY}";

    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent.getAction();
        if (!Intent.ACTION_BOOT_COMPLETED.equals(action)
                && !"android.intent.action.QUICKBOOT_POWERON".equals(action)) {
            return;
        }

        // 1. Lê IMEI (Android 9 com READ_PHONE_STATE) ou fallback para AndroidId
        String serial = getImei(context);

        // 2. Captura última localização conhecida
        double lat = 0, lng = 0;
        boolean hasLoc = false;
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION)
                == PackageManager.PERMISSION_GRANTED) {
            LocationManager lm = (LocationManager) context.getSystemService(Context.LOCATION_SERVICE);
            if (lm != null) {
                Location loc = lm.getLastKnownLocation(LocationManager.GPS_PROVIDER);
                if (loc == null) loc = lm.getLastKnownLocation(LocationManager.NETWORK_PROVIDER);
                if (loc == null) loc = lm.getLastKnownLocation(LocationManager.PASSIVE_PROVIDER);
                if (loc != null) {
                    lat = loc.getLatitude();
                    lng = loc.getLongitude();
                    hasLoc = true;
                }
            }
        }

        String now = isoNow();

        // 3. Upsert device → recebe UUID → insere evento 'boot'
        String devBody = buildDeviceBody(serial, "online", now, hasLoc, lat, lng);
        String deviceId = upsertDeviceAndGetId(devBody);
        if (deviceId != null) {
            SimpleDateFormat timeFmt = new SimpleDateFormat("HH:mm", Locale.US);
            timeFmt.setTimeZone(TimeZone.getTimeZone("America/Sao_Paulo"));
            String timeStr = timeFmt.format(new Date());
            String desc = hasLoc
                ? "Liga " + timeStr + " | " + String.format(Locale.US, "%.6f, %.6f", lat, lng)
                : "Liga " + timeStr + " | localização não disponível";
            String evBody = buildEventBody(deviceId, "boot", desc, hasLoc, lat, lng, now);
            postEvent(evBody);
        }

        // 4. Agenda alarme de backup a cada 3h
        AlarmScheduler.schedule(context);

        // 5. Abre o app para iniciar o serviço GPS foreground
        // getLaunchIntentForPackage retorna null se CATEGORY_LAUNCHER foi removido;
        // usar setClassName garante que o launch funciona independente do manifest.
        try {
            Intent launch = new Intent();
            launch.setClassName(context.getPackageName(),
                    context.getPackageName() + ".MainActivity");
            launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK
                          | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            context.startActivity(launch);
        } catch (Exception ignored) {}
    }

    private String getImei(Context context) {
        try {
            if (ContextCompat.checkSelfPermission(context, Manifest.permission.READ_PHONE_STATE)
                    == PackageManager.PERMISSION_GRANTED) {
                TelephonyManager tm = (TelephonyManager) context.getSystemService(Context.TELEPHONY_SERVICE);
                if (tm != null) {
                    String imei = tm.getImei();
                    if (imei != null && imei.length() >= 14) return imei;
                }
            }
        } catch (Exception ignored) {}
        // Fallback para Android ID
        return Settings.Secure.getString(context.getContentResolver(), Settings.Secure.ANDROID_ID);
    }

    private String buildDeviceBody(String serial, String status, String now,
                                   boolean hasLoc, double lat, double lng) {
        StringBuilder sb = new StringBuilder();
        sb.append("{");
        sb.append("\\"serial\\":\\"").append(serial).append("\\",");
        sb.append("\\"status\\":\\"").append(status).append("\\",");
        sb.append("\\"last_seen_at\\":\\"").append(now).append("\\"");
        if (hasLoc) {
            sb.append(",\\"last_lat\\":").append(String.format(Locale.US, "%.8f", lat));
            sb.append(",\\"last_lng\\":").append(String.format(Locale.US, "%.8f", lng));
        }
        // Se serial é IMEI (14-15 dígitos numéricos), salva também no campo imei separado
        if (serial.length() >= 14 && serial.matches("[0-9]+")) {
            sb.append(",\\"imei\\":\\"").append(serial).append("\\"");
        }
        sb.append("}");
        return sb.toString();
    }

    private String buildEventBody(String deviceId, String type, String desc,
                                  boolean hasLoc, double lat, double lng, String now) {
        StringBuilder sb = new StringBuilder();
        sb.append("{");
        sb.append("\\"device_id\\":\\"").append(deviceId).append("\\",");
        sb.append("\\"type\\":\\"").append(type).append("\\",");
        sb.append("\\"description\\":\\"").append(desc).append("\\"");
        if (hasLoc) {
            sb.append(",\\"lat\\":").append(String.format(Locale.US, "%.8f", lat));
            sb.append(",\\"lng\\":").append(String.format(Locale.US, "%.8f", lng));
        }
        sb.append(",\\"created_at\\":\\"").append(now).append("\\"");
        sb.append("}");
        return sb.toString();
    }

    /** Faz upsert do device e retorna o UUID (id) do registro */
    private String upsertDeviceAndGetId(String body) {
        HttpURLConnection conn = null;
        try {
            URL url = new URL(SUPABASE_URL + "/rest/v1/devices?on_conflict=serial");
            conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("POST");
            conn.setRequestProperty("apikey", ANON_KEY);
            conn.setRequestProperty("Authorization", "Bearer " + ANON_KEY);
            conn.setRequestProperty("Content-Type", "application/json");
            conn.setRequestProperty("Prefer", "resolution=merge-duplicates,return=representation");
            conn.setDoOutput(true);
            conn.setConnectTimeout(8000);
            conn.setReadTimeout(8000);

            byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
            conn.setFixedLengthStreamingMode(bytes.length);
            try (OutputStream os = conn.getOutputStream()) { os.write(bytes); }

            int code = conn.getResponseCode();
            if (code == 200 || code == 201) {
                java.io.InputStream is = conn.getInputStream();
                byte[] buf = new byte[512];
                StringBuilder sb = new StringBuilder();
                int n;
                while ((n = is.read(buf)) != -1) sb.append(new String(buf, 0, n, StandardCharsets.UTF_8));
                String resp = sb.toString();
                // Extrai "id":"UUID" do JSON
                int idx = resp.indexOf("\\"id\\":\\"");
                if (idx >= 0) {
                    int start = idx + 7;
                    int end = resp.indexOf("\\"", start);
                    if (end > start) return resp.substring(start, end);
                }
            }
        } catch (Exception ignored) {
        } finally {
            if (conn != null) conn.disconnect();
        }
        return null;
    }

    private void postEvent(String body) {
        HttpURLConnection conn = null;
        try {
            URL url = new URL(SUPABASE_URL + "/rest/v1/events");
            conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("POST");
            conn.setRequestProperty("apikey", ANON_KEY);
            conn.setRequestProperty("Authorization", "Bearer " + ANON_KEY);
            conn.setRequestProperty("Content-Type", "application/json");
            conn.setRequestProperty("Prefer", "return=minimal");
            conn.setDoOutput(true);
            conn.setConnectTimeout(8000);
            conn.setReadTimeout(8000);
            byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
            conn.setFixedLengthStreamingMode(bytes.length);
            try (OutputStream os = conn.getOutputStream()) { os.write(bytes); }
            conn.getResponseCode();
        } catch (Exception ignored) {
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private String isoNow() {
        SimpleDateFormat sdf = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US);
        sdf.setTimeZone(TimeZone.getTimeZone("UTC"));
        return sdf.format(new Date());
    }
}
`;

// ─────────────────────────────────────────────────────────────────────────────
// ShutdownReceiver — dispara quando o dispositivo vai desligar
// → lê IMEI → captura última localização → status=offline + evento 'shutdown'
// Janela de execução: ~10 segundos. Faz 2 chamadas HTTP sequenciais.
// ─────────────────────────────────────────────────────────────────────────────
const SHUTDOWN_RECEIVER_JAVA = `package com.system.posservice;

import android.Manifest;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.location.Location;
import android.location.LocationManager;
import android.provider.Settings;
import android.telephony.TelephonyManager;
import androidx.core.content.ContextCompat;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;

public class ShutdownReceiver extends BroadcastReceiver {

    private static final String SUPABASE_URL = "${SUPABASE_URL}";
    private static final String ANON_KEY     = "${ANON_KEY}";

    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent.getAction();
        if (!Intent.ACTION_SHUTDOWN.equals(action)
                && !"android.intent.action.QUICKBOOT_POWEROFF".equals(action)
                && !Intent.ACTION_REBOOT.equals(action)) {
            return;
        }

        String serial = getImei(context);
        String now    = isoNow();

        // Captura última localização conhecida (não requer novo fix GPS)
        double lat = 0, lng = 0;
        boolean hasLoc = false;
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION)
                == PackageManager.PERMISSION_GRANTED) {
            LocationManager lm = (LocationManager) context.getSystemService(Context.LOCATION_SERVICE);
            if (lm != null) {
                Location loc = lm.getLastKnownLocation(LocationManager.GPS_PROVIDER);
                if (loc == null) loc = lm.getLastKnownLocation(LocationManager.NETWORK_PROVIDER);
                if (loc == null) loc = lm.getLastKnownLocation(LocationManager.PASSIVE_PROVIDER);
                if (loc != null) { lat = loc.getLatitude(); lng = loc.getLongitude(); hasLoc = true; }
            }
        }

        // 1. Upsert device (status=offline, com localização de desligamento)
        String devBody = buildDeviceBody(serial, "offline", now, hasLoc, lat, lng);
        String deviceId = upsertDeviceAndGetId(devBody);

        // 2. Insere evento 'shutdown' com localização
        if (deviceId != null) {
            SimpleDateFormat timeFmt2 = new SimpleDateFormat("HH:mm", Locale.US);
            timeFmt2.setTimeZone(TimeZone.getTimeZone("America/Sao_Paulo"));
            String timeStr2 = timeFmt2.format(new Date());
            String desc = hasLoc
                ? "Desliga " + timeStr2 + " | " + String.format(Locale.US, "%.6f, %.6f", lat, lng)
                : "Desliga " + timeStr2 + " | localização não disponível";
            postEvent(buildEventBody(deviceId, "shutdown", desc, hasLoc, lat, lng, now));
        }
    }

    private String getImei(Context context) {
        try {
            if (ContextCompat.checkSelfPermission(context, Manifest.permission.READ_PHONE_STATE)
                    == PackageManager.PERMISSION_GRANTED) {
                TelephonyManager tm = (TelephonyManager) context.getSystemService(Context.TELEPHONY_SERVICE);
                if (tm != null) {
                    String imei = tm.getImei();
                    if (imei != null && imei.length() >= 14) return imei;
                }
            }
        } catch (Exception ignored) {}
        return Settings.Secure.getString(context.getContentResolver(), Settings.Secure.ANDROID_ID);
    }

    private String buildDeviceBody(String serial, String status, String now,
                                   boolean hasLoc, double lat, double lng) {
        StringBuilder sb = new StringBuilder();
        sb.append("{");
        sb.append("\\"serial\\":\\"").append(serial).append("\\",");
        sb.append("\\"status\\":\\"").append(status).append("\\",");
        sb.append("\\"last_seen_at\\":\\"").append(now).append("\\"");
        if (hasLoc) {
            sb.append(",\\"last_lat\\":").append(String.format(Locale.US, "%.8f", lat));
            sb.append(",\\"last_lng\\":").append(String.format(Locale.US, "%.8f", lng));
        }
        // Se serial é IMEI (14-15 dígitos numéricos), salva também no campo imei separado
        if (serial.length() >= 14 && serial.matches("[0-9]+")) {
            sb.append(",\\"imei\\":\\"").append(serial).append("\\"");
        }
        sb.append("}");
        return sb.toString();
    }

    private String buildEventBody(String deviceId, String type, String desc,
                                  boolean hasLoc, double lat, double lng, String now) {
        StringBuilder sb = new StringBuilder();
        sb.append("{");
        sb.append("\\"device_id\\":\\"").append(deviceId).append("\\",");
        sb.append("\\"type\\":\\"").append(type).append("\\",");
        sb.append("\\"description\\":\\"").append(desc).append("\\"");
        if (hasLoc) {
            sb.append(",\\"lat\\":").append(String.format(Locale.US, "%.8f", lat));
            sb.append(",\\"lng\\":").append(String.format(Locale.US, "%.8f", lng));
        }
        sb.append(",\\"created_at\\":\\"").append(now).append("\\"");
        sb.append("}");
        return sb.toString();
    }

    private String upsertDeviceAndGetId(String body) {
        HttpURLConnection conn = null;
        try {
            URL url = new URL(SUPABASE_URL + "/rest/v1/devices?on_conflict=serial");
            conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("POST");
            conn.setRequestProperty("apikey", ANON_KEY);
            conn.setRequestProperty("Authorization", "Bearer " + ANON_KEY);
            conn.setRequestProperty("Content-Type", "application/json");
            conn.setRequestProperty("Prefer", "resolution=merge-duplicates,return=representation");
            conn.setDoOutput(true);
            conn.setConnectTimeout(4000);
            conn.setReadTimeout(4000);
            byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
            conn.setFixedLengthStreamingMode(bytes.length);
            try (OutputStream os = conn.getOutputStream()) { os.write(bytes); }
            int code = conn.getResponseCode();
            if (code == 200 || code == 201) {
                java.io.InputStream is = conn.getInputStream();
                byte[] buf = new byte[512];
                StringBuilder sb = new StringBuilder();
                int n;
                while ((n = is.read(buf)) != -1) sb.append(new String(buf, 0, n, StandardCharsets.UTF_8));
                String resp = sb.toString();
                int idx = resp.indexOf("\\"id\\":\\"");
                if (idx >= 0) {
                    int start = idx + 7;
                    int end = resp.indexOf("\\"", start);
                    if (end > start) return resp.substring(start, end);
                }
            }
        } catch (Exception ignored) {
        } finally {
            if (conn != null) conn.disconnect();
        }
        return null;
    }

    private void postEvent(String body) {
        HttpURLConnection conn = null;
        try {
            URL url = new URL(SUPABASE_URL + "/rest/v1/events");
            conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("POST");
            conn.setRequestProperty("apikey", ANON_KEY);
            conn.setRequestProperty("Authorization", "Bearer " + ANON_KEY);
            conn.setRequestProperty("Content-Type", "application/json");
            conn.setRequestProperty("Prefer", "return=minimal");
            conn.setDoOutput(true);
            conn.setConnectTimeout(6000);
            conn.setReadTimeout(6000);
            byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
            conn.setFixedLengthStreamingMode(bytes.length);
            try (OutputStream os = conn.getOutputStream()) { os.write(bytes); }
            conn.getResponseCode();
        } catch (Exception ignored) {
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private String isoNow() {
        SimpleDateFormat sdf = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US);
        sdf.setTimeZone(TimeZone.getTimeZone("UTC"));
        return sdf.format(new Date());
    }
}
`;

// ─────────────────────────────────────────────────────────────────────────────
// AlarmReceiver — backup ping a cada 3 horas (usa IMEI)
// ─────────────────────────────────────────────────────────────────────────────
const ALARM_RECEIVER_JAVA = `package com.system.posservice;

import android.Manifest;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.provider.Settings;
import android.telephony.TelephonyManager;
import androidx.core.content.ContextCompat;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;

public class AlarmReceiver extends BroadcastReceiver {

    private static final String SUPABASE_URL = "${SUPABASE_URL}";
    private static final String ANON_KEY     = "${ANON_KEY}";
    public  static final String ACTION_BACKUP_PING = "com.system.posservice.BACKUP_PING";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (!ACTION_BACKUP_PING.equals(intent.getAction())) return;

        String serial = getImei(context);
        String now    = isoNow();
        String body   = "{\\"serial\\":\\"" + serial + "\\","
                      + "\\"status\\":\\"online\\"," 
                      + "\\"last_seen_at\\":\\"" + now + "\\"}";
        postToSupabase(body);
    }

    private String getImei(Context context) {
        try {
            if (ContextCompat.checkSelfPermission(context, Manifest.permission.READ_PHONE_STATE)
                    == PackageManager.PERMISSION_GRANTED) {
                TelephonyManager tm = (TelephonyManager) context.getSystemService(Context.TELEPHONY_SERVICE);
                if (tm != null) {
                    String imei = tm.getImei();
                    if (imei != null && imei.length() >= 14) return imei;
                }
            }
        } catch (Exception ignored) {}
        return Settings.Secure.getString(context.getContentResolver(), Settings.Secure.ANDROID_ID);
    }

    private void postToSupabase(String body) {
        HttpURLConnection conn = null;
        try {
            URL url = new URL(SUPABASE_URL + "/rest/v1/devices?on_conflict=serial");
            conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("POST");
            conn.setRequestProperty("apikey", ANON_KEY);
            conn.setRequestProperty("Authorization", "Bearer " + ANON_KEY);
            conn.setRequestProperty("Content-Type", "application/json");
            conn.setRequestProperty("Prefer", "resolution=merge-duplicates");
            conn.setDoOutput(true);
            conn.setConnectTimeout(10000);
            conn.setReadTimeout(10000);
            byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
            conn.setFixedLengthStreamingMode(bytes.length);
            try (OutputStream os = conn.getOutputStream()) { os.write(bytes); }
            conn.getResponseCode();
        } catch (Exception ignored) {
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private String isoNow() {
        SimpleDateFormat sdf = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US);
        sdf.setTimeZone(TimeZone.getTimeZone("UTC"));
        return sdf.format(new Date());
    }
}
`;

// ─────────────────────────────────────────────────────────────────────────────
// AlarmScheduler — utilitário para agendar alarme de backup
// ─────────────────────────────────────────────────────────────────────────────
const ALARM_SCHEDULER_JAVA = `package com.system.posservice;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

public class AlarmScheduler {

    private static final long INTERVAL_MS = 5 * 60 * 1000L; // 5 minutos

    public static void schedule(Context context) {
        AlarmManager am = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;

        Intent intent = new Intent(context, AlarmReceiver.class);
        intent.setAction(AlarmReceiver.ACTION_BACKUP_PING);

        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= 23) flags |= PendingIntent.FLAG_IMMUTABLE;

        PendingIntent pi = PendingIntent.getBroadcast(context, 0, intent, flags);
        am.cancel(pi);
        am.setInexactRepeating(
            AlarmManager.RTC_WAKEUP,
            System.currentTimeMillis() + INTERVAL_MS,
            INTERVAL_MS,
            pi
        );
    }
}
`;

// ─────────────────────────────────────────────────────────────────────────────
// Plugin principal
// ─────────────────────────────────────────────────────────────────────────────
module.exports = function withBootReceiver(config) {

  // ── 1. Registra receivers + permissões no AndroidManifest ─────────────────
  config = withAndroidManifest(config, (androidConfig) => {
    const manifest = androidConfig.modResults.manifest;
    const app      = manifest.application?.[0];
    if (!app) return androidConfig;
    if (!app.receiver) app.receiver = [];

    const hasReceiver = (name) =>
      app.receiver.some((r) => r.$?.['android:name'] === name);

    if (!hasReceiver('.BootReceiver')) {
      app.receiver.push({
        $: { 'android:name': '.BootReceiver', 'android:enabled': 'true', 'android:exported': 'true' },
        'intent-filter': [{ action: [
          { $: { 'android:name': 'android.intent.action.BOOT_COMPLETED' } },
          { $: { 'android:name': 'android.intent.action.QUICKBOOT_POWERON' } },
        ]}],
      });
    }

    if (!hasReceiver('.ShutdownReceiver')) {
      app.receiver.push({
        $: { 'android:name': '.ShutdownReceiver', 'android:enabled': 'true', 'android:exported': 'true' },
        'intent-filter': [{ action: [
          { $: { 'android:name': 'android.intent.action.ACTION_SHUTDOWN' } },
          { $: { 'android:name': 'android.intent.action.QUICKBOOT_POWEROFF' } },
          { $: { 'android:name': 'android.intent.action.REBOOT' } },
        ]}],
      });
    }

    if (!hasReceiver('.AlarmReceiver')) {
      app.receiver.push({
        $: { 'android:name': '.AlarmReceiver', 'android:enabled': 'true', 'android:exported': 'false' },
        'intent-filter': [{ action: [
          { $: { 'android:name': 'com.system.posservice.BACKUP_PING' } },
        ]}],
      });
    }

    const perms = manifest['uses-permission'] ?? [];

    const addPerm = (name) => {
      if (!perms.some((p) => p.$?.['android:name'] === name)) {
        perms.push({ $: { 'android:name': name } });
      }
    };
    addPerm('android.permission.RECEIVE_BOOT_COMPLETED');
    addPerm('android.permission.READ_PHONE_STATE');
    addPerm('android.permission.WAKE_LOCK');
    addPerm('android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS');

    manifest['uses-permission'] = perms;
    return androidConfig;
  });

  // ── 2. Registra ImeiPackage no MainApplication ────────────────────────────
  config = withMainApplication(config, (appConfig) => {
    let src = appConfig.modResults.contents;

    // Adiciona import
    if (!src.includes('import com.system.posservice.ImeiPackage')) {
      src = src.replace(
        /^(package com\.system\.posservice;)/m,
        '$1\nimport com.system.posservice.ImeiPackage;'
      );
    }

    // Adiciona package à lista (compatível com Expo SDK 54)
    if (!src.includes('new ImeiPackage()')) {
      src = src.replace(
        /List<ReactPackage> packages = new PackageList\(this\)\.getPackages\(\);/,
        'List<ReactPackage> packages = new PackageList(this).getPackages();\n    packages.add(new ImeiPackage());'
      );
    }

    appConfig.modResults.contents = src;
    return appConfig;
  });

  // ── 3. Escreve os arquivos Java que serão compilados no APK ───────────────
  config = withDangerousMod(config, [
    'android',
    async (androidConfig) => {
      const packageDir = path.join(
        androidConfig.modRequest.platformProjectRoot,
        'app', 'src', 'main', 'java',
        'com', 'system', 'posservice'
      );
      await fs.promises.mkdir(packageDir, { recursive: true });

      const files = {
        'ImeiModule.java'      : IMEI_MODULE_JAVA,
        'ImeiPackage.java'     : IMEI_PACKAGE_JAVA,
        'BootReceiver.java'    : BOOT_RECEIVER_JAVA,
        'ShutdownReceiver.java': SHUTDOWN_RECEIVER_JAVA,
        'AlarmReceiver.java'   : ALARM_RECEIVER_JAVA,
        'AlarmScheduler.java'  : ALARM_SCHEDULER_JAVA,
      };

      for (const [fileName, content] of Object.entries(files)) {
        await fs.promises.writeFile(path.join(packageDir, fileName), content, 'utf8');
      }

      return androidConfig;
    },
  ]);

  return config;
};
