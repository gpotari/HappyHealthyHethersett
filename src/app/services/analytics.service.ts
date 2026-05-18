import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { computed, inject, Injectable, PLATFORM_ID, signal } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import type { FirebaseOptions } from 'firebase/app';
import type { Analytics } from 'firebase/analytics';
import { catchError, filter, firstValueFrom, of } from 'rxjs';

type AnalyticsConsent = 'accepted' | 'declined' | 'unknown';
type FirebaseAnalyticsModule = typeof import('firebase/analytics');

interface FirebaseRuntimeConfig extends FirebaseOptions {
  enabled?: boolean;
}

const ANALYTICS_CONSENT_KEY = 'hhh.analytics.consent';
const FIREBASE_CONFIG_URL = 'assets/firebase-config.json';

@Injectable({
  providedIn: 'root'
})
export class AnalyticsService {
  private readonly document = inject(DOCUMENT);
  private readonly http = inject(HttpClient);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly router = inject(Router);

  private analytics: Analytics | null = null;
  private analyticsModule: FirebaseAnalyticsModule | null = null;
  private initPromise: Promise<Analytics | null> | null = null;
  private hasStarted = false;

  readonly consent = signal<AnalyticsConsent>(this.readStoredConsent());
  readonly shouldShowBanner = computed(() => this.consent() === 'unknown');

  start(): void {
    if (!this.isBrowser() || this.hasStarted) {
      return;
    }

    this.hasStarted = true;
    this.router.events
      .pipe(filter((event): event is NavigationEnd => event instanceof NavigationEnd))
      .subscribe((event) => {
        void this.trackPageView(event.urlAfterRedirects);
      });

    if (this.consent() === 'accepted') {
      void this.enableAnalytics(true);
    }
  }

  acceptAnalytics(): void {
    this.storeConsent('accepted');
    void this.enableAnalytics(true);
  }

  declineAnalytics(): void {
    this.storeConsent('declined');

    if (this.analytics) {
      this.analyticsModule?.setAnalyticsCollectionEnabled(this.analytics, false);
    }
  }

  clearPreference(): void {
    if (!this.isBrowser()) {
      return;
    }

    localStorage.removeItem(ANALYTICS_CONSENT_KEY);
    this.consent.set('unknown');

    if (this.analytics) {
      this.analyticsModule?.setAnalyticsCollectionEnabled(this.analytics, false);
    }
  }

  async trackPageView(url = this.router.url): Promise<void> {
    if (!this.isBrowser() || this.consent() !== 'accepted') {
      return;
    }

    const analytics = await this.getAnalytics();
    if (!analytics) {
      return;
    }

    const normalizedUrl = url || '/';
    this.analyticsModule?.logEvent(analytics, 'page_view', {
      page_location: `${window.location.origin}${normalizedUrl}`,
      page_path: normalizedUrl.split('?')[0],
      page_title: this.document.title
    });
  }

  private async enableAnalytics(trackCurrentPage = false): Promise<void> {
    const analytics = await this.getAnalytics();
    if (!analytics) {
      return;
    }

    this.analyticsModule?.setAnalyticsCollectionEnabled(analytics, true);

    if (trackCurrentPage) {
      await this.trackPageView();
    }
  }

  private async getAnalytics(): Promise<Analytics | null> {
    if (this.analytics) {
      return this.analytics;
    }

    if (!this.initPromise) {
      this.initPromise = this.initialiseAnalytics();
    }

    return this.initPromise;
  }

  private async initialiseAnalytics(): Promise<Analytics | null> {
    const config = await this.loadFirebaseConfig();
    if (!config) {
      return null;
    }

    const [{ getApps, initializeApp }, analyticsModule] = await Promise.all([
      import('firebase/app'),
      import('firebase/analytics')
    ]);
    const supported = await analyticsModule.isSupported().catch(() => false);
    if (!supported) {
      return null;
    }

    const app = getApps().length > 0 ? getApps()[0] : initializeApp(config);
    this.analyticsModule = analyticsModule;
    this.analytics = analyticsModule.getAnalytics(app);
    return this.analytics;
  }

  private async loadFirebaseConfig(): Promise<FirebaseOptions | null> {
    const config = await firstValueFrom(
      this.http.get<FirebaseRuntimeConfig>(FIREBASE_CONFIG_URL).pipe(catchError(() => of(null)))
    );

    if (!config || config.enabled === false) {
      return null;
    }

    const normalizedConfig: FirebaseOptions = {
      apiKey: this.cleanValue(config.apiKey),
      appId: this.cleanValue(config.appId),
      authDomain: this.cleanValue(config.authDomain),
      measurementId: this.cleanValue(config.measurementId),
      messagingSenderId: this.cleanValue(config.messagingSenderId),
      projectId: this.cleanValue(config.projectId),
      storageBucket: this.cleanValue(config.storageBucket)
    };

    if (
      !normalizedConfig.apiKey ||
      !normalizedConfig.appId ||
      !normalizedConfig.measurementId ||
      !normalizedConfig.projectId
    ) {
      return null;
    }

    return normalizedConfig;
  }

  private cleanValue(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
  }

  private readStoredConsent(): AnalyticsConsent {
    if (!this.isBrowser()) {
      return 'unknown';
    }

    const value = localStorage.getItem(ANALYTICS_CONSENT_KEY);
    return value === 'accepted' || value === 'declined' ? value : 'unknown';
  }

  private storeConsent(value: Exclude<AnalyticsConsent, 'unknown'>): void {
    if (!this.isBrowser()) {
      return;
    }

    localStorage.setItem(ANALYTICS_CONSENT_KEY, value);
    this.consent.set(value);
  }

  private isBrowser(): boolean {
    return isPlatformBrowser(this.platformId);
  }
}
