declare module 'dbus-next' {
  export interface ClientInterface {
    on(event: string, cb: (...args: any[]) => void): this;
    off(event: string, cb: (...args: any[]) => void): this;
    [method: string]: any;
  }
  export interface ProxyObject {
    getInterface(name: string): ClientInterface;
  }
  export interface MessageBus {
    getProxyObject(name: string, path: string): Promise<ProxyObject>;
    disconnect(): void;
  }
  export function sessionBus(): MessageBus;
  const _default: {sessionBus: typeof sessionBus};
  export default _default;
}
