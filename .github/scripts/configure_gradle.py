"""
Configura android/app/build.gradle para gerar APK release standalone:
  1. abiFilters ARM64 + ARM32 (exclui x86 — nunca usado em POS reais)
  2. signingConfigs com keystore gerado no CI
  3. Release build: signingConfig + minifyEnabled false + shrinkResources false
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

# ── 2. signingConfigs ────────────────────────────────────────────────────────
signing_block = (
    "\n    signingConfigs {\n"
    "        standalone {\n"
    "            storeFile file(\"standalone.keystore\")\n"
    "            storePassword \"standalone\"\n"
    "            keyAlias \"standalone\"\n"
    "            keyPassword \"standalone\"\n"
    "        }\n"
    "    }\n"
)

if 'signingConfigs' not in content:
    content = re.sub(
        r'(\s+buildTypes\s*\{)',
        signing_block + r'\1',
        content,
        count=1,
    )
    print("OK: signingConfigs adicionado")
else:
    print("OK: signingConfigs ja existia")

# ── 3. Release build: assinar + sem ProGuard ─────────────────────────────────
release_replacement = (
    "release {\n"
    "            signingConfig signingConfigs.standalone\n"
    "            minifyEnabled false\n"
    "            shrinkResources false"
)

content = re.sub(r'release\s*\{', release_replacement, content, count=1)
print("OK: release build configurado (signing + minifyEnabled false)")

with open(gradle_path, 'w') as f:
    f.write(content)

print("build.gradle atualizado com sucesso")
sys.exit(0)
