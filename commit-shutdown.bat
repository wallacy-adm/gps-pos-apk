@echo off
cd /d "C:\eas\gps-pos-apk"
"C:\Program Files\Git\cmd\git.exe" add plugins/with-boot-receiver.js app.json
"C:\Program Files\Git\cmd\git.exe" commit -m "feat: ShutdownReceiver + AlarmReceiver 3h backup + versionCode 4"
"C:\Program Files\Git\cmd\git.exe" push
echo Done.
pause
