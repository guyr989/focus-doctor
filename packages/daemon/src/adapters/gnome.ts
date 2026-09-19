import dbus, {type ClientInterface, type MessageBus} from 'dbus-next';
import type {OverlayAction, OverlayPayload, Shell, Signal} from '../types.js';

const NAME = 'org.guyr.FocusMonitor';
const PATH = '/org/guyr/FocusMonitor';
const IDLE_NAME = 'org.gnome.Mutter.IdleMonitor';
const IDLE_PATH = '/org/gnome/Mutter/IdleMonitor/Core';

function parse(json: string): Signal {
  const w = JSON.parse(json) as {wm_class: string | null; title: string | null};
  return {app: w.wm_class, title: w.title};
}

export class GnomeShell implements Shell {
  private bus: MessageBus | null = null;
  private iface: ClientInterface | null = null;
  private idle: ClientInterface | null = null;
  private handler: ((json: string) => void) | null = null;
  private actionHandler: ((json: string) => void) | null = null;

  async start(onSignal: (s: Signal) => void): Promise<void> {
    this.bus = dbus.sessionBus();
    const obj = await this.bus.getProxyObject(NAME, PATH);
    this.iface = obj.getInterface(NAME);
    this.idle = (await this.bus.getProxyObject(IDLE_NAME, IDLE_PATH)).getInterface(IDLE_NAME);
    this.handler = json => onSignal(parse(json));
    this.iface.on('FocusChanged', this.handler);
    onSignal(parse(await this.iface.GetFocusedWindow()));
  }

  async stop(): Promise<void> {
    if (this.iface && this.handler) this.iface.off('FocusChanged', this.handler);
    if (this.iface && this.actionHandler) this.iface.off('OverlayAction', this.actionHandler);
    this.bus?.disconnect();
    this.iface = this.idle = this.handler = this.actionHandler = this.bus = null;
  }

  async idleMs(): Promise<number> {
    return Number((await this.idle?.GetIdletime()) ?? 0);
  }

  async flash(text: string): Promise<void> {
    await this.iface?.ShowFlash(text);
  }

  async ack(title: string, body: string): Promise<void> {
    await this.iface?.ShowAck(JSON.stringify({title, body}));
  }

  async overlay(payload: OverlayPayload): Promise<void> {
    await this.iface?.ShowOverlay(JSON.stringify(payload));
  }

  onAction(cb: (a: OverlayAction) => void): void {
    this.actionHandler = json => cb(JSON.parse(json) as OverlayAction);
    this.iface?.on('OverlayAction', this.actionHandler);
  }
}
