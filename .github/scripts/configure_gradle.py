"""
Configura android/app/build.gradle para gerar APK release standalone:
  1. abiFilters ARM64 + ARM32
  2. signingConfig standalone dentro do bloco signingConfigs existente
  3. release build: signingConfig + minifyEnabled false + shrinkResources false
"""
import re
import sys

gradle_path = 'android/app/build.gradle'

with open(gradle_path, 'r') as f:
    content = f.read()

# ── 1. ABI filters ──────────────────────────────────────────────────────────
if 'abiFilters' not in content:
    content = re.sub(
        r'(defaultConfig\s*\{)',
        r'\1\n        ndk {\n            abiFilters "arm64-v8a", "armeabi-v7a"\n        }',
        content,
        count=1,
    )
    print("OK: abiFilters ARM64+ARM32 adicionado")
else:
    print("OK: abiFilters ja existia")

# ── 2. Adiciona 'standalone' dentro do signingConfigs existente ──────────────
# Expo prebuild ja cria signingConfigs { debug { ... } }
# Precisamos inserir standalone { ... } dentro desse bloco
standalone_entry = (
    "\n        standalone {\n"
    "            storeFile file(\"standalone.keystore\")\n"
    "            storePassword \"standalone\"\n"
    "            keyAlias \"standalone\"\n"
    "            keyPassword \"standalone\"\n"
    "        }"
)

if 'standalone' not in content:
    # Insere apos 'signingConfigs {'
    content = re.sub(
        r'(signingConfigs\s*\{)',
        r'\1' + standalone_entry,
        content,
        count=1,
    )
    print("OK: signingConfigs.standalone adicionado")
else:
    print("OK: standalone ja existia em signingConfigs")

# ── 3. Configura release build ───────────────────────────────────────────────
# Substitui 'release {' pelo bloco com signing + sem ProGuard
release_replacement = (
    "release {\n"
    "            signingConfig signingConfigs.standalone\n"
    "            minifyEnabled false\n"
    "            shrinkResources false"
)

if 'signingConfigs.standalone' not in content.split('release')[1] if 'release' in content else True:
    content = re.sub(r'release\s*\{', release_replacement, content, count=1)
    print("OK: release build configurado (signing + minifyEnabled false)")
else:
    print("OK: release build ja configurado")

with open(gradle_path, 'w') as f:
    f.write(content)

print("build.gradle atualizado com sucesso")
sys.exit(0)
