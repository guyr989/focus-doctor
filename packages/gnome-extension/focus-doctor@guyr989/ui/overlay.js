import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';
import {MessageDialogContent} from 'resource:///org/gnome/shell/ui/dialog.js';
import {ModalDialog} from 'resource:///org/gnome/shell/ui/modalDialog.js';

export const FocusOverlay = GObject.registerClass({
    Signals: {'action': {param_types: [GObject.TYPE_STRING]}},
}, class FocusOverlay extends ModalDialog {
    _init(payload) {
        super._init({styleClass: 'focus-overlay', destroyOnClose: true});
        this._payload = payload;
        const minutes = Math.max(1, Math.round(payload.driftSeconds / 60));
        this.contentLayout.add_child(new MessageDialogContent({
            title: `${minutes} min off task`,
            description: `You should be on:  ${payload.task}\nYou're in:  ${payload.app ?? '?'} — ${payload.title ?? ''}`,
        }));
        this._entry = null;
        this._stageMain();
    }

    _choose(action, extra = {}) {
        this.emit('action', JSON.stringify({action, ...extra}));
        this.close();
    }

    _stageMain() {
        const last = this._payload.snoozeMinutes;
        this.setButtons([
            {label: 'Back to task', action: () => this._choose('dismiss'), key: Clutter.KEY_Escape, default: true},
            {label: 'This was for the task', action: () => this._choose('confirm_on_task')},
            {label: `Snooze ${last} min`, action: () => this._choose('snooze', {minutes: last})},
            {label: 'Snooze…', action: () => this._stageSnooze()},
            {label: 'Save for later', action: () => this._choose('defer')},
            {label: 'More…', action: () => this._stageMore()},
        ]);
    }

    _stageSnooze() {
        this._entry?.hide();
        this.setButtons([
            ...this._payload.snoozePresets.map(m => ({label: `${m} min`, action: () => this._choose('snooze', {minutes: m})})),
            {label: 'Custom…', action: () => this._stageCustom()},
            {label: 'Back', action: () => this._stageMain()},
        ]);
    }

    _stageCustom() {
        if (!this._entry) {
            this._entry = new St.Entry({hint_text: 'minutes, e.g. 180', can_focus: true, x_expand: true});
            this._entry.clutter_text.connectObject('activate', () => this._submitCustom(), this);
            this.contentLayout.add_child(this._entry);
        }
        this._entry.show();
        this._entry.grab_key_focus();
        this.setButtons([
            {label: 'Snooze', action: () => this._submitCustom(), default: true},
            {label: 'Back', action: () => this._stageSnooze()},
        ]);
    }

    _submitCustom() {
        const minutes = parseInt(this._entry.get_text(), 10);
        if (minutes > 0) this._choose('snooze', {minutes});
    }

    _stageMore() {
        this.setButtons([
            {label: 'Make this my task', action: () => this._choose('promote')},
            {label: 'Allow this app today', action: () => this._choose('override', {kind: 'allow_app_today'})},
            {label: 'Notifications only today', action: () => this._choose('override', {kind: 'notify_only_today'})},
            {label: 'Settings', action: () => this._choose('settings')},
            {label: 'Back', action: () => this._stageMain()},
        ]);
    }
});
