import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AnalyticsService } from '../services/analytics.service';

@Component({
  selector: 'app-privacy-cookies',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './privacy-cookies.component.html'
})
export class PrivacyCookiesComponent {
  private readonly analytics = inject(AnalyticsService);

  get analyticsPreferenceLabel(): string {
    const consent = this.analytics.consent();

    if (consent === 'accepted') {
      return 'Analytics allowed';
    }

    if (consent === 'declined') {
      return 'Analytics turned off';
    }

    return 'No choice saved yet';
  }

  acceptAnalytics(): void {
    this.analytics.acceptAnalytics();
  }

  declineAnalytics(): void {
    this.analytics.declineAnalytics();
  }

  clearAnalyticsPreference(): void {
    this.analytics.clearPreference();
  }
}
