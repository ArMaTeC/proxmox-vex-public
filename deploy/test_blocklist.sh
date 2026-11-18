#!/usr/bin/env bash
# ID-0170: blocklist feed sanity — oversized feeds rejected (fail-open
# keeps last good), malformed/overly-broad entries dropped, CIDRs
# enforced, single IPs matched exactly.
set -u
cd "$(dirname "$0")"
python3 - <<'PY'
import ipaddress, sys
sys.path.insert(0, ".")
import server

_parse, _B = server._parse_blocklist, server._Blocklist
ok = True
def check(cond, label):
    global ok
    print(("PASS" if cond else "FAIL"), label)
    ok = ok and cond

addrs, nets = _parse(["1.2.3.4", "10.0.0.0/16", "bad-entry", "2001:db8::1"])
check(ipaddress.ip_address("1.2.3.4") in addrs, "plain ip kept")
check(len(nets) == 1 and nets[0].prefixlen == 16, "cidr kept")
check(len(addrs) == 2, "malformed dropped, ipv6 kept")

addrs, nets = _parse(["0.0.0.0/0", "::/0", "1.0.0.0/4", "9.9.9.9"])
check(len(nets) == 0, "route-the-world nets dropped")
check(len(addrs) == 1, "host entry survives alongside bad nets")

try:
    _parse(["1.1.1.1"] * 50_001)
    check(False, "oversized feed raises")
except ValueError:
    check(True, "oversized feed raises")

b = _B()
b._addrs, b._nets = _parse(["5.6.7.8", "10.9.0.0/16"])
check(b.contains("5.6.7.8"), "contains exact ip")
check(b.contains("10.9.3.4"), "contains cidr member")
check(not b.contains("10.10.3.4"), "rejects outside cidr")
check(not b.contains("not-an-ip"), "garbage ip -> False")

sys.exit(0 if ok else 1)
PY
