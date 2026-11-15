#!/usr/bin/env bash
# Security scan for CensusGuessr:  npm run scan
# Checks dependencies, secrets, risky code patterns, the built page and the
# deploy workflow. Prints one line per check; the exit code is the number of
# failures, so 0 means clean. Run `npm run build` first (npm run scan does).
cd "$(dirname "$0")/.." || exit 1
shopt -s nullglob
fails=0
check() { # name, output-that-should-be-empty
  if [ -n "$2" ]; then echo "FAIL  $1"; echo "$2" | sed 's/^/        /' | cut -c1-170; fails=$((fails+1)); else echo "ok    $1"; fi
}
check "npm audit (all dependencies)"        "$(npm audit 2>&1 | grep -v 'found 0 vulnerabilities')"
check "npm audit (production only)"         "$(npm audit --omit=dev 2>&1 | grep -v 'found 0 vulnerabilities')"
check "npm registry signatures"             "$(npm audit signatures 2>&1 | grep -iE 'invalid|missing|error')"
check "lockfile in sync with package.json"  "$(npm ci --dry-run --ignore-scripts 2>&1 | grep -iE 'npm error|out of sync' | head -3)"
check "lockfile resolves only from npmjs"   "$(grep -oE '"resolved": "[^"]+"' package-lock.json | grep -v 'https://registry.npmjs.org/' | head -3)"
check "no secrets or keys in tracked files" "$(git grep -nIE '(api[_-]?key|client[_-]?secret|passw(or)?d|BEGIN [A-Z ]*PRIVATE KEY|AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9]{20,}|xox[baprs]-)' -- . ':!package-lock.json' ':!README.md')"
check "no .env or key files tracked"        "$(git ls-files | grep -E '(^|/)\.env|\.pem$|\.key$|id_rsa')"
check "no home paths or emails in files"    "$(git grep -nIE '/Users/[A-Za-z]|/home/[a-z]|[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.(com|org|net|io|dev|ca)\b' -- . ':!package-lock.json' | grep -vE 'git@github\.com')"
check "no build output or caches tracked"   "$(git ls-files | grep -E '^(node_modules|dist|\.cache|\.claude)/')"
check "no HTML-string DOM sinks"            "$(grep -rnE 'dangerouslySetInnerHTML|innerHTML|outerHTML|insertAdjacentHTML|document\.write' src index.html)"
check "no dynamic code execution"           "$(grep -rnE '\beval\(|new Function|setTimeout\(\s*[\x27"]|setInterval\(\s*[\x27"]' src)"
check "map labels never take raw strings"   "$(grep -rnE 'bindTooltip\(|bindPopup\(|setContent\(' src | grep -v 'bindTooltip(pinLabel(')"
check "no network calls from the app"       "$(grep -rnE '\bfetch\(|XMLHttpRequest|WebSocket|sendBeacon|EventSource|importScripts' src)"
check "no insecure http:// URLs"            "$(grep -rnE 'http://' src index.html vite.config.ts scripts/*.py .github | grep -vE 'http://localhost|http://www\.w3\.org')"
check "external hosts limited to allowlist" "$(grep -rhoE 'https://[a-zA-Z0-9.-]+' src index.html --exclude-dir=data | sort -u | grep -vE '^https://(tile\.openstreetmap\.org|www\.openstreetmap\.org|operations\.osmfoundation\.org|example\.com)$')"
check "new-tab links use noopener"          "$(grep -rnE 'target="_blank"' src | grep -v 'noopener')"
check "no cookies or sessionStorage"        "$(grep -rnE 'document\.cookie|sessionStorage' src)"
check "localStorage only via storage.ts"    "$(grep -rnE 'localStorage' src | grep -v '^src/lib/storage.ts')"
check "JSON.parse only in validated loader" "$(grep -rnE 'JSON\.parse' src | grep -v '^src/lib/storage.ts')"
check "saved data is range-checked"         "$(grep -q 'isInt(' src/lib/storage.ts && grep -q 'CITY_BY_ID.has' src/lib/storage.ts || echo 'validation missing')"
check "challenge codes are validated"       "$(grep -q 'CODE.test' src/lib/challenge.ts && grep -q 'CITY_BY_ID.has' src/lib/challenge.ts || echo 'validation missing')"
check "address bar only changed in one place" "$(grep -rnE 'history\.(pushState|replaceState)|location\.(assign|replace)|location\s*=' src | grep -v 'window.history.replaceState(null, .., window.location.pathname)')"
check "URL params limited to known flags"   "$(grep -rnE 'URLSearchParams|location\.(hash|search|href)' src | grep -vE "get\('(reducedMotion|now|c)'\)")"
check "clock override is dev-only"          "$(grep -q 'import.meta.env.DEV' src/lib/time.ts || echo 'not gated')"
check "production page has a CSP"           "$(grep -q 'Content-Security-Policy' dist/index.html 2>/dev/null || echo 'missing in dist/index.html (run npm run build)')"
check "CSP has no unsafe script sources"    "$(grep -oE 'script-src[^;]*' dist/index.html 2>/dev/null | grep -E 'unsafe|\*|data:')"
check "built page has no inline scripts"    "$(grep -oE '<script[^>]*>' dist/index.html 2>/dev/null | grep -v 'src=')"
check "built JS has no dev clock override"  "$(grep -lE 'URLSearchParams\(window\.location\.search\)\.get\(.now.\)' dist/assets/*.js 2>/dev/null)"
check "workflow actions pinned to SHAs"     "$(grep -nE 'uses:' .github/workflows/*.yml | grep -vE '@[0-9a-f]{40}( |$)')"
check "workflow default permissions empty"  "$(grep -qE '^permissions: \{\}' .github/workflows/deploy.yml || echo 'top-level permissions not empty')"
check "workflow has no risky triggers"      "$(grep -nE 'pull_request_target|workflow_run' .github/workflows/*.yml)"
check "workflow has no script injection"    "$(grep -nE 'run:.*\$\{\{' .github/workflows/*.yml)"
check "checkout does not keep credentials"  "$(grep -q 'persist-credentials: false' .github/workflows/deploy.yml || echo 'persist-credentials not disabled')"
check "dependabot configured"               "$([ -f .github/dependabot.yml ] || echo 'missing')"
check "python: no shell/eval/insecure TLS"  "$(grep -nE 'shell=True|os\.system|\beval\(|\bexec\(|verify=False|_create_unverified|extractall|pickle' scripts/*.py)"
check "python: downloads are https only"    "$(grep -nE '"http://|\x27http://' scripts/*.py)"
check "license file present"                "$([ -f LICENSE ] || echo 'missing')"
check "type check"                          "$(npx tsc --noEmit 2>&1 | head -5)"
check "unit tests"                          "$(npm test 2>&1 | grep -E 'failed|FAIL|Error' | head -5)"
echo "-----"; echo "failures: $fails"; exit $fails
