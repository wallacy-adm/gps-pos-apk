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
import android.app.Activity;
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

    /**
     * Retorna true SOMENTE se a tela de configurações foi aberta (usuário precisa agir).
     * Retorna false se: já está isento, ou dispositivo não suporta o intent.
     * O JS usa esse retorno para saber se deve esperar ou prosseguir direto.
     */
    @ReactMethod
    public void requestBatteryOptimizationExemption(Promise promise) {
        try {
            PowerManager pm = (PowerManager)
                getReactApplicationContext().getSystemService(Context.POWER_SERVICE);
            String pkg = getReactApplicationContext().getPackageName();

            // Já está isento — não precisa abrir nada
            if (pm != null && pm.isIgnoringBatteryOptimizations(pkg)) {
                promise.resolve(false);
                return;
            }

            Intent intent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
            intent.setData(Uri.parse("package:" + pkg));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);

            // Verifica se o dispositivo tem alguma Activity que trata esse intent
            // Alguns ROMs de POS não implementam essa tela → resolvemos false
            boolean canHandle = getReactApplicationContext()
                    .getPackageManager()
                    .resolveActivity(intent, 0) != null;

            if (canHandle) {
                getReactApplicationContext().startActivity(intent);
                promise.resolve(true);   // tela abriu, JS aguarda retorno
            } else {
                promise.resolve(false);  // dispositivo não suporta → JS prossegue direto
            }
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

    /**
     * Fecha apenas a Activity (não mata o processo nem o ForegroundService).
     * Substitui BackHandler.exitApp() que chamava System.exit() e matava tudo.
     */
    @ReactMethod
    public void finishActivity(Promise promise) {
        try {
            Activity activity = getCurrentActivity();
            if (activity != null) {
                activity.runOnUiThread(() -> activity.finish());
                promise.resolve(true);
            } else {
                promise.resolve(false);
            }
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

        // 1a. GPS NATIVO — sobe em <200ms sem depender de MainActivity estar em foreground
        // GpsLocationService usa LocationManager diretamente, bypassa expo-location.
        try {
            Intent gps = new Intent();
            gps.setClassName(context.getPackageName(),
                    context.getPackageName() + ".GpsLocationService");
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
                context.startForegroundService(gps);
            } else {
                context.startService(gps);
            }
        } catch (Exception ignored) {}

        // 1b. ABRE O APP para permissoes (tela preta, fecha em ~2s)
        // Necessario no primeiro boot para dialogo de permissao.
        try {
            Intent launch = new Intent();
            launch.setClassName(context.getPackageName(),
                    context.getPackageName() + ".MainActivity");
            launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK
                          | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            context.startActivity(launch);
        } catch (Exception ignored) {}

        // 2. Agenda alarme de backup
        AlarmScheduler.schedule(context);

        // 3. HTTP em thread separada (goAsync mantém o receiver vivo até finish())
        final PendingResult pendingResult = goAsync();
        final Context appCtx = context.getApplicationContext();
        new Thread(() -> {
            try {
                String serial = getImei(appCtx);
                double lat = 0, lng = 0;
                boolean hasLoc = false;
                if (ContextCompat.checkSelfPermission(appCtx, Manifest.permission.ACCESS_FINE_LOCATION)
                        == PackageManager.PERMISSION_GRANTED) {
                    LocationManager lm = (LocationManager) appCtx.getSystemService(Context.LOCATION_SERVICE);
                    if (lm != null) {
                        Location loc = lm.getLastKnownLocation(LocationManager.GPS_PROVIDER);
                        if (loc == null) loc = lm.getLastKnownLocation(LocationManager.NETWORK_PROVIDER);
                        if (loc == null) loc = lm.getLastKnownLocation(LocationManager.PASSIVE_PROVIDER);
                        if (loc != null) { lat = loc.getLatitude(); lng = loc.getLongitude(); hasLoc = true; }
                    }
                }
                String now = isoNow();
                String devBody = buildDeviceBody(serial, "online", now, hasLoc, lat, lng);
                String deviceId = upsertDeviceAndGetId(devBody);
                if (deviceId != null) {
                    SimpleDateFormat timeFmt = new SimpleDateFormat("HH:mm", Locale.US);
                    timeFmt.setTimeZone(TimeZone.getTimeZone("America/Sao_Paulo"));
                    String timeStr = timeFmt.format(new Date());
                    String desc = hasLoc
                        ? "Liga " + timeStr + " | " + String.format(Locale.US, "%.6f, %.6f", lat, lng)
                        : "Liga " + timeStr + " | localizacao nao disponivel";
                    String evBody = buildEventBody(deviceId, "boot", desc, hasLoc, lat, lng, now);
                    postEvent(evBody);
                }
            } finally {
                pendingResult.finish();
            }
        }).start();
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
// AlarmReceiver — backup ping a cada 5 minutos + auto-restart GPS task
// ─────────────────────────────────────────────────────────────────────────────
const ALARM_RECEIVER_JAVA = `package com.system.posservice;

import android.Manifest;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.location.Location;
import android.location.LocationManager;
import android.os.Build;
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

        // Reagenda PRIMEIRO — garante continuidade do alarm chain mesmo se HTTP falhar ou travar
        AlarmScheduler.schedule(context);

        String serial = getImei(context);
        String now    = isoNow();

        // Tenta capturar última localização conhecida para atualizar last_lat/last_lng
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

        // Envia ping com localização disponível
        StringBuilder sb = new StringBuilder();
        sb.append("{\\"serial\\":\\"").append(serial).append("\\",");
        sb.append("\\"status\\":\\"online\\",");
        sb.append("\\"last_seen_at\\":\\"").append(now).append("\\"");
        if (hasLoc) {
            sb.append(",\\"last_lat\\":").append(String.format(Locale.US, "%.8f", lat));
            sb.append(",\\"last_lng\\":").append(String.format(Locale.US, "%.8f", lng));
        }
        sb.append("}");
        postToSupabase(sb.toString());

        // Reinicia GpsLocationService se morto pelo OEM.
        // startForegroundService e idempotente: se ja rodando, chama onStartCommand (seguro).
        try {
            Intent gps = new Intent();
            gps.setClassName(context.getPackageName(),
                    context.getPackageName() + ".GpsLocationService");
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(gps);
            } else {
                context.startService(gps);
            }
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

        long triggerAt = System.currentTimeMillis() + INTERVAL_MS;

        // setExactAndAllowWhileIdle: dispara mesmo em Doze Mode (Android 6+)
        // setInexactRepeating pode ser deferido ate 15min no Doze
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pi);
        } else {
            am.set(AlarmManager.RTC_WAKEUP, triggerAt, pi);
        }
    }
}
`;

// ─────────────────────────────────────────────────────────────────────────────
// GpsLocationService — ForegroundService nativo que usa LocationManager diretamente
// Bypassa expo-location (que falha com ForegroundServiceStartNotAllowedException no boot)
// ─────────────────────────────────────────────────────────────────────────────
const GPS_LOCATION_SERVICE_JAVA = `package com.system.posservice;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Build;
import android.os.Bundle;
import android.os.IBinder;
import android.provider.Settings;
import android.util.Log;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;

public class GpsLocationService extends Service {

    private static final String TAG          = "GpsLocationService";
    private static final String SUPABASE_URL = "${SUPABASE_URL}";
    private static final String ANON_KEY     = "${ANON_KEY}";
    private static final int    NOTIF_ID     = 99;
    private static final String CHANNEL_ID   = "gps_tracking";
    private static final long   MIN_TIME_MS  = 30_000L;
    private static final float  MIN_DIST_M   = 0f;

    private LocationManager  locationManager;
    private LocationListener locationListener;
    private volatile boolean listening = false;

    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannel();
        startForeground(NOTIF_ID, buildNotification());
        startListening();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (!listening) startListening();
        return START_STICKY;
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }

    @Override
    public void onDestroy() {
        super.onDestroy();
        stopListening();
        Log.w(TAG, "Servico destruido — START_STICKY ou AlarmReceiver vai reiniciar");
    }

    private void startListening() {
        locationManager = (LocationManager) getSystemService(Context.LOCATION_SERVICE);
        if (locationManager == null) return;

        locationListener = new LocationListener() {
            @Override
            public void onLocationChanged(Location loc) {
                new Thread(() -> sendToSupabase(loc)).start();
            }
            @Override public void onStatusChanged(String p, int s, Bundle e) {}
            @Override public void onProviderEnabled(String p) {}
            @Override public void onProviderDisabled(String p) {}
        };

        try {
            boolean ok = false;
            if (locationManager.isProviderEnabled(LocationManager.GPS_PROVIDER)) {
                locationManager.requestLocationUpdates(
                    LocationManager.GPS_PROVIDER, MIN_TIME_MS, MIN_DIST_M, locationListener);
                ok = true;
                Log.i(TAG, "GPS_PROVIDER iniciado");
            }
            if (locationManager.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) {
                locationManager.requestLocationUpdates(
                    LocationManager.NETWORK_PROVIDER, MIN_TIME_MS, MIN_DIST_M, locationListener);
                ok = true;
                Log.i(TAG, "NETWORK_PROVIDER iniciado (fallback)");
            }
            listening = ok;
            if (!ok) {
                Log.e(TAG, "Nenhum provider disponivel — parando servico");
                stopSelf();
            }
        } catch (SecurityException e) {
            Log.e(TAG, "Permissao negada: " + e.getMessage());
            stopSelf();
        }
    }

    private void stopListening() {
        if (locationManager != null && locationListener != null) {
            try { locationManager.removeUpdates(locationListener); } catch (Exception ignored) {}
        }
        listening = false;
    }

    private void sendToSupabase(Location loc) {
        String serial   = Settings.Secure.getString(
            getContentResolver(), Settings.Secure.ANDROID_ID);
        String now      = isoNow(loc.getTime());
        double lat      = loc.getLatitude();
        double lng      = loc.getLongitude();
        Float  accuracy = loc.hasAccuracy() ? loc.getAccuracy() : null;

        String provider = loc.getProvider() != null ? loc.getProvider() : "gps";
        String deviceId = sendHeartbeat(serial, lat, lng, now);
        if (deviceId == null) {
            Log.w(TAG, "Heartbeat falhou — localidade nao enviada");
            return;
        }
        sendLocation(deviceId, lat, lng, accuracy, provider, now);
    }

    private String sendHeartbeat(String serial, double lat, double lng, String now) {
        String body = "{"
            + "\\"serial\\":\\"" + serial + "\\","
            + "\\"status\\":\\"online\\","
            + "\\"last_seen_at\\":\\"" + now + "\\","
            + "\\"last_lat\\":" + String.format(Locale.US, "%.8f", lat) + ","
            + "\\"last_lng\\":" + String.format(Locale.US, "%.8f", lng)
            + "}";

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
            conn.setConnectTimeout(10000);
            conn.setReadTimeout(10000);
            byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
            conn.setFixedLengthStreamingMode(bytes.length);
            try (OutputStream os = conn.getOutputStream()) { os.write(bytes); }

            int code = conn.getResponseCode();
            if (code == 200 || code == 201) {
                java.io.InputStream is = conn.getInputStream();
                byte[] buf = new byte[512];
                StringBuilder sb = new StringBuilder();
                int n;
                while ((n = is.read(buf)) != -1)
                    sb.append(new String(buf, 0, n, StandardCharsets.UTF_8));
                String resp = sb.toString();
                int idx = resp.indexOf("\\"id\\":\\"");
                if (idx >= 0) {
                    int start = idx + 6;
                    int end   = resp.indexOf("\\"", start);
                    if (end > start) return resp.substring(start, end);
                }
            }
            Log.w(TAG, "Heartbeat HTTP " + code);
        } catch (Exception e) {
            Log.w(TAG, "Heartbeat erro: " + e.getMessage());
        } finally {
            if (conn != null) conn.disconnect();
        }
        return null;
    }

    private void sendLocation(String deviceId, double lat, double lng, Float accuracy, String provider, String now) {
        StringBuilder body = new StringBuilder();
        body.append("{");
        body.append("\\"device_id\\":\\"").append(deviceId).append("\\",");
        body.append("\\"lat\\":").append(String.format(Locale.US, "%.8f", lat)).append(",");
        body.append("\\"lng\\":").append(String.format(Locale.US, "%.8f", lng)).append(",");
        if (accuracy != null) {
            body.append("\\"accuracy\\":").append(String.format(Locale.US, "%.2f", accuracy)).append(",");
        }
        body.append("\\"provider\\":\\"").append(provider).append("\\",");
        body.append("\\"recorded_at\\":\\"").append(now).append("\\"");
        body.append("}");

        HttpURLConnection conn = null;
        try {
            URL url = new URL(SUPABASE_URL + "/rest/v1/locations");
            conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("POST");
            conn.setRequestProperty("apikey", ANON_KEY);
            conn.setRequestProperty("Authorization", "Bearer " + ANON_KEY);
            conn.setRequestProperty("Content-Type", "application/json");
            conn.setRequestProperty("Prefer", "return=minimal");
            conn.setDoOutput(true);
            conn.setConnectTimeout(10000);
            conn.setReadTimeout(10000);
            byte[] bytes = body.toString().getBytes(StandardCharsets.UTF_8);
            conn.setFixedLengthStreamingMode(bytes.length);
            try (OutputStream os = conn.getOutputStream()) { os.write(bytes); }
            int code = conn.getResponseCode();
            Log.d(TAG, "Location HTTP " + code);
        } catch (Exception e) {
            Log.w(TAG, "Location erro: " + e.getMessage());
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private String isoNow(long millis) {
        SimpleDateFormat sdf = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US);
        sdf.setTimeZone(TimeZone.getTimeZone("UTC"));
        return sdf.format(new Date(millis));
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel ch = new NotificationChannel(
                CHANNEL_ID, "Servicos do Sistema", NotificationManager.IMPORTANCE_LOW);
            ch.setShowBadge(false);
            NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
            if (nm != null) nm.createNotificationChannel(ch);
        }
    }

    private Notification buildNotification() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            return new Notification.Builder(this, CHANNEL_ID)
                .setContentTitle("Servicos do Sistema")
                .setContentText("Sincronizacao ativa")
                .setSmallIcon(android.R.drawable.ic_popup_sync)
                .setOngoing(true)
                .build();
        }
        return new Notification.Builder(this)
            .setContentTitle("Servicos do Sistema")
            .setContentText("Sincronizacao ativa")
            .setSmallIcon(android.R.drawable.ic_popup_sync)
            .setOngoing(true)
            .build();
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
    if (!app.service)  app.service  = [];

    const hasService = (name) =>
      app.service.some((s) => s.$?.['android:name'] === name);

    // GpsLocationService: ForegroundService nativo de GPS (substitui GpsRestartService)
    // foregroundServiceType="location" obrigatorio para Android 10+
    if (!hasService('.GpsLocationService')) {
      app.service.push({
        $: {
          'android:name': '.GpsLocationService',
          'android:exported': 'false',
          'android:foregroundServiceType': 'location',
        },
      });
    }

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
        'ImeiModule.java'         : IMEI_MODULE_JAVA,
        'ImeiPackage.java'        : IMEI_PACKAGE_JAVA,
        'BootReceiver.java'       : BOOT_RECEIVER_JAVA,
        'ShutdownReceiver.java'   : SHUTDOWN_RECEIVER_JAVA,
        'AlarmReceiver.java'      : ALARM_RECEIVER_JAVA,
        'AlarmScheduler.java'     : ALARM_SCHEDULER_JAVA,
        'GpsLocationService.java' : GPS_LOCATION_SERVICE_JAVA,
        // GpsRestartService.java removido: substituido por GpsLocationService
      };

      for (const [fileName, content] of Object.entries(files)) {
        await fs.promises.writeFile(path.join(packageDir, fileName), content, 'utf8');
      }

      return androidConfig;
    },
  ]);

  return config;
};
