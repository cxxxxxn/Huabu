// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

export interface LocalAgentState {
  enabled: boolean;
  agentletId?: string;
  device?: { agentletId: string; displayName: string; version: string };
  status:
    | 'disabled'
    | 'connecting'
    | 'connected'
    | 'reconnecting'
    | 'stopping'
    | 'authorization-required'
    | 'error';
  error: string | null;
}

export interface LocalAgentCredential {
  token: string;
  maxAgents: number;
}

export interface LocalAgentChild {
  postMessage(message: unknown): void;
  kill(): boolean;
  on(event: 'message', listener: (message: unknown) => void): this;
  once(event: 'exit', listener: (code: number) => void): this;
}

interface LocalAgentOptions {
  readDevice(): Promise<{
    agentletId: string;
    displayName: string;
    version: string;
  }>;
  readCredential(): LocalAgentCredential | null;
  saveCredential(credential: LocalAgentCredential | null): void;
  requestCredential(): Promise<LocalAgentCredential>;
  start(credential: LocalAgentCredential): Promise<LocalAgentChild>;
  onState(state: LocalAgentState): void;
}

export class LocalAgentManager {
  private state: LocalAgentState = {
    enabled: false,
    status: 'disabled',
    error: null,
  };
  private child: LocalAgentChild | null = null;
  private credential: LocalAgentCredential | null = null;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private crashes: number[] = [];
  private busy = false;
  private quitting = false;
  private stopPromise: Promise<void> | null = null;
  private starting: Promise<void> | null = null;
  private connectionRejected = false;

  constructor(private readonly options: LocalAgentOptions) {}

  getState(): LocalAgentState {
    return { ...this.state };
  }

  private publish(patch: Partial<LocalAgentState>): void {
    this.state = { ...this.state, ...patch };
    this.options.onState(this.getState());
  }

  async restore(): Promise<void> {
    this.busy = true;
    try {
      this.publish({ device: await this.options.readDevice() });
      if (this.quitting) return;
      this.credential = this.options.readCredential();
      if (!this.credential) return;
      this.publish({ enabled: true });
      await this.run();
    } catch (error) {
      this.fail(error);
    } finally {
      this.busy = false;
    }
  }

  async setEnabled(enabled: boolean): Promise<LocalAgentState> {
    if (this.busy || this.quitting) {
      throw new Error(
        'A local Agent connection operation is already in progress.',
      );
    }
    this.busy = true;
    try {
      if (!enabled) {
        this.options.saveCredential(null);
        this.credential = null;
        this.publish({ enabled: false });
        await this.stop();
        this.publish({
          status: 'disabled',
          error: null,
          agentletId: undefined,
        });
      } else {
        await this.stop();
        this.publish({
          status: 'connecting',
          error: null,
          agentletId: undefined,
        });
        this.connectionRejected = false;
        const credential = await this.options.requestCredential();
        if (this.quitting) return this.getState();
        this.options.saveCredential(credential);
        this.credential = credential;
        this.crashes = [];
        this.publish({ enabled: true });
        await this.run();
      }
    } catch (error) {
      this.fail(error);
    } finally {
      this.busy = false;
    }
    return this.getState();
  }

  private fail(error: unknown): void {
    this.publish({
      status: 'error',
      error: error instanceof Error ? error.message : String(error),
    });
  }

  private async run(): Promise<void> {
    if (this.starting) return this.starting;
    this.starting = this.startChild();
    try {
      await this.starting;
    } finally {
      this.starting = null;
    }
  }

  private async startChild(): Promise<void> {
    if (this.child || !this.credential || this.quitting || !this.state.enabled)
      return;
    this.publish({ status: 'connecting', error: null });
    const child = await this.options.start(this.credential);
    this.child = child;
    child.on('message', (message) => {
      if (
        this.child !== child ||
        !this.state.enabled ||
        this.quitting ||
        this.state.status === 'stopping' ||
        !message ||
        typeof message !== 'object'
      )
        return;
      const event = 'type' in message ? message.type : undefined;
      if (event === 'agentlet:ready') {
        if (
          !('agentletId' in message) ||
          typeof message.agentletId !== 'string' ||
          !message.agentletId.trim()
        ) {
          this.fail(
            new Error('The local worker did not report its device ID.'),
          );
          return;
        }
        this.publish({
          status: 'connected',
          error: null,
          agentletId: message.agentletId,
        });
      } else if (event === 'agentlet:reconnecting') {
        this.publish({ status: 'reconnecting', error: null });
      } else if (event === 'agentlet:authorization-required') {
        this.connectionRejected = true;
        this.publish({
          status: 'authorization-required',
          error:
            'Device authorization was rejected. Reconnect to authorize this device again.',
        });
      } else if (event === 'agentlet:rejected') {
        this.connectionRejected = true;
        this.publish({
          status: 'error',
          error:
            'The server rejected this worker. Check whether another Agentlet on this computer is already connected, then reconnect.',
        });
      }
    });
    child.once('exit', (code) => {
      if (this.child !== child) return;
      this.child = null;
      if (this.stopPromise || this.quitting || !this.state.enabled) return;
      if (this.connectionRejected) return;
      if (code === 0) {
        this.fail(
          new Error(
            'The local Agent worker stopped. Reconnect to start it again.',
          ),
        );
        return;
      }
      this.crashes = this.crashes.filter((time) => Date.now() - time < 60_000);
      this.crashes.push(Date.now());
      if (this.crashes.length >= 5) {
        this.fail(
          new Error(
            'The local Agent worker repeatedly exited. Reconnect to try again.',
          ),
        );
        return;
      }
      this.publish({ status: 'reconnecting', error: null });
      this.restartTimer = setTimeout(
        () => {
          this.restartTimer = null;
          void this.run().catch((error: unknown) => this.fail(error));
        },
        Math.min(1000 * 2 ** (this.crashes.length - 1), 30_000),
      );
    });
  }

  private async stop(): Promise<void> {
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = null;
    await this.starting;
    if (this.stopPromise) return this.stopPromise;
    const child = this.child;
    if (!child) return;
    this.publish({ status: 'stopping', error: null });
    this.stopPromise = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        try {
          child.kill();
          reject(
            new Error(
              'Local Agent cleanup timed out; termination was requested. Check for unfinished tasks.',
            ),
          );
        } catch (error) {
          reject(error);
        }
      }, 12_000);
      child.once('exit', (code) => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else
          reject(
            new Error(
              'Local Agent cleanup failed. Check for unfinished tasks before reconnecting.',
            ),
          );
      });
      try {
        child.postMessage({ type: 'agentlet:stop' });
      } catch (error) {
        clearTimeout(timer);
        reject(error);
      }
    });
    try {
      await this.stopPromise;
    } finally {
      this.stopPromise = null;
    }
  }

  async shutdown(): Promise<void> {
    this.quitting = true;
    await this.stop();
  }
}
