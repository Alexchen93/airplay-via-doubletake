import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

const DOUBLETAKE_CTL = 'doubletake-ctl';
const NO_COMMAND_MESSAGE = `${DOUBLETAKE_CTL} was not found in PATH`;
const MAX_STATUS_LENGTH = 96;
const INDICATOR_NAME = 'AirPlay via DoubleTake';

const AirPlayIndicator = GObject.registerClass(
class AirPlayIndicator extends PanelMenu.Button {
    _init(extension) {
        super._init(0.0, INDICATOR_NAME);

        this._extension = extension;
        this._busy = false;
        this._lastDevices = [];

        const box = new St.BoxLayout({style_class: 'panel-status-menu-box'});
        this._icon = new St.Icon({
            icon_name: 'network-wireless-symbolic',
            style_class: 'system-status-icon',
        });

        box.add_child(this._icon);
        this.add_child(box);
        this._setIndicatorName(INDICATOR_NAME);

        this._buildMenu();
        this._refreshAvailability();
    }

    _buildMenu() {
        this.menu.removeAll();

        this._statusItem = new PopupMenu.PopupMenuItem('Status: idle', {
            reactive: false,
            can_focus: false,
        });
        this.menu.addMenuItem(this._statusItem);
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        this._discoverItem = this._addAction('Discover', () => {
            this._runDoubleTakeCtlAsync(['discover'], 'Discovering devices...', result => {
                this._showCommandResult('Discover', result);
                if (result.ok)
                    this._refreshDevices();
            });
        });

        this._devicesItem = this._addAction('Devices', () => this._refreshDevices());

        this._connectMenu = new PopupMenu.PopupSubMenuMenuItem('Connect');
        this.menu.addMenuItem(this._connectMenu);
        this._populateConnectMenu();

        this._disconnectItem = this._addAction('Disconnect', () => {
            this._runDoubleTakeCtlAsync(['disconnect'], 'Disconnecting...', result => {
                this._showCommandResult('Disconnect', result);
            });
        });

        this._statusActionItem = this._addAction('Status', () => {
            this._runDoubleTakeCtlAsync(['status'], 'Checking status...', result => {
                this._showCommandResult('Status', result);
            });
        });
    }

    _addAction(label, callback) {
        const item = new PopupMenu.PopupMenuItem(label);
        item.connect('activate', callback);
        this.menu.addMenuItem(item);
        return item;
    }

    _refreshAvailability() {
        const available = this._findDoubleTakeCtl() !== null;
        this._setActionsSensitive(available);

        if (available) {
            this._setStatus('Ready');
            return;
        }

        this._setStatus(NO_COMMAND_MESSAGE);
        this._connectMenu.menu.removeAll();
        this._connectMenu.menu.addMenuItem(new PopupMenu.PopupMenuItem(NO_COMMAND_MESSAGE, {
            reactive: false,
            can_focus: false,
        }));
    }

    _setActionsSensitive(sensitive) {
        for (const item of [
            this._discoverItem,
            this._devicesItem,
            this._disconnectItem,
            this._statusActionItem,
            this._connectMenu,
        ])
            item?.setSensitive(sensitive && !this._busy);
    }

    _setBusy(busy) {
        this._busy = busy;
        this._setActionsSensitive(!busy && this._findDoubleTakeCtl() !== null);
    }

    _setStatus(text) {
        this._statusItem.label.text = `Status: ${this._truncateOneLine(text)}`;
    }

    _setIndicatorName(name) {
        if (typeof this.set_accessible_name === 'function')
            this.set_accessible_name(name);
        else if ('accessible_name' in this)
            this.accessible_name = name;

        if (typeof this.set_tooltip_text === 'function')
            this.set_tooltip_text(name);
        else if ('tooltip_text' in this)
            this.tooltip_text = name;
    }

    _findDoubleTakeCtl() {
        return GLib.find_program_in_path(DOUBLETAKE_CTL);
    }

    _runDoubleTakeCtlAsync(args, busyText, callback) {
        const command = this._findDoubleTakeCtl();
        if (command === null) {
            const result = {ok: false, stdout: '', stderr: NO_COMMAND_MESSAGE};
            this._showCommandResult(DOUBLETAKE_CTL, result);
            callback?.(result);
            return;
        }

        this._setBusy(true);
        this._setStatus(busyText);

        let subprocess;
        try {
            subprocess = Gio.Subprocess.new(
                [command, ...args],
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
            );
        } catch (error) {
            const result = {ok: false, stdout: '', stderr: error.message};
            this._setBusy(false);
            this._showCommandResult(DOUBLETAKE_CTL, result);
            callback?.(result);
            return;
        }

        subprocess.communicate_utf8_async(null, null, (proc, asyncResult) => {
            let result;
            try {
                const [, stdout, stderr] = proc.communicate_utf8_finish(asyncResult);
                result = {
                    ok: proc.get_successful(),
                    stdout: (stdout ?? '').trim(),
                    stderr: (stderr ?? '').trim(),
                    status: proc.get_exit_status(),
                };
            } catch (error) {
                result = {ok: false, stdout: '', stderr: error.message};
            }

            this._setBusy(false);
            callback?.(result);
        });
    }

    _showCommandResult(action, result) {
        const summary = this._summarizeCommandResult(result) || `exit status ${result.status ?? 'unknown'}`;
        this._setStatus(result.ok ? `${action}: ${summary}` : `${action} failed: ${summary}`);
    }

    _truncateOneLine(text) {
        const oneLine = String(text ?? '').replace(/\s+/g, ' ').trim();
        if (oneLine.length <= MAX_STATUS_LENGTH)
            return oneLine;

        return `${oneLine.slice(0, MAX_STATUS_LENGTH - 1)}...`;
    }

    _summarizeCommandResult(result) {
        const output = result.ok ? result.stdout : (result.stderr || result.stdout);
        return this._summarizeOutput(output) || this._truncateOneLine(output);
    }

    _summarizeOutput(output) {
        const trimmed = String(output ?? '').trim();
        if (!trimmed)
            return '';

        try {
            const parsed = JSON.parse(trimmed);

            if (Array.isArray(parsed))
                return parsed.length === 1 ? '1 item' : `${parsed.length} items`;

            if (parsed !== null && typeof parsed === 'object') {
                const devices = Array.isArray(parsed.devices) ? parsed.devices : null;
                if (devices !== null)
                    return devices.length === 1 ? '1 device found' : `${devices.length} devices found`;

                return this._summarizeStatusObject(parsed);
            }
        } catch (_error) {
            if (/^[\[{]/.test(trimmed))
                return 'Unrecognized JSON response';
        }

        return this._truncateOneLine(trimmed.split('\n')[0]);
    }

    _summarizeStatusObject(status) {
        const parts = [];

        if (status.state !== undefined)
            parts.push(`state: ${String(status.state)}`);
        else if (status.ok !== undefined)
            parts.push(status.ok ? 'ok' : 'not ok');

        if (status.has_audio === false)
            parts.push('no audio');
        else if (status.audio_muted === true)
            parts.push('audio muted');
        else if (status.has_audio === true)
            parts.push('audio ready');

        if (status.target !== undefined)
            parts.push(`target: ${String(status.target)}`);

        return this._truncateOneLine(parts.length > 0 ? parts.join(', ') : 'status received');
    }

    _refreshDevices() {
        this._runDoubleTakeCtlAsync(['devices'], 'Loading devices...', result => {
            if (!result.ok) {
                this._showCommandResult('Devices', result);
                return;
            }

            const parsed = this._parseDevicesResult(result.stdout);
            this._lastDevices = parsed.devices;
            this._populateConnectMenu();

            const count = this._lastDevices.length;
            if (count > 0)
                this._setStatus(count === 1 ? '1 device found' : `${count} devices found`);
            else
                this._setStatus(parsed.statusText || 'No devices found');
        });
    }

    _parseDevicesResult(output) {
        if (!output)
            return {devices: [], statusText: 'No devices found'};

        try {
            const parsed = JSON.parse(output);
            const devices = Array.isArray(parsed) ? parsed : parsed.devices;
            if (Array.isArray(devices)) {
                return {
                    devices: devices
                    .map((device, index) => this._normalizeDevice(device, index))
                    .filter(device => device.id.length > 0),
                    statusText: null,
                };
            }

            if (parsed !== null && typeof parsed === 'object')
                return {devices: [], statusText: this._summarizeStatusObject(parsed)};
        } catch (_error) {
            if (/^[\[{]/.test(output.trim()))
                return {devices: [], statusText: 'Unrecognized devices response'};
        }

        const devices = output
            .split('\n')
            .map(line => line.trim())
            .filter(line => line.length > 0)
            .filter(line => !/^[\[{]/.test(line))
            .filter(line => !/^id\s+|^device\s+|^-+$/i.test(line))
            .map(line => {
                const id = line.split(/\s+/)[0];
                return {id, label: this._truncateOneLine(line)};
            })
            .filter(device => device.id.length > 0);

        return {devices, statusText: devices.length > 0 ? null : 'No devices found'};
    }

    _normalizeDevice(device, index) {
        if (typeof device === 'string')
            return {id: device, label: device};

        if (device === null || typeof device !== 'object')
            return {id: '', label: ''};

        const id = String(device.id ?? device.udn ?? device.ip ?? device.host ?? device.hostname ?? device.name ?? '');
        const name = String(device.name ?? device.displayName ?? device.model ?? device.hostname ?? device.host ?? device.ip ?? id);
        return {id, label: name === id ? id : `${name} (${id})`};
    }

    _populateConnectMenu() {
        this._connectMenu.menu.removeAll();

        this._addManualConnectControls();
        this._connectMenu.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        const refreshItem = new PopupMenu.PopupMenuItem('Refresh devices');
        refreshItem.connect('activate', () => this._refreshDevices());
        this._connectMenu.menu.addMenuItem(refreshItem);
        this._connectMenu.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        if (this._lastDevices.length === 0) {
            this._connectMenu.menu.addMenuItem(new PopupMenu.PopupMenuItem('No devices found', {
                reactive: false,
                can_focus: false,
            }));
            return;
        }

        for (const device of this._lastDevices) {
            const item = new PopupMenu.PopupMenuItem(device.label);
            item.connect('activate', () => {
                this._runDoubleTakeCtlAsync(['connect', device.id], `Connecting ${device.id}...`, result => {
                    this._showCommandResult('Connect', result);
                });
            });
            this._connectMenu.menu.addMenuItem(item);
        }
    }

    _addManualConnectControls() {
        this._manualTargetEntry = this._createEntry('Target IP or hostname');
        this._manualPinEntry = this._createEntry('PIN or leave blank');

        this._connectMenu.menu.addMenuItem(this._createEntryItem('Target', this._manualTargetEntry));
        this._connectMenu.menu.addMenuItem(this._createEntryItem('PIN', this._manualPinEntry));

        this._connectMenu.menu.addMenuItem(new PopupMenu.PopupMenuItem('PIN can also be supplied with DOUBLETAKE_CODE', {
            reactive: false,
            can_focus: false,
        }));

        const connectItem = new PopupMenu.PopupMenuItem('Connect to target');
        connectItem.connect('activate', () => this._connectManualTarget());
        this._connectMenu.menu.addMenuItem(connectItem);

        for (const entry of [this._manualTargetEntry, this._manualPinEntry]) {
            entry.clutter_text.connect('activate', () => this._connectManualTarget());
        }
    }

    _createEntry(hintText) {
        return new St.Entry({
            hint_text: hintText,
            can_focus: true,
            x_expand: true,
            style_class: 'search-entry',
        });
    }

    _createEntryItem(label, entry) {
        const item = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
        });
        item.add_child(new St.Label({
            text: label,
            style: 'min-width: 4.5em;',
        }));
        item.add_child(entry);
        return item;
    }

    _connectManualTarget() {
        const target = this._manualTargetEntry?.get_text().trim() ?? '';
        const pin = this._manualPinEntry?.get_text().trim() ?? '';

        if (target.length === 0) {
            this._setStatus('Enter a target IP or hostname');
            return;
        }

        const args = pin.length > 0 ? ['connect', target, pin] : ['connect', target];
        this._runDoubleTakeCtlAsync(args, `Connecting ${target}...`, result => {
            this._showCommandResult('Connect', result);
        });
    }

    destroy() {
        this._extension = null;
        super.destroy();
    }
});

export default class AirPlayViaDoubleTakeExtension extends Extension {
    enable() {
        this._indicator = new AirPlayIndicator(this);
        Main.panel.addToStatusArea(this.uuid, this._indicator);
    }

    disable() {
        this._indicator?.destroy();
        this._indicator = null;
    }
}
