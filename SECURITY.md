# Security Policy

ProxmoxVEx is a web-based multi-cluster management layer for Proxmox VE,
XCP-ng, and ESXi. Because it holds hypervisor credentials, VM/console access,
and administrative control over your virtualization infrastructure, we treat
its own security with the same priority as the clusters it manages.

## Reporting a Vulnerability

The ProxmoxVEx team takes security vulnerabilities seriously. We appreciate your efforts to responsibly disclose any issues you find.

**Please do NOT report security vulnerabilities through public GitHub issues, discussions, or pull requests.**

Instead, please report them via email to:

📧 **[armatec0@gmail.com](mailto:armatec0@gmail.com)**

### What to Include

To help us understand and resolve the issue as quickly as possible, please include:

- A description of the vulnerability and its potential impact
- Step-by-step instructions to reproduce the issue
- Affected version(s) of ProxmoxVEx (see `version.json` or the admin **Settings → About** panel)
- Any relevant screenshots, logs, or proof-of-concept code
- Your suggested fix or mitigation, if any

### Response Timeline

| Action                        | Timeframe               |
| ----------------------------- | ----------------------- |
| Acknowledgment of your report | Within 48 hours         |
| Initial assessment and triage | Within 5 business days  |
| Status update on the fix      | Within 10 business days |
| Security patch release        | Depending on severity   |

We will keep you informed throughout the process and credit you in the advisory (unless you prefer to remain anonymous).

## Supported Versions

| Version                          | Supported                            |
| -------------------------------- | ------------------------------------ |
| Latest release (currently 1.2.x) | ✅ Yes                               |
| Previous minor (1.1.x)           | ✅ Critical/high-severity fixes only |
| < 1.1.0                          | ❌ No                                |

ProxmoxVEx ships frequent point releases (see `version.json` → `changelog`),
many of which contain dependency-CVE fixes (tracked with rationale in

`requirements.txt`). We strongly recommend always running the latest
version, using the built-in updater (**Settings → Updates**) or `update.sh`.

## Scope

The following areas are **in scope** for security reports:

- Authentication and session management (password login, TOTP 2FA, WebAuthn/FIDO2 hardware keys, OIDC, LDAP)
- Role-based access control (RBAC), custom roles, and privilege escalation between roles (Admin, Operator, Viewer, and custom-defined roles)
- VM- and cluster-level ACL bypasses and multi-tenancy/client-portal isolation failures
- Proxmox/XCP-ng/ESXi credential handling and storage, including the master-key and database-encryption design in `ProxmoxVEx/core/keystore.py` and `ProxmoxVEx/core/dbcrypto.py`
- Encryption at rest for the application database and configuration files
- Cross-site scripting (XSS), cross-site request forgery (CSRF), SSRF, and injection vulnerabilities (SQL, command, XML/XXE)
- noVNC/SPICE console access control and the VNC/SSH WebSocket proxy layer
- SSL/TLS configuration, certificate handling, and ACME/Let's Encrypt integration
- Remote code execution or command injection via the web interface, SSH helper, or plugin system
- Information disclosure through API responses, error messages, audit logs, or the metrics/SIEM exporters

The following are **out of scope**:

- Vulnerabilities in Proxmox VE, XCP-ng, or ESXi themselves (please report those to the respective upstream project)
- Denial-of-service (DoS) attacks without a demonstrated security impact
- Social engineering or phishing attacks against ProxmoxVEx users or team members
- Issues in third-party dependencies without a demonstrated exploit path in ProxmoxVEx (see `NOTICE` for bundled/vendored components such as noVNC)
- Reports from automated scanners without manual verification
- Missing security headers that have no demonstrated exploitability
- Vulnerabilities requiring physical access to the server or an already-compromised host

## Security Architecture

ProxmoxVEx implements the following security measures:

- **Encryption at rest:** Field-level Fernet (AES) encryption of secrets (cluster credentials, 2FA seeds, OIDC/LDAP secrets, API tokens); database volume encryption is the operator's responsibility when using PostgreSQL — see `docs/SECURITY.md` for the key-management design
- **Password hashing:** User passwords are hashed using Argon2id (`argon2-cffi`)
- **Multi-factor authentication:** TOTP-based 2FA (`pyotp`) and WebAuthn/FIDO2 hardware security keys (YubiKey, Touch ID, Windows Hello) via `fido2`
- **Federated authentication:** Optional LDAP and OIDC/JWT-based SSO, verified server-side with a strict algorithm allow-list
- **Transport security:** HTTPS is enforced for production deployments, with optional automatic certificate issuance/renewal via ACME
- **Session management:** Sessions expire automatically after inactivity and are invalidated on password change
- **Brute-force protection:** Rate limiting and account lockout are applied to authentication endpoints
- **Role-based access control:** Built-in Admin/Operator/Viewer roles plus custom, permission-scoped roles
- **VM- and cluster-level ACLs:** Fine-grained per-VM and per-cluster permissions for multi-tenant / client-portal environments
- **Hardened parsing:** XML input (e.g. XCP-ng RRD data) is parsed with `defusedxml` to prevent XXE/entity-expansion attacks
- **Audit logging:** User and administrative actions are logged and retained for compliance review

## Disclosure Policy

- We follow a **coordinated disclosure** model. We ask that you give us a reasonable amount of time to address the vulnerability before making any information public.
- We will coordinate with you on the disclosure timeline and, if applicable, assign a CVE identifier.
- We will publicly acknowledge your contribution in the release notes and security advisory (with your permission).

## Safe Harbor

We consider security research conducted in accordance with this policy to be:

- **Authorized** under applicable anti-hacking laws, and we will not initiate or support legal action against you for accidental, good-faith violations of this policy
- **Exempt** from restrictions in our terms of service that would interfere with conducting security research, and we waive those restrictions on a limited basis for work done under this policy
- **Lawful**, helpful, and conducted in the overall interest of the security of the internet

You are expected, as always, to comply with all applicable laws. If at any point you have concerns or are uncertain whether your security research is consistent with this policy, please reach out to us at [armatec0@gmail.com](mailto:armatec0@gmail.com) before going any further.

## Best Practices for Users

To keep your ProxmoxVEx installation secure:

1. **Change default credentials immediately** after the first login and complete the initial-admin setup flow
2. **Enable 2FA (TOTP or a WebAuthn hardware key)** for all user accounts, especially administrators
3. **Use HTTPS** with a valid TLS certificate in production (ProxmoxVEx can provision one automatically via ACME)
4. **Restrict network access** to the ProxmoxVEx web interface (default port 5000, configurable in Settings) using firewall rules or a reverse proxy
5. **Keep ProxmoxVEx updated** to the latest version — check `version.json`'s changelog for security-relevant fixes before skipping a release
6. **Use strong, unique root/API credentials** for each Proxmox, XCP-ng, or ESXi connection, and prefer API tokens over root passwords where supported
7. **Review audit logs** regularly for suspicious activity, and forward them to your SIEM if you operate at scale
8. **Apply the principle of least privilege** when assigning built-in or custom roles, and scope VM-level ACLs for multi-tenant/client-portal deployments
9. **Back up your master encryption key separately** from `config/` backups — the key is non-recoverable if lost (see `docs/SECURITY.md`)

## Contact

For security-related inquiries: **[armatec0@gmail.com](mailto:armatec0@gmail.com)**

For the technical deep-dive on encryption, key management, and DB migration, see [`docs/SECURITY.md`](docs/SECURITY.md).

---

_This policy is inspired by industry best practices and may be updated from time to time._
