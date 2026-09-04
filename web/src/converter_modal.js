/* --- ProxmoxVEx auto-header start ---
 * -------------------------------------------------------------------
 * File:        web/src/converter_modal.js
 * Project:     ProxmoxVEx
 * Version:     1.2.303
 * Build:       2026.09.04
 * Description: Converter Modal JS source
 * Docs:        https://proxmoxvex.local/docs
 * Generated:   2026-09-04
 * -------------------------------------------------------------------
 * --- ProxmoxVEx auto-header end --- */

(function () {
    'use strict';

    function _escapeHtml(text) {
        if (text === null || text === undefined) return '';
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    const _COMMON_FIELDS = {
        target_id: {
            id: 'target_id', label: 'Target ID', type: 'number', required: true, half: true,
            info: 'The new Proxmox ID for the resulting workload (100-999999999).',
        },
        target_storage: {
            id: 'target_storage', label: 'Target Storage', type: 'text', default: 'local-lvm', required: true, half: true,
            info: 'Storage pool where the new disk or rootfs volume will be created (e.g. local-lvm).',
        },
        target_disk_size_gb: {
            id: 'target_disk_size_gb', label: 'Disk Size (GB)', type: 'number', default: '8',
            min: CONVERTER_MIN_DISK_GB, required: false, half: true,
            info: 'Desired disk size in GiB. Leave blank to let the converter auto-calculate from the source.',
        },
        target_disk_format: {
            id: 'target_disk_format', label: 'Disk Format', type: 'select', required: true, half: true,
            default: 'qcow2',
            options: [{ value: 'qcow2', label: 'QCOW2' }, { value: 'raw', label: 'Raw' }],
            info: 'Disk image format for the new VM disk. Ignored for LXC containers.',
        },
        target_bridge: {
            id: 'target_bridge', label: 'Bridge', type: 'text', default: 'vmbr0', required: true, half: true,
            info: 'Network bridge attached to the new workload (e.g. vmbr0).',
        },
        target_bios: {
            id: 'target_bios', label: 'BIOS', type: 'select', required: true, half: true,
            default: 'seabios',
            options: [{ value: 'seabios', label: 'SeaBIOS' }, { value: 'ovmf', label: 'OVMF (UEFI)' }],
            info: 'Firmware/BIOS type for the new VM. Only used when creating a VM.',
        },
        dry_run: {
            id: 'dry_run', label: 'Dry-run only', type: 'checkbox', default: true,
            info: 'Simulate the operation without making any changes to the cluster.',
        },
        replace_target: {
            id: 'replace_target', label: 'Replace target if it exists', type: 'checkbox', default: false,
            info: 'Remove the target workload if it already exists before creating the new one.',
        },
        destroy_source: {
            id: 'destroy_source', label: 'Destroy source after success', type: 'checkbox', default: false,
            info: 'Remove the original workload after the conversion completes successfully.',
        },
        auto_start: {
            id: 'auto_start', label: 'Start target after conversion', type: 'checkbox', default: false,
            info: 'Power on the new workload once the conversion has finished.',
        },
    };

    const CONVERTER_OPERATION_SCHEMAS = [
        {
            value: 'lxc_to_vm', label: 'LXC to VM', sourceTypes: ['lxc'],
            fields: [
                _COMMON_FIELDS.target_id, _COMMON_FIELDS.target_storage,
                _COMMON_FIELDS.target_disk_size_gb, _COMMON_FIELDS.target_disk_format,
                _COMMON_FIELDS.target_bridge, _COMMON_FIELDS.target_bios,
                _COMMON_FIELDS.dry_run, _COMMON_FIELDS.replace_target,
                _COMMON_FIELDS.destroy_source, _COMMON_FIELDS.auto_start,
            ],
        },
        {
            value: 'vm_to_lxc', label: 'VM to LXC', sourceTypes: ['vm'],
            fields: [
                _COMMON_FIELDS.target_id, _COMMON_FIELDS.target_storage,
                _COMMON_FIELDS.target_disk_size_gb, _COMMON_FIELDS.target_bridge,
                _COMMON_FIELDS.dry_run, _COMMON_FIELDS.replace_target,
                _COMMON_FIELDS.destroy_source, _COMMON_FIELDS.auto_start,
            ],
        },
        {
            value: 'shrink_lxc', label: 'Shrink LXC disk', sourceTypes: ['lxc'],
            fields: [
                { id: 'target_disk_size_gb', label: 'Disk Size (GB)', type: 'number', min: CONVERTER_MIN_DISK_GB, required: true, info: 'Target size in GiB to shrink the LXC rootfs to.' },
                _COMMON_FIELDS.dry_run,
            ],
        },
        {
            value: 'expand_lxc', label: 'Expand LXC disk', sourceTypes: ['lxc'],
            fields: [
                { id: 'target_disk_size_gb', label: 'Disk Size (GB)', type: 'number', min: CONVERTER_MIN_DISK_GB, required: true, info: 'Target size in GiB to expand the LXC rootfs to.' },
                _COMMON_FIELDS.dry_run,
            ],
        },
        {
            value: 'shrink_vm', label: 'Shrink VM disk', sourceTypes: ['vm'],
            fields: [
                { id: 'target_disk_size_gb', label: 'Disk Size (GB)', type: 'number', min: CONVERTER_MIN_DISK_GB, required: true, info: 'Target size in GiB to shrink the VM disk to.' },
                _COMMON_FIELDS.dry_run,
            ],
        },
        {
            value: 'expand_vm', label: 'Expand VM disk', sourceTypes: ['vm'],
            fields: [
                { id: 'target_disk_size_gb', label: 'Disk Size (GB)', type: 'number', min: CONVERTER_MIN_DISK_GB, required: true, info: 'Target size in GiB to expand the VM disk to.' },
                _COMMON_FIELDS.dry_run,
            ],
        },
        {
            value: 'clone_replace_disk', label: 'Clone & replace disk', sourceTypes: ['lxc', 'vm'],
            fields: [
                _COMMON_FIELDS.target_storage,
                { id: 'target_disk_size_gb', label: 'New Disk Size (GB)', type: 'number', min: CONVERTER_MIN_DISK_GB, required: true, half: true, info: 'Size of the new cloned disk in GiB.' },
                _COMMON_FIELDS.target_disk_format,
                _COMMON_FIELDS.dry_run, _COMMON_FIELDS.destroy_source, _COMMON_FIELDS.auto_start,
            ],
        },
    ];

    function _buildConverterFieldGroup(field, isCorporate) {
        const labelClass = isCorporate ? 'corp-label' : '';
        const inputClass = isCorporate ? 'corp-input' : 'form-control';
        const optional = !field.required && field.type !== 'checkbox' ? '<span class="optional-mark">(optional)</span>' : '';
        const info = field.info ? `<span class="info-icon" tabindex="0">i<span class="info-tooltip">${_escapeHtml(field.info)}</span></span>` : '';
        const requiredAttr = field.required ? 'required' : '';
        const minAttr = field.min !== undefined ? `min="${field.min}"` : '';
        const valueAttr = field.default !== undefined ? `value="${_escapeHtml(field.default)}"` : '';

        if (field.type === 'checkbox') {
            const checked = field.default ? 'checked' : '';
            return `<div class="form-group form-check-group">
                <label class="${labelClass}">
                    <input type="checkbox" id="converter-${field.id}" ${checked} ${requiredAttr}>
                    ${_escapeHtml(field.label)} ${info}
                </label>
            </div>`;
        }

        let inputHtml = '';
        if (field.type === 'select') {
            inputHtml = `<select id="converter-${field.id}" class="${inputClass}" ${requiredAttr}>` +
                field.options.map(o => `<option value="${o.value}"${o.value === field.default ? ' selected' : ''}>${_escapeHtml(o.label)}</option>`).join('') +
                '</select>';
        } else if (field.type === 'number') {
            inputHtml = `<input type="number" id="converter-${field.id}" class="${inputClass}" ${minAttr} ${valueAttr} ${requiredAttr}>`;
        } else {
            inputHtml = `<input type="text" id="converter-${field.id}" class="${inputClass}" ${valueAttr} ${requiredAttr}>`;
        }

        return `<div class="form-group">
            <label class="${labelClass}">${_escapeHtml(field.label)} ${optional} ${info}</label>
            ${inputHtml}
        </div>`;
    }

    function _buildConverterOperationFields(schema, isCorporate) {
        let html = '';
        let half = [];
        schema.fields.forEach(field => {
            if (field.half) {
                half.push(field);
                if (half.length === 2) {
                    html += `<div class="form-row">${half.map(f => _buildConverterFieldGroup(f, isCorporate)).join('')}</div>`;
                    half = [];
                }
            } else {
                if (half.length) {
                    html += `<div class="form-row">${half.map(f => _buildConverterFieldGroup(f, isCorporate)).join('')}</div>`;
                    half = [];
                }
                html += _buildConverterFieldGroup(field, isCorporate);
            }
        });
        if (half.length) {
            html += `<div class="form-row">${half.map(f => _buildConverterFieldGroup(f, isCorporate)).join('')}</div>`;
        }
        return html;
    }

    function _renderConverterOperationFields(modal, operation, isCorporate) {
        const schema = CONVERTER_OPERATION_SCHEMAS.find(s => s.value === operation);
        if (!schema) return;
        const container = modal.querySelector('#converter-dynamic-fields');
        if (container) {
            setHTMLSafe(container, _buildConverterOperationFields(schema, isCorporate));
        }
    }

    function showConverterModal(sourceType, sourceId, sourceNode, clusterId) {
        const isCorporate = document.body.getAttribute('data-layout') === 'corporate';
        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.id = 'converter-modal';
        modal.innerHTML = `
            <div class="${isCorporate ? 'modal-content corp-settings-card' : 'modal-content'}" style="max-width: 640px;">
                <div class="modal-header">
                    <h3 class="${isCorporate ? 'corp-card-header' : ''}">Convert Workload</h3>
                    <button class="close-modal">&times;</button>
                </div>
                <div class="modal-body">
                    <form id="converter-form" class="converter-form">
                        <div class="form-group">
                            <label class="${isCorporate ? 'corp-label' : ''}">Operation</label>
                            <select id="converter-operation" class="${isCorporate ? 'corp-input' : 'form-control'}">
                                ${CONVERTER_OPERATION_SCHEMAS.filter(op => sourceType === 'lxc' || op.value !== 'lxc_to_vm').map(op =>
            `<option value="${op.value}">${op.label}</option>`
        ).join('')}
                            </select>
                        </div>
                        <div class="form-group">
                            <label class="${isCorporate ? 'corp-label' : ''}">Source ${_escapeHtml(sourceType).toUpperCase()} ID</label>
                            <input type="number" id="converter-source-id" class="${isCorporate ? 'corp-input' : 'form-control'}" value="${_escapeHtml(sourceId)}" readonly>
                        </div>
                        <div id="converter-dynamic-fields"></div>
                        <div id="converter-target-id-status" class="alert" style="display: none;"></div>
                        <div id="converter-preflight-result" class="alert" style="display: none;"></div>
                    </form>
                </div>
                <div class="modal-footer">
                    <button type="button" id="converter-run-preflight" class="btn btn-secondary text-proxmox-text">Run Pre-Flight</button>
                    <button type="button" id="converter-submit" class="btn btn-primary text-proxmox-text">Start Conversion</button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);
        requestAnimationFrame(() => modal.classList.add('active'));

        const close = () => modal.remove();
        modal.querySelector('.close-modal').addEventListener('click', close);
        modal.addEventListener('click', e => { if (e.target === modal) close(); });

        const operationSelect = modal.querySelector('#converter-operation');
        const preflightResult = modal.querySelector('#converter-preflight-result');
        const submitBtn = modal.querySelector('#converter-submit');

        function getPayload() {
            const operation = operationSelect.value;
            const schema = CONVERTER_OPERATION_SCHEMAS.find(s => s.value === operation);
            const payload = {
                operation: operation,
                source_cluster_id: clusterId,
                source_node: sourceNode,
                source_type: sourceType,
                source_id: parseInt(modal.querySelector('#converter-source-id').value, 10),
                target_cluster_id: clusterId,
                target_node: sourceNode,
            };

            if (schema) {
                schema.fields.forEach(field => {
                    const el = modal.querySelector('#converter-' + field.id);
                    if (!el) return;
                    if (field.type === 'checkbox') {
                        payload[field.id] = el.checked;
                    } else if (field.type === 'number') {
                        const v = parseInt(el.value, 10);
                        if (!isNaN(v)) payload[field.id] = v;
                    } else if (field.type === 'select' || el.value.trim() !== '') {
                        const v = el.value.trim();
                        if (v) payload[field.id] = v;
                    }
                });
            }

            if (operation === 'lxc_to_vm') {
                payload.target_type = 'vm';
            } else if (operation === 'vm_to_lxc') {
                payload.target_type = 'lxc';
            }

            return payload;
        }

        const targetIdStatus = modal.querySelector('#converter-target-id-status');

        function getTargetType(operation) {
            if (operation === 'lxc_to_vm') return 'vm';
            if (operation === 'vm_to_lxc') return 'lxc';
            return null;
        }

        async function validateTargetId() {
            const operation = operationSelect.value;
            const targetType = getTargetType(operation);
            const input = modal.querySelector('#converter-target_id');
            if (!targetType || !input) {
                targetIdStatus.style.display = 'none';
                return;
            }
            const targetId = parseInt(input.value, 10);
            if (isNaN(targetId) || targetId < 100) {
                targetIdStatus.style.display = 'none';
                submitBtn.disabled = false;
                return;
            }
            const replaceEl = modal.querySelector('#converter-replace_target');
            const replaceTarget = replaceEl ? replaceEl.checked : false;
            targetIdStatus.style.display = 'block';
            targetIdStatus.className = 'alert alert-info';
            targetIdStatus.textContent = 'Checking target ID...';
            try {
                const res = await fetch(`${API_URL}/converter/validate-target-id`, {
                    method: 'POST',
                    credentials: 'include',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        cluster_id: clusterId,
                        node: sourceNode,
                        target_type: targetType,
                        target_id: targetId,
                        replace_target: replaceTarget,
                    }),
                });
                const data = await res.json();
                if (!res.ok) {
                    targetIdStatus.className = 'alert alert-warning';
                    targetIdStatus.textContent = data.error || 'Could not verify target ID';
                    submitBtn.disabled = false;
                    return;
                }
                if (!data.available) {
                    targetIdStatus.className = 'alert alert-danger';
                    targetIdStatus.textContent = data.message || 'Target ID is not available';
                    if (replaceTarget) {
                        targetIdStatus.textContent += ' (replace_target is enabled; the existing workload will be destroyed).';
                        targetIdStatus.className = 'alert alert-warning';
                        submitBtn.disabled = false;
                    } else {
                        submitBtn.disabled = true;
                    }
                } else {
                    targetIdStatus.className = 'alert alert-success';
                    targetIdStatus.textContent = data.message || 'Target ID is available';
                    submitBtn.disabled = false;
                }
            } catch (err) {
                console.error('[converter] target ID check error', err);
                targetIdStatus.className = 'alert alert-warning';
                targetIdStatus.textContent = 'Could not verify target ID: ' + err.message;
                submitBtn.disabled = false;
            }
        }

        _renderConverterOperationFields(modal, operationSelect.value, isCorporate);
        validateTargetId();
        operationSelect.addEventListener('change', () => {
            _renderConverterOperationFields(modal, operationSelect.value, isCorporate);
            validateTargetId();
        });

        const form = modal.querySelector('#converter-form');
        form.addEventListener('input', e => {
            if (e.target.id === 'converter-target_id' || e.target.id === 'converter-replace_target') {
                validateTargetId();
            }
        });
        form.addEventListener('change', e => {
            if (e.target.id === 'converter-target_id' || e.target.id === 'converter-replace_target') {
                validateTargetId();
            }
        });

        modal.querySelector('#converter-run-preflight').addEventListener('click', async () => {
            preflightResult.style.display = 'block';
            preflightResult.className = 'alert alert-info';
            preflightResult.textContent = 'Running pre-flight checks...';
            try {
                const payload = getPayload();
                console.log('[converter] preflight payload', payload);
                const res = await fetch(`${API_URL}/converter/preflight`, {
                    method: 'POST',
                    credentials: 'include',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                });
                console.log('[converter] preflight response', res.status, res.statusText);
                const data = await res.json();
                if (!res.ok) {
                    preflightResult.className = 'alert alert-danger';
                    preflightResult.textContent = data.error || 'Pre-flight failed';
                    return;
                }
                const failed = data.checks.filter(c => c.required && !c.passed);
                if (data.overall_passed && failed.length === 0) {
                    preflightResult.className = 'alert alert-success';
                    preflightResult.textContent = 'All pre-flight checks passed.';
                } else {
                    preflightResult.className = 'alert alert-warning';
                    setHTMLSafe(preflightResult, failed.map(c => `<div><strong>${_escapeHtml(c.name)}</strong>: ${_escapeHtml(c.reason)}<br><em>Fix:</em> ${_escapeHtml(c.fix)}</div>`).join(''));
                }
            } catch (err) {
                console.error('[converter] preflight error', err);
                preflightResult.className = 'alert alert-danger';
                preflightResult.textContent = 'Could not run pre-flight: ' + err.message;
            }
        });

        submitBtn.addEventListener('click', async () => {
            submitBtn.disabled = true;
            submitBtn.textContent = 'Submitting...';
            try {
                const payload = getPayload();
                console.log('[converter] submit payload', payload);
                const res = await fetch(`${API_URL}/converter/jobs`, {
                    method: 'POST',
                    credentials: 'include',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                });
                console.log('[converter] submit response', res.status, res.statusText);
                const data = await res.json();
                if (!res.ok) {
                    console.warn('[converter] submit failed', data);
                    alert(data.error || 'Failed to submit job');
                    submitBtn.disabled = false;
                    submitBtn.textContent = 'Start Conversion';
                    return;
                }
                alert('Conversion job submitted: ' + data.job_id);
                close();
                showConverterJobsModal();
            } catch (err) {
                console.error('[converter] submit error', err);
                alert('Network error: ' + err.message);
                submitBtn.disabled = false;
                submitBtn.textContent = 'Start Conversion';
            }
        });
    }

    function showConverterJobDetailsModal(jobId) {
        const isCorporate = document.body.getAttribute('data-layout') === 'corporate';
        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.id = 'converter-job-detail-modal';
        modal.innerHTML = `
            <div class="${isCorporate ? 'modal-content corp-settings-card' : 'modal-content'}" style="max-width: 760px; max-height: 85vh; display: flex; flex-direction: column;">
                <div class="modal-header">
                    <h3 class="${isCorporate ? 'corp-card-header' : ''}">Job Details</h3>
                    <button class="close-modal">&times;</button>
                </div>
                <div class="modal-body" id="converter-job-detail-body" style="overflow: auto; flex: 1;">
                    <p class="text-muted">Loading job details...</p>
                </div>
                <div class="modal-footer">
                    <button id="converter-job-detail-refresh" class="btn btn-secondary text-proxmox-text">Refresh</button>
                    <button class="btn btn-primary text-proxmox-text close-modal">Close</button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);
        requestAnimationFrame(() => modal.classList.add('active'));

        const close = () => modal.remove();
        modal.querySelectorAll('.close-modal').forEach(btn => btn.addEventListener('click', close));
        modal.addEventListener('click', e => { if (e.target === modal) close(); });

        const body = modal.querySelector('#converter-job-detail-body');

        function statusClass(status) {
            if (status === 'succeeded') return 'text-success';
            if (status === 'failed' || status === 'rolled_back') return 'text-danger';
            if (status === 'running') return 'text-info';
            if (status === 'cancelled') return 'text-warning';
            return 'text-muted';
        }

        function progressBarHTML(pct) {
            return `<div class="progress-bar" style="background: #333; border-radius: 4px; height: 10px; overflow: hidden;">
                <div style="width: ${pct}%; background: #3b82f6; height: 100%;"></div>
            </div><span class="text-xs">${pct}%</span>`;
        }

        async function load() {
            try {
                const [jobRes, logsRes] = await Promise.all([
                    fetch(`${API_URL}/converter/jobs/${encodeURIComponent(jobId)}`, {
                        credentials: 'include',
                        headers: { 'Content-Type': 'application/json' },
                    }),
                    fetch(`${API_URL}/converter/jobs/${encodeURIComponent(jobId)}/logs?limit=200`, {
                        credentials: 'include',
                        headers: { 'Content-Type': 'application/json' },
                    }),
                ]);
                if (!jobRes.ok) {
                    setHTMLSafe(body, `<p class="text-danger">Failed to load job details: ${jobRes.status} ${jobRes.statusText}</p>`);
                    return;
                }
                const job = await jobRes.json();
                const logsData = await logsRes.json();
                const lines = Array.isArray(logsData.lines) ? logsData.lines : [];
                const logText = lines.length ? lines.join('\n') : (job.log_tail || 'No logs recorded yet.');

                const statusLabel = _escapeHtml(CONVERTER_STATUS[job.status] || job.status);
                const src = job.source ? `${_escapeHtml(job.source.type)} ${_escapeHtml(job.source.id)}` : '-';
                const tgt = job.target ? `${_escapeHtml(job.target.type)} ${_escapeHtml(job.target.id)}` : '-';
                const pct = job.progress_pct || 0;

                const metaRows = [
                    ['Status', `<span class="${_escapeHtml(statusClass(job.status))}">${statusLabel}</span>`],
                    ['Phase', _escapeHtml(job.phase || '-')],
                    ['Progress', progressBarHTML(pct)],
                    ['Operation', _escapeHtml(job.operation)],
                    ['Created', _escapeHtml(fmtDate(job.created_at))],
                    ['Started', _escapeHtml(fmtDate(job.started_at) || '-')],
                    ['Completed', _escapeHtml(fmtDate(job.completed_at) || '-')],
                    ['Created by', _escapeHtml(job.created_by || '-')],
                    ['Source', _escapeHtml(src)],
                    ['Target', _escapeHtml(tgt)],
                    ['Target storage', _escapeHtml(job.target_storage || '-')],
                    ['Target disk size', job.target_disk_size_gb ? `${_escapeHtml(job.target_disk_size_gb)} GB` : '-'],
                    ['Target disk format', _escapeHtml(job.target_disk_format || '-')],
                    ['Target bridge', _escapeHtml(job.target_bridge || '-')],
                    ['Target BIOS', _escapeHtml(job.target_bios || '-')],
                    ['Dry run', job.dry_run ? 'Yes' : 'No'],
                    ['Replace target', job.replace_target ? 'Yes' : 'No'],
                    ['Auto start', job.auto_start ? 'Yes' : 'No'],
                    ['Destroy source', job.destroy_source ? 'Yes' : 'No'],
                    ['Detected OS', _escapeHtml(job.detected_os && job.detected_os.distro ? job.detected_os.distro : 'unknown')],
                ];

                let html = `<table class="table text-proxmox-text" style="width: 100%; margin-bottom: 1rem;"><tbody>`;
                html += metaRows.map(([label, value]) => `<tr><td style="width: 30%; color: var(--color-text-muted, #8b949e);">${_escapeHtml(label)}</td><td>${value}</td></tr>`).join('');
                html += `</tbody></table>`;

                if (job.error_code || job.error_reason) {
                    html += `<div class="alert alert-danger" style="margin-bottom: 1rem;">`;
                    html += `<strong>Error code:</strong> ${_escapeHtml(job.error_code || 'N/A')}<br>`;
                    html += `<strong>Reason:</strong> ${_escapeHtml(job.error_reason || 'Unknown error')}<br>`;
                    if (job.error_fix) {
                        html += `<strong>Fix:</strong> ${_escapeHtml(job.error_fix)}`;
                    }
                    html += `</div>`;
                } else if (job.status === 'pending') {
                    html += `<div class="alert alert-info" style="margin-bottom: 1rem;">This job is still pending. It will move to Validating/Pre-flight once the conversion engine picks it up. If it stays pending, check that the ProxmoxVEx worker process is running and the source cluster is connected.</div>`;
                } else if (job.status === 'cancelled') {
                    html += `<div class="alert alert-warning" style="margin-bottom: 1rem;">This job was cancelled by the user.</div>`;
                }

                html += `<h4>Log Tail</h4>`;
                html += `<pre style="max-height: 300px; overflow: auto; background: rgba(0,0,0,0.3); padding: 0.75rem; border-radius: 0.5rem; font-size: 0.75rem; white-space: pre-wrap; word-break: break-word;">${_escapeHtml(logText)}</pre>`;

                setHTMLSafe(body, html);
            } catch (err) {
                console.error('[converter] job details error', err);
                setHTMLSafe(body, `<p class="text-danger">Failed to load job details: ${_escapeHtml(err.message)}</p>`);
            }
        }

        load();
        modal.querySelector('#converter-job-detail-refresh').addEventListener('click', load);
    }

    function showConverterJobsModal() {
        const isCorporate = document.body.getAttribute('data-layout') === 'corporate';
        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.id = 'converter-jobs-modal';
        modal.innerHTML = `
            <div class="${isCorporate ? 'modal-content corp-settings-card' : 'modal-content'}" style="max-width: 900px; max-height: 80vh; display: flex; flex-direction: column;">
                <div class="modal-header">
                    <h3 class="${isCorporate ? 'corp-card-header' : ''}">Conversion Jobs</h3>
                    <button class="close-modal">&times;</button>
                </div>
                <div class="modal-body" style="overflow: auto; flex: 1;">
                    <table class="table text-proxmox-text" style="width: 100%;">
                        <thead>
                            <tr>
                                <th>ID</th>
                                <th>Operation</th>
                                <th>Status</th>
                                <th>Phase</th>
                                <th>Progress</th>
                                <th>Source</th>
                                <th>Target</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody id="converter-jobs-body"></tbody>
                    </table>
                </div>
                <div class="modal-footer">
                    <button id="converter-jobs-clear" class="btn btn-danger text-proxmox-text">Clear completed/cancelled</button>
                    <button id="converter-jobs-refresh" class="btn btn-secondary text-proxmox-text">Refresh</button>
                    <button class="btn btn-primary text-proxmox-text close-modal">Close</button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);
        requestAnimationFrame(() => modal.classList.add('active'));

        const close = () => {
            clearInterval(interval);
            modal.remove();
        };
        modal.querySelectorAll('.close-modal').forEach(btn => btn.addEventListener('click', close));
        modal.addEventListener('click', e => { if (e.target === modal) close(); });

        const tbody = modal.querySelector('#converter-jobs-body');
        const jobMap = new Map();

        function statusClass(status) {
            if (status === 'succeeded') return 'text-success';
            if (status === 'failed' || status === 'rolled_back') return 'text-danger';
            if (status === 'running') return 'text-info';
            if (status === 'cancelled') return 'text-warning';
            return 'text-muted';
        }

        function actionCellHTML(jobId, status) {
            const terminal = ['succeeded', 'failed', 'cancelled', 'rolled_back'];
            const isTerminal = terminal.includes(status);
            const actionLabel = status === 'running' ? 'Stop' : 'Cancel';
            const btnStyle = 'style="padding: 0.25rem 0.5rem; font-size: 0.75rem; margin-right: 0.25rem;"';
            return `<button class="btn btn-secondary text-proxmox-text converter-job-details" ${btnStyle} data-id="${_escapeHtml(jobId)}">Details</button>` +
                (isTerminal
                    ? `<button class="btn btn-danger text-proxmox-text converter-job-clear" ${btnStyle} data-id="${_escapeHtml(jobId)}">Clear</button>`
                    : `<button class="btn btn-warning text-proxmox-text converter-job-cancel" ${btnStyle} data-id="${_escapeHtml(jobId)}">${_escapeHtml(actionLabel)}</button>`);
        }

        async function load() {
            try {
                const res = await fetch(`${API_URL}/converter/jobs?limit=50`, {
                    credentials: 'include',
                    headers: { 'Content-Type': 'application/json' },
                });
                console.log('[converter] jobs response', res.status, res.statusText);
                if (!res.ok) return;
                const data = await res.json();
                const items = data.items || [];
                jobMap.clear();
                items.forEach(j => jobMap.set(j.id, j));
                setHTMLSafe(tbody, items.map(j => {
                    const pct = j.progress_pct || 0;
                    const jid = _escapeHtml(j.id || '');
                    const jop = _escapeHtml(j.operation) || '-';
                    const jstatus = _escapeHtml(j.status);
                    const jphase = _escapeHtml(j.phase) || '-';
                    const src = j.source ? `${_escapeHtml(j.source.type)} ${_escapeHtml(j.source.id)}` : '-';
                    const tgt = j.target ? `${_escapeHtml(j.target.type)} ${_escapeHtml(j.target.id)}` : '-';
                    const statusLabel = _escapeHtml(CONVERTER_STATUS[j.status] || j.status);
                    return `<tr data-id="${jid}" data-status="${jstatus}">
                        <td title="${jid}">${jid.slice(0, 8)}</td>
                        <td>${jop}</td>
                        <td class="${_escapeHtml(statusClass(j.status))}">${statusLabel}</td>
                        <td>${jphase}</td>
                        <td>
                            <div class="progress-bar" style="background: #333; border-radius: 4px; height: 8px; overflow: hidden;">
                                <div style="width: ${pct}%; background: #3b82f6; height: 100%;"></div>
                            </div>
                            <span class="text-xs">${pct}%</span>
                        </td>
                        <td>${src}</td>
                        <td>${tgt}</td>
                        <td>${actionCellHTML(j.id, j.status)}</td>
                    </tr>`;
                }).join(''));
            } catch (err) {
                console.error('[converter] jobs load error', err);
                setHTMLSafe(tbody, `<tr><td colspan="8" class="text-center text-danger">Failed to load jobs: ${_escapeHtml(err.message)}</td></tr>`);
            }
        }

        function updateRow(job) {
            const row = tbody.querySelector(`tr[data-id="${_escapeHtml(job.job_id)}"]`);
            if (!row) {
                load();
                return;
            }
            const statusCell = row.children[2];
            const phaseCell = row.children[3];
            const progressCell = row.children[4];
            const actionCell = row.children[7];
            const pct = job.progress_pct || 0;
            if (statusCell) {
                statusCell.className = statusClass(job.status);
                statusCell.textContent = CONVERTER_STATUS[job.status] || job.status;
            }
            if (phaseCell) phaseCell.textContent = job.phase || '-';
            if (progressCell) {
                progressCell.innerHTML = `<div class="progress-bar" style="background: #333; border-radius: 4px; height: 8px; overflow: hidden;">
                        <div style="width: ${pct}%; background: #3b82f6; height: 100%;"></div>
                    </div>
                    <span class="text-xs">${pct}%</span>`;
            }
            if (actionCell && row.dataset.status !== job.status) {
                row.dataset.status = job.status;
                setHTMLSafe(actionCell, actionCellHTML(job.job_id, job.status));
            }
        }

        tbody.addEventListener('click', async e => {
            const btn = e.target.closest('button[data-id]');
            if (!btn) return;
            const jobId = btn.getAttribute('data-id');
            if (btn.classList.contains('converter-job-details')) {
                showConverterJobDetailsModal(jobId);
            } else if (btn.classList.contains('converter-job-cancel')) {
                try {
                    const res = await fetch(`${API_URL}/converter/jobs/${encodeURIComponent(jobId)}/cancel`, {
                        method: 'POST',
                        credentials: 'include',
                        headers: { 'Content-Type': 'application/json' },
                    });
                    if (!res.ok) {
                        const data = await res.json();
                        alert(data.error || 'Failed to cancel job');
                    }
                    load();
                } catch (err) {
                    alert('Network error: ' + err.message);
                }
            } else if (btn.classList.contains('converter-job-clear')) {
                if (!confirm('Remove this job from the conversion history?')) return;
                try {
                    const res = await fetch(`${API_URL}/converter/jobs/${encodeURIComponent(jobId)}`, {
                        method: 'DELETE',
                        credentials: 'include',
                        headers: { 'Content-Type': 'application/json' },
                    });
                    if (!res.ok) {
                        const data = await res.json();
                        alert(data.error || 'Failed to clear job');
                    }
                    load();
                } catch (err) {
                    alert('Network error: ' + err.message);
                }
            }
        });

        modal.querySelector('#converter-jobs-clear').addEventListener('click', async () => {
            if (!confirm('Clear all completed, failed, and cancelled conversion jobs?')) return;
            try {
                const res = await fetch(`${API_URL}/converter/jobs/clear`, {
                    method: 'POST',
                    credentials: 'include',
                    headers: { 'Content-Type': 'application/json' },
                });
                if (!res.ok) {
                    const data = await res.json();
                    alert(data.error || 'Failed to clear jobs');
                }
                load();
            } catch (err) {
                alert('Network error: ' + err.message);
            }
        });

        window.addEventListener('ProxmoxVEx-converter-job', e => {
            if (e.detail && e.detail.job_id) updateRow(e.detail);
        });

        load();
        const interval = setInterval(load, 15000);
        modal.querySelector('#converter-jobs-refresh').addEventListener('click', load);
    }

    window.showConverterModal = showConverterModal;
    window.showConverterJobsModal = showConverterJobsModal;
})();
