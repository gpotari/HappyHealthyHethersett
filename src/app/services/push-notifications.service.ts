import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { catchError, from, map, of, switchMap, tap } from 'rxjs';

interface PushNotificationConfig {
  enabled: boolean;
  publicKey?: string;
}

interface PushNotificationTestResponse {
  ok: boolean;
  sent: number;
}

export type PushReminderResultReason =
  | 'unsupported'
  | 'permission-denied'
  | 'permission-dismissed'
  | 'not-configured'
  | 'subscription-failed'
  | 'send-failed'
  | 'display-timeout'
  | 'display-failed';

export interface PushReminderResult {
  ok: boolean;
  reason?: PushReminderResultReason;
}

interface SerializedPushSubscription {
  endpoint: string;
  expirationTime?: number | null;
  keys: {
    p256dh: string;
    auth: string;
  };
}

interface PushServiceWorkerMessage {
  type?: string;
  testId?: string | null;
}

@Injectable({ providedIn: 'root' })
export class PushNotificationsService {
  private readonly apiUrl = '/api/notifications';
  private config: PushNotificationConfig | null | undefined;

  constructor(private http: HttpClient) {}

  loadConfig(force = false) {
    if (!this.isSupported()) {
      this.config = null;
      return of(false);
    }

    if (!force && this.config !== undefined) {
      return of(Boolean(this.config?.enabled && this.config.publicKey));
    }

    return this.http.get<PushNotificationConfig>(`${this.apiUrl}/config`).pipe(
      tap((config) => {
        this.config = config;
      }),
      map((config) => Boolean(config.enabled && config.publicKey)),
      catchError(() => {
        this.config = null;
        return of(false);
      })
    );
  }

  enableLitterPickReminders() {
    if (!this.isSupported()) {
      return of(false);
    }

    if (this.config?.enabled && this.config.publicKey) {
      return this.enableWithConfig(this.config);
    }

    return this.loadConfig(true).pipe(
      switchMap(() => this.enableWithConfig(this.config ?? null)),
      catchError(() => of(false))
    );
  }

  sendTestReminder() {
    if (!this.isSupported()) {
      return of(this.result(false, 'unsupported'));
    }

    return from(this.requestNotificationPermission()).pipe(
      switchMap((permission) => {
        if (permission === 'denied') {
          return of(this.result(false, 'permission-denied'));
        }
        if (permission !== 'granted') {
          return of(this.result(false, 'permission-dismissed'));
        }

        return this.loadConfig(true).pipe(
          switchMap(() => this.sendTestWithConfig(this.config ?? null))
        );
      }),
      catchError(() => of(this.result(false, 'send-failed')))
    );
  }

  private enableWithConfig(config: PushNotificationConfig | null) {
    if (!config?.enabled || !config.publicKey) {
      return of(false);
    }

    return this.createSavedSubscription(config.publicKey).pipe(
      map((subscription) => Boolean(subscription))
    );
  }

  private sendTestWithConfig(config: PushNotificationConfig | null) {
    if (!config?.enabled || !config.publicKey) {
      return of(this.result(false, 'not-configured'));
    }

    return this.createSavedSubscription(config.publicKey).pipe(
      switchMap((subscription) => {
        if (!subscription) {
          return of(this.result(false, 'subscription-failed'));
        }

        const testId = this.createTestId();
        const pushDisplayed = this.waitForPushDisplay(testId);
        return this.http
          .post<PushNotificationTestResponse>(
            `${this.apiUrl}/test`,
            { endpoint: subscription.endpoint, testId },
            { withCredentials: true }
          )
          .pipe(
            switchMap((response) => {
              const ok = response.ok && response.sent > 0;
              if (!ok) {
                return of(this.result(false, 'send-failed'));
              }

              return from(pushDisplayed).pipe(
                map((displayState) => this.result(
                  displayState === 'shown',
                  displayState === 'shown'
                    ? undefined
                    : displayState === 'failed'
                      ? 'display-failed'
                      : 'display-timeout'
                ))
              );
            }),
            catchError(() => of(this.result(false, 'send-failed')))
          );
      }),
      catchError(() => of(this.result(false, 'send-failed')))
    );
  }

