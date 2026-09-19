# Security hotfix path

The expedited path exists so a critical security fix ships in hours, not
the normal channel-soak weeks. It trades soak time for mandatory
post-hoc scrutiny — never for verification.

## Qualifying criteria

A change may take the hotfix path only when **all** hold:

- It fixes a vulnerability scored **CVSS ≥ 7.0**, an actively exploited
  issue, or a critical severity defect with field impact (data loss,
  auth bypass).
- The fix is minimal — no bundled features, refactors, or version churn.
- A named human files the hotfix with a CVE/advisory id **and** a written
  justification. Both are required inputs to the workflow.

Anything not meeting all three goes through the normal channel pipeline.

## The drill

1. **Branch** from the released tag being patched — never from main.
2. **Fix** minimally; reference the CVE id in the commit.
3. **Dispatch** `.github/workflows/hotfix.yml` with `cve` and
   `justification`. The `production` environment still requires a human
   approval — expedited ≠ unattended.
4. **Reduced gates** (and ONLY these are reduced):
   - upstream full-suite gate → smoke-only (`e2e-update-test.sh`)
   - channel soak → skipped; publishes **direct to stable**
   - The signature/checksum/provenance chain is **never** skipped.
5. **Publish** — standard signed artifacts; the release's `security`
   block in `version.json` carries severity + advisory URL so clients
   surface `SECURITY UPDATE`.
6. **Post-review (mandatory)** — the workflow files a tracking issue;
   full review within **7 days**. If the review finds the hotfix was
   out-of-policy, the next release reverts to normal gating and the
   incident goes to the retrospective.

## What is NOT bypassed

- detached signature + checksums + transparency log
- schema validation of `version.json`
- human approval (production environment)
- the mandatory post-review issue

## Aftermath

Within 7 days the post-review confirms or reverts; either way a normal
release follows the hotfix so stable never sits on an unreviewed base.
