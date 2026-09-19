import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

const IFACE = `
<node>
  <interface name="org.guyr.FocusMonitor">
    <method name="GetFocusedWindow"><arg type="s" direction="out" name="json"/></method>
    <method name="ShowFlash"><arg type="s" direction="in" name="text"/></method>
    <signal name="FocusChanged"><arg type="s" name="json"/></signal>
  </interface>
</node>`;

function describe(win) {
    if (!win) return {wm_class: null, title: null, pid: null};
    return {wm_class: win.get_wm_class(), title: win.get_title(), pid: win.get_pid()};
}

export default class FocusMonitorExtension extends Extension {
    enable() {
        this._dbus = Gio.DBusExportedObject.wrapJSObject(IFACE, this);
        this._dbus.export(Gio.DBus.session, '/org/guyr/FocusMonitor');
        this._nameId = Gio.DBus.session.own_name('org.guyr.FocusMonitor',
            Gio.BusNameOwnerFlags.NONE, null, null);
        global.display.connectObject('notify::focus-window', () => this._onFocus(), this);
        this._onFocus();
    }

    disable() {
        global.display.disconnectObject(this);
        this._watched?.disconnectObject(this);
        this._watched = null;
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
