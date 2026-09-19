#!/usr/bin/env bash
# metrics.sh — rollup the vexdl JSON access log into a Prometheus textfile
# (spec 093/US039). Point node_exporter's textfile collector at the output:
#   */1 * * * * /opt/vex/deploy/metrics.sh > /var/lib/node_exporter/vex.prom
#
# --dashboard <out.json> (spec 093/US075): consolidated release-health feed
# for the internal vhost — download counts from the access log merged with
# the telemetry-outcome and failure-stage rollups the telemetry endpoint
# writes:
#   metrics.sh --dashboard /srv/internal/release-health.json \
#       --log /var/log/nginx/vexdl.json \
#       --telemetry telemetry-rollup.json --failures failures-rollup.json
set -u

if [ "${1:-}" = "--dashboard" ]; then
    OUT="$2"; shift 2
    LOG="/var/log/nginx/vexdl.json" TEL="" FAIL=""
    while [ $# -gt 0 ]; do
        case "$1" in
            --log)       LOG="$2";  shift 2 ;;
            --telemetry) TEL="$2";  shift 2 ;;
            --failures)  FAIL="$2"; shift 2 ;;
            *) echo "metrics: unknown arg $1" >&2; exit 2 ;;
        esac
    done
    python3 - "$OUT" "$LOG" "$TEL" "$FAIL" <<'PY'
import json, re, sys, time

out, log, tel_f, fail_f = sys.argv[1:5]
counts, installs = {}, {}
total = errors = 0

try:
    fh = open(log)
except OSError:
    fh = []
for line in fh:
    line = line.strip()
    if not line:
        continue
    try:
        e = json.loads(line)
    except json.JSONDecodeError:
        continue
    total += 1
    try:
        st = int(e.get("status", 0))
    except (TypeError, ValueError):
        st = 0
    if st >= 400:
        errors += 1
        continue
    m = re.search(r"ProxmoxVEx-(\d+\.\d+\.\d+)", e.get("uri", ""))
    if m:
        counts[m.group(1)] = counts.get(m.group(1), 0) + 1
    f = re.search(r"version\.json\?from=(\d[\d.]*)", e.get("uri", ""))
    if f:
        installs[f.group(1)] = installs.get(f.group(1), 0) + 1

def load(p):
    try:
        return json.load(open(p))
    except Exception:
        return {}

feed = {
    "downloads": counts,
    "installs": installs,
    "outcomes": load(tel_f) if tel_f else {},
    "failures": load(fail_f) if fail_f else {},
    "requests": total,
    "errors": errors,
    "ts": int(time.time()),
}
with open(out, "w") as fh:
    json.dump(feed, fh, indent=2, sort_keys=True)
PY
    exit $?
fi

LOG="${1:-/var/log/nginx/vexdl.json}"

python3 - "$LOG" <<'PY'
import json, re, sys

log = sys.argv[1]
counts = {}      # version -> successful downloads
installs = {}    # version -> update-check count (spec 093/US072)
errors = 0       # requests with status >= 400
total = 0
bytes_sent = 0

try:
    fh = open(log)
except OSError:
    fh = []

for line in fh:
    line = line.strip()
    if not line:
        continue
    try:
        e = json.loads(line)
    except json.JSONDecodeError:
        continue
    total += 1
    st = e.get("status", 0)
    try:
        st = int(st)
    except (TypeError, ValueError):
        st = 0
    try:
        bytes_sent += int(e.get("bytes", 0) or 0)
    except (TypeError, ValueError):
        pass
    if st >= 400:
        errors += 1
        continue
    m = re.search(r"ProxmoxVEx-(\d+\.\d+\.\d+)", e.get("uri", ""))
    if m:
        counts[m.group(1)] = counts.get(m.group(1), 0) + 1
    # US072: update checks carry ?from=<installed-version> — aggregate them
    # into the installed-base distribution for support planning.
    f = re.search(r"version\.json\?from=(\d[\d.]*)", e.get("uri", ""))
    if f:
        installs[f.group(1)] = installs.get(f.group(1), 0) + 1

print("# HELP vex_downloads_total Successful artifact downloads by version.")
print("# TYPE vex_downloads_total counter")
for v, n in sorted(counts.items()):
    print(f'vex_downloads_total{{version="{v}"}} {n}')
print("# HELP vex_installs Installed-base version distribution (update checks).")
print("# TYPE vex_installs gauge")
for v, n in sorted(installs.items()):
    print(f'vex_installs{{version="{v}"}} {n}')
print("# HELP vex_requests_total Total logged requests.")
print("# TYPE vex_requests_total counter")
print(f"vex_requests_total {total}")
print("# HELP vex_errors_total Requests answered with status >= 400.")
print("# TYPE vex_errors_total counter")
print(f"vex_errors_total {errors}")
print("# HELP vex_bytes_sent_total Bytes served to clients.")
print("# TYPE vex_bytes_sent_total counter")
print(f"vex_bytes_sent_total {bytes_sent}")
PY
