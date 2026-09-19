#!/usr/bin/env bash
# metrics.sh — rollup the vexdl JSON access log into a Prometheus textfile
# (spec 093/US039). Point node_exporter's textfile collector at the output:
#   */1 * * * * /opt/vex/deploy/metrics.sh > /var/lib/node_exporter/vex.prom
set -u
LOG="${1:-/var/log/nginx/vexdl.json}"

python3 - "$LOG" <<'PY'
import json, re, sys

log = sys.argv[1]
counts = {}      # version -> successful downloads
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

print("# HELP vex_downloads_total Successful artifact downloads by version.")
print("# TYPE vex_downloads_total counter")
for v, n in sorted(counts.items()):
    print(f'vex_downloads_total{{version="{v}"}} {n}')
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
