import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import {FocusOverlay} from './ui/overlay.js';

const IFACE = `
<node>
  <interface name="org.guyr.FocusDoctor">
    <method name="GetFocusedWindow"><arg type="s" direction="out" name="json"/></method>
    <method name="ShowFlash"><arg type="s" direction="in" name="text"/></method>
    <method name="ShowAck"><arg type="s" direction="in" name="json"/></method>
    <method name="ShowOverlay"><arg type="s" direction="in" name="json"/></method>
    <signal name="FocusChanged"><arg type="s" name="json"/></signal>
    <signal name="OverlayAction"><arg type="s" name="json"/></signal>
  </interface>
</node>`;

function describe(win) {
    if (!win) return {wm_class: null, title: null, pid: null};
    return {wm_class: win.get_wm_class(), title: win.get_title(), pid: win.get_pid()};
}

export default class FocusDoctorExtension extends Extension {
    enable() {
        this._dbus = Gio.DBusExportedObject.wrapJSObject(IFACE, this);
        this._dbus.export(Gio.DBus.session, '/org/guyr/FocusDoctor');
        this._nameId = Gio.DBus.session.own_name('org.guyr.FocusDoctor',
            Gio.BusNameOwnerFlags.NONE, null, null);
        global.display.connectObject('notify::focus-window', () => this._onFocus(), this);
        this._onFocus();
    }

    disable() {
        global.display.disconnectObject(this);
        this._watched?.disconnectObject(this);
        this._watched = null;
        this._overlay?.close();
        this._overlay = null;
        this._notification?.destroy();
        this._notification = null;
        this._source?.destroy();
        this._source = null;
        if (this._nameId) Gio.DBus.session.unown_name(this._nameId);
        this._dbus?.unexport();
        this._dbus = this._nameId = null;
    }

    GetFocusedWindow() {
        return JSON.stringify(describe(global.display.focus_window));
    }

    ShowFlash(text) {
        Main.osdWindowManager.showAll(Gio.ThemedIcon.new('dialog-warning-symbolic'), text);
    }

    // Own source: the shared "System" source destroys itself when empty, so it can't be cached.
    _notificationSource() {
        if (!this._source) {
            this._source = new MessageTray.Source({title: 'Focus Doctor', iconName: 'dialog-warning-symbolic'});
            this._source.connectObject('destroy', () => (this._source = null), this);
            Main.messageTray.add(this._source);
        }
        return this._source;
    }

    ShowAck(json) {
        const {title, body} = JSON.parse(json);
        this._notification?.destroy();
        const source = this._notificationSource();
        const n = new MessageTray.Notification({source, title, body, urgency: MessageTray.Urgency.CRITICAL});
        n.addAction("I'm on it", () => this._emitAction({action: 'ack'}));
        n.addAction('This was for the task', () => this._emitAction({action: 'confirm_on_task'}));
        n.connectObject('destroy', () => {
            if (this._notification === n) this._notification = null;
        }, this);
        this._notification = n;
        source.addNotification(n);
    }

    ShowOverlay(json) {
        this._overlay?.close();
        const overlay = new FocusOverlay(JSON.parse(json));
        overlay.connectObject(
            'action', (_o, a) => this._emitAction(JSON.parse(a)),
            'destroy', () => {
                if (this._overlay === overlay) this._overlay = null;
            },
            this);
        this._overlay = overlay;
        overlay.open();
    }

    _emitAction(action) {
        this._dbus?.emit_signal('OverlayAction', new GLib.Variant('(s)', [JSON.stringify(action)]));
    }

    _onFocus() {
        const win = global.display.focus_window;
        this._watched?.disconnectObject(this);
        this._watched = win;
        win?.connectObject('notify::title', () => this._emit(win), this);
        this._emit(win);
    }

    _emit(win) {
        this._dbus?.emit_signal('FocusChanged',
            new GLib.Variant('(s)', [JSON.stringify(describe(win))]));
    }
}
