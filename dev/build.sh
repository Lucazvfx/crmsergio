#!/usr/bin/env bash
# Gera ../index.html (CSS do Tailwind compilado e embutido) a partir de dev/index.src.html.
# Uso: cd dev && ./build.sh   (precisa de Node.js e Python 3)
set -euo pipefail
cd "$(dirname "$0")"
[ -d node_modules/tailwindcss ] || npm install --silent
python3 - <<'PY'
import re
s = open('index.src.html', encoding='utf-8').read()
blk = re.search(r'<style type="text/tailwindcss">(.*?)</style>', s, re.S).group(1)
open('tw.in.css', 'w', encoding='utf-8').write('@tailwind base;\n@tailwind components;\n@tailwind utilities;\n' + blk)
PY
npx tailwindcss -c tailwind.config.js -i tw.in.css -o tw.out.css --minify
python3 - <<'PY'
import re
s = open('index.src.html', encoding='utf-8').read()
css = open('tw.out.css', encoding='utf-8').read()
s = re.sub(r'<!--TW-->\n<style type="text/tailwindcss">.*?</style>',
           lambda m: '<!-- Tailwind CSS v3 compilado e embutido (funciona 100% offline) -->\n<style>' + css + '</style>',
           s, count=1, flags=re.S)
open('../index.html', 'w', encoding='utf-8').write(s)
print('index.html gerado (%d bytes)' % len(s))
import hashlib
v = hashlib.sha256(s.encode('utf-8')).hexdigest()[:10]
sw = open('sw.src.js', encoding='utf-8').read().replace('__VERSAO__', v)
open('../sw.js', 'w', encoding='utf-8').write(sw)
print('sw.js gerado (versão %s)' % v)
PY
rm -f tw.in.css tw.out.css