  private createSavedSubscription(publicKey: string) {
    return from(this.createSubscription(publicKey)).pipe(
      switchMap((subscription) => {
        const serialized = this.serializeSubscription(subscription);
        if (!serialized) {
          return of(null);
        }

        return this.saveSubscription(serialized).pipe(
          map((saved) => saved ? serialized : null)
        );
      }),
      catchError(() => of(null))
    );
  }

  private async createSubscription(publicKey: string): Promise<PushSubscription | null> {
    const permission = await this.requestNotificationPermission();
    if (permission !== 'granted') {
      return null;
    }

    const registration = await navigator.serviceWorker.register('/push-notifications-sw.js', {
      updateViaCache: 'none'
    });
    await registration.update();
    const readyRegistration = await navigator.serviceWorker.ready;
    const existingSubscription = await readyRegistration.pushManager.getSubscription();
    if (existingSubscription) {
      return existingSubscription;
    }

    return await readyRegistration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: this.urlBase64ToUint8Array(publicKey)
    });
  }

  private serializeSubscription(subscription: PushSubscription | null): SerializedPushSubscription | null {
    if (!subscription) {
      return null;
    }

    const serialized = subscription.toJSON();
    if (!serialized.endpoint || !serialized.keys?.['p256dh'] || !serialized.keys?.['auth']) {
      return null;
    }

    return {
      endpoint: serialized.endpoint,
      expirationTime: serialized.expirationTime,
      keys: {
        p256dh: serialized.keys['p256dh'],
        auth: serialized.keys['auth']
      }
    };
  }

  private saveSubscription(subscription: SerializedPushSubscription) {
    return this.http
      .post<{ ok: boolean }>(
        `${this.apiUrl}/subscriptions`,
        subscription,
        { withCredentials: true }
      )
      .pipe(
        map(() => true),
        catchError(() => of(false))
      );
  }

  private isSupported(): boolean {
    return typeof window !== 'undefined'
      && 'Notification' in window
      && 'serviceWorker' in navigator
      && 'PushManager' in window;
  }

  private async requestNotificationPermission(): Promise<NotificationPermission> {
    return Notification.permission === 'default'
      ? await Notification.requestPermission()
      : Notification.permission;
  }

  private waitForPushDisplay(testId: string): Promise<'shown' | 'failed' | 'timeout'> {
    return new Promise((resolve) => {
      if (!('serviceWorker' in navigator)) {
        resolve('timeout');
        return;
      }

      let settled = false;
      const settle = (displayState: 'shown' | 'failed' | 'timeout') => {
        if (settled) {
          return;
        }

        settled = true;
        window.clearTimeout(timeoutId);
        navigator.serviceWorker.removeEventListener('message', handleMessage);
        resolve(displayState);
      };
      const handleMessage = (event: MessageEvent<PushServiceWorkerMessage>) => {
        if (event.data?.testId !== testId) {
          return;
        }

        if (event.data.type === 'hhh-push-shown') {
          settle('shown');
        } else if (event.data.type === 'hhh-push-display-failed') {
          settle('failed');
        }
      };
      const timeoutId = window.setTimeout(() => settle('timeout'), 8000);

      navigator.serviceWorker.addEventListener('message', handleMessage);
    });
  }

  private createTestId(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  private result(ok: boolean, reason?: PushReminderResultReason): PushReminderResult {
    return { ok, reason };
  }

  private urlBase64ToUint8Array(value: string): Uint8Array {
    const padding = '='.repeat((4 - (value.length % 4)) % 4);
    const base64 = `${value}${padding}`.replace(/-/g, '+').replace(/_/g, '/');
    const raw = window.atob(base64);
    const output = new Uint8Array(raw.length);

    for (let index = 0; index < raw.length; index += 1) {
      output[index] = raw.charCodeAt(index);
    }

    return output;
  }
}
